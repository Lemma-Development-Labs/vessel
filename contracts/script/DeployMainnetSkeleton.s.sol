// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Guardian} from "../src/guards/Guardian.sol";
import {BlitzVault} from "../src/BlitzVault.sol";
import {Tranches} from "../src/Tranches.sol";
import {SimVenue} from "../src/venues/SimVenue.sol";
import {PerplVenue} from "../src/venues/PerplVenue.stub.sol";
import {EngineLite} from "../src/EngineLite.sol";
import {KuruRouter} from "../src/venues/KuruRouter.sol";
import {RouterMidOracle} from "../src/oracles/RouterMidOracle.sol";
import {ManualTwapOracle} from "../src/oracles/ManualTwapOracle.sol";
import {IRouter} from "../src/interfaces/IRouter.sol";

/// @title DeployMainnetSkeleton
/// @notice Gate 4 scaffold for chain 143. Does NOT broadcast unless CHAIN_ID=143
///         and MAINNET_CONFIRM=I_UNDERSTAND_UNAIDITED is set.
/// @dev Quote token MUST be a real stable (USDC/AUSD) — DemoUSD is forbidden.
///      Spot = Kuru (or approved router). Short = SimVenue only until PerplVenue
///      is live (`isSimulated()==false`). Deposit caps + ManualTwapOracle wired.
///
/// Required env:
///   DEPLOYER_PK, SEEDER_PK (≠ deployer)
///   MAINNET_QUOTE_TOKEN   (USDC 0x7547… or AUSD 0x0000…eFE3…)
///   MAINNET_WMON          (default 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A)
///   KURU_ORDER_BOOK / KURU_MARGIN (mainnet addresses when published)
///   DEPOSIT_CAP_ASSETS    (6dec units; required > 0)
///   MAINNET_CONFIRM=I_UNDERSTAND_UNAIDITED
contract DeployMainnetSkeleton is Script {
    error WrongChain(uint256 got);
    error DemoUsdForbidden();
    error ConfirmMissing();
    error CapRequired();
    error DecimalsNotSix(uint8 got);

    address internal constant WMON_MAINNET = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address internal constant USDC_MAINNET = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address internal constant AUSD_MAINNET = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;

    function run() external {
        if (block.chainid != 143) revert WrongChain(block.chainid);
        string memory confirm = vm.envOr("MAINNET_CONFIRM", string(""));
        if (!_eq(confirm, "I_UNDERSTAND_UNAIDITED")) revert ConfirmMissing();

        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);
        address owner = vm.envOr("PROTOCOL_OWNER", deployer);
        address quoteAddr = vm.envAddress("MAINNET_QUOTE_TOKEN");
        if (quoteAddr == address(0)) revert DemoUsdForbidden();
        // Belt: refuse anything named DemoUSD by checking known testnet DemoUSD.
        if (quoteAddr == 0x66B5A41466b1Ab2dE34Bf3834b26F99bA4f52e05) revert DemoUsdForbidden();

        uint8 qDec = IERC20Metadata(quoteAddr).decimals();
        if (qDec != 6) revert DecimalsNotSix(qDec);

        address wmon = vm.envOr("MAINNET_WMON", WMON_MAINNET);
        address book = vm.envAddress("KURU_ORDER_BOOK");
        address margin = vm.envAddress("KURU_MARGIN");
        uint256 depositCap = vm.envUint("DEPOSIT_CAP_ASSETS");
        if (depositCap == 0) revert CapRequired();
        int256 haltBps = int256(vm.envOr("NET_DELTA_HALT_BPS", uint256(500)));

        vm.startBroadcast(pk);

        Guardian guardian = new Guardian(owner);
        PerplVenue perpl = new PerplVenue(); // stub — keep isSimulated true
        EngineLite engine = new EngineLite(address(guardian));

        IERC20 quote = IERC20(quoteAddr);
        BlitzVault vault = new BlitzVault(quote, address(guardian));
        Tranches tranches = new Tranches(address(vault), address(guardian), owner);
        SimVenue venue = new SimVenue(address(quote), owner);
        IRouter router = IRouter(address(new KuruRouter(book, margin, address(quote), wmon)));
        RouterMidOracle mid = new RouterMidOracle(address(router));
        ManualTwapOracle twap = new ManualTwapOracle(owner, 1 hours, 18, 6);

        vault.setEngine(address(engine));
        tranches.setEngine(address(engine));
        engine.wire(address(vault), address(tranches), address(venue), address(router), wmon);
        engine.setSpotOracle(address(twap)); // prefers TWAP; falls back policy in Engine
        engine.setNetDeltaHaltBps(haltBps);
        tranches.setDepositCap(depositCap);

        // Dead shares: broadcaster must hold `100e6` of quote already.
        quote.approve(address(vault), 100e6);
        vault.seedDeadShares(100e6);
        vault.setTranches(address(tranches));

        vm.stopBroadcast();

        console.log("Guardian", address(guardian));
        console.log("Vault", address(vault));
        console.log("Tranches", address(tranches));
        console.log("Engine", address(engine));
        console.log("KuruRouter", address(router));
        console.log("ManualTwapOracle", address(twap));
        console.log("RouterMidOracle", address(mid));
        console.log("PerplVenue stub", address(perpl));
        console.log("quote", quoteAddr);
        console.log("USDC_REF", USDC_MAINNET);
        console.log("AUSD_REF", AUSD_MAINNET);
        console.log("WRITE addresses into ADDRESSES.mainnet.json manually after Sourcify");
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
