// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPerplExchange} from "../src/core/interfaces/IVenues.sol";

interface IKuruBookQuotes {
    function addFlipBuyOrder(uint32 _price, uint32 _flippedPrice, uint96 _size, bool _provisionOrRevert) external;
    function addFlipSellOrder(uint32 _price, uint32 _flippedPrice, uint96 _size, bool _provisionOrRevert) external;
    function batchCancelFlipOrders(uint40[] calldata _orderIds) external;
    function s_orders(uint40 id)
        external
        view
        returns (
            address owner,
            uint96 size,
            uint40 prev,
            uint40 next,
            uint40 flippedId,
            uint32 price,
            uint32 flippedPrice,
            bool isBuy
        );
}

interface IKuruMarginQuotes {
    function deposit(address _user, address _token, uint256 _amount) external payable;
    function getBalance(address _user, address _token) external view returns (uint256);
}

/// @notice Quote Vessel's testnet Kuru markets around the Perpl MON mark (ADR-009). On testnet nothing
///         arbitrages these markets against Perpl, so this script is the market maker: it cancels the
///         previous flip orders, tops up the seeder's Kuru margin balance, and places one flip bid and one
///         flip ask per market, `HALF_SPREAD_TICKS` either side of the mark. Run it to seed, and re-run
///         whenever the mark has moved more than the engine's 30 bps band. Testnet only; the seeder is a
///         team wallet and its quotes are labelled "testnet liquidity provided by Vessel".
///
/// Env: KURU_SEEDER_PK; optional QUOTE_PER_SIDE (quote units, default 500e6), HALF_SPREAD_TICKS
///      (default 10 → $0.00001 ≈ 3 bps at $0.031), KURU_MARKETS (default ../deployments/testnet-kuru-markets.json),
///      KURU_QUOTES_STATE (default ../deployments/testnet-kuru-quotes.json).
contract KuruQuotes is Script {
    using stdJson for string;

    IPerplExchange constant PERPL = IPerplExchange(0x1964C32f0bE608E7D29302AFF5E61268E72080cc);
    uint256 constant MON_PERP = 64;
    IKuruMarginQuotes constant MARGIN = IKuruMarginQuotes(0xd029C2D98ff85D8F64799017fE00a59B1159CE02);
    uint256 constant TICK = 100; // market tick in 1e8 price units, as opened by OpenKuruMarkets
    uint256 constant SIZE_PRECISION = 1e10;
    uint256 constant PRICE_PRECISION = 1e8;
    bytes32 constant FLIP_CREATED = keccak256("FlipOrderCreated(uint40,uint40,address,uint96,uint32,uint32,bool)");

    struct Market {
        address book;
        address quote;
    }

    function run() external {
        require(block.chainid == 10143 || block.chainid == 31337, "KuruQuotes: Monad testnet only");
        uint256 pk = vm.envUint("KURU_SEEDER_PK");
        address seeder = vm.addr(pk);
        uint256 quotePerSide = vm.envOr("QUOTE_PER_SIDE", uint256(500e6));
        uint256 halfSpread = vm.envOr("HALF_SPREAD_TICKS", uint256(10)) * TICK;

        string memory m = vm.readFile(vm.envOr("KURU_MARKETS", string("../deployments/testnet-kuru-markets.json")));
        Market[2] memory markets = [
            Market(m.readAddress(".monUsdc"), m.readAddress(".usdc")),
            Market(m.readAddress(".monAusd"), m.readAddress(".ausd"))
        ];

        IPerplExchange.PerpetualInfoV2 memory p = PERPL.getPerpetualInfoV2(MON_PERP);
        uint256 mid = (p.markPNS * PRICE_PRECISION / 10 ** p.priceDecimals) / TICK * TICK;
        require(mid > halfSpread, "mark too low for the spread");
        uint32 bid = uint32(mid - halfSpread);
        uint32 ask = uint32(mid + halfSpread);
        console2.log("Perpl mark (1e8)", mid);

        string memory statePath = vm.envOr("KURU_QUOTES_STATE", string("../deployments/testnet-kuru-quotes.json"));
        string memory previous = vm.exists(statePath) ? vm.readFile(statePath) : "";

        vm.recordLogs();
        vm.startBroadcast(pk);
        for (uint256 i; i < 2; i++) {
            Market memory k = markets[i];
            string memory key = i == 0 ? ".monUsdc" : ".monAusd";
            if (bytes(previous).length > 0 && previous.keyExists(key)) {
                uint256[] memory old = previous.readUintArray(key);
                uint40[] memory ids = _stillOurs(IKuruBookQuotes(k.book), old, seeder);
                // Kuru reverts the whole batch on an order that is already filled or gone
                // (docs.kuru.io says the call is idempotent; the deployed market is not).
                if (ids.length > 0) IKuruBookQuotes(k.book).batchCancelFlipOrders(ids);
            }
            // Top the seeder's Kuru margin balance up to one side of quote and one side of MON.
            uint256 monPerSide = quotePerSide * 1e12 * PRICE_PRECISION / ask;
            uint256 haveQuote = MARGIN.getBalance(seeder, k.quote);
            if (haveQuote < quotePerSide) {
                IERC20(k.quote).approve(address(MARGIN), quotePerSide - haveQuote);
                MARGIN.deposit(seeder, k.quote, quotePerSide - haveQuote);
            }
            uint256 haveMon = MARGIN.getBalance(seeder, address(0));
            uint256 monNeed = i == 0 ? monPerSide * 2 : monPerSide; // native MON balance is shared by both markets
            if (haveMon < monNeed) MARGIN.deposit{value: monNeed - haveMon}(seeder, address(0), monNeed - haveMon);

            uint96 bidSize = uint96(quotePerSide * SIZE_PRECISION * PRICE_PRECISION / bid / 1e6);
            uint96 askSize = uint96(monPerSide * SIZE_PRECISION / 1e18);
            IKuruBookQuotes(k.book).addFlipBuyOrder(bid, ask, bidSize, true);
            IKuruBookQuotes(k.book).addFlipSellOrder(ask, bid, askSize, true);
        }
        vm.stopBroadcast();

        Vm.Log[] memory logs = vm.getRecordedLogs();
        string memory s = "quotes";
        vm.serializeUint(s, "mid", mid);
        vm.serializeUint(s, "bid", bid);
        vm.serializeUint(s, "ask", ask);
        vm.serializeUint(s, "quotePerSide", quotePerSide);
        vm.serializeUint(s, "monUsdc", _ids(logs, markets[0].book, seeder));
        string memory out = vm.serializeUint(s, "monAusd", _ids(logs, markets[1].book, seeder));
        vm.writeJson(out, statePath);
        console2.log("quotes written to", statePath);
    }

    /// @dev The ids from `old` that are still live orders of `seeder` on `book`.
    function _stillOurs(IKuruBookQuotes book, uint256[] memory old, address seeder)
        internal
        view
        returns (uint40[] memory ids)
    {
        uint256 n;
        uint40[] memory tmp = new uint40[](old.length);
        for (uint256 j; j < old.length; j++) {
            (address owner, uint96 size,,,,,,) = book.s_orders(uint40(old[j]));
            if (owner == seeder && size > 0) tmp[n++] = uint40(old[j]);
        }
        ids = new uint40[](n);
        for (uint256 j; j < n; j++) {
            ids[j] = tmp[j];
        }
    }

    /// @dev Flip order ids this seeder created on `book`. The deployed markets emit FlipOrderCreated with
    ///      every field in the data (nothing indexed), unlike docs.kuru.io; both layouts are read.
    function _ids(Vm.Log[] memory logs, address book, address seeder) internal pure returns (uint256[] memory ids) {
        uint256 n;
        for (uint256 i; i < logs.length; i++) {
            if (_ours(logs[i], book, seeder) != 0) n++;
        }
        require(n > 0, "no FlipOrderCreated logs: check the event signature against the deployed market");
        ids = new uint256[](n);
        n = 0;
        for (uint256 i; i < logs.length; i++) {
            uint256 id = _ours(logs[i], book, seeder);
            if (id != 0) ids[n++] = id;
        }
    }

    /// @return id the flip order id when `l` is a FlipOrderCreated by `seeder` on `book`, else 0
    function _ours(Vm.Log memory l, address book, address seeder) private pure returns (uint256) {
        if (l.emitter != book || l.topics.length == 0 || l.topics[0] != FLIP_CREATED) return 0;
        if (l.topics.length == 4) {
            return address(uint160(uint256(l.topics[3]))) == seeder ? uint256(l.topics[1]) : 0;
        }
        (uint40 id,, address owner,,,,) = abi.decode(l.data, (uint40, uint40, address, uint96, uint32, uint32, bool));
        return owner == seeder ? id : 0;
    }
}
