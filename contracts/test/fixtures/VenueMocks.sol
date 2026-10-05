// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IEngineValuation, IPerplExchange} from "../../src/core/interfaces/IVenues.sol";

/// @notice TEST FIXTURE — prices for HedgedEngine unit tests.
contract MockValuation is IEngineValuation {
    uint256 public px = 0.031e18; // USDC per MON
    uint256 public fx = 1e18; // USDC per AUSD
    uint256 public at;
    bool public stale;

    function set(uint256 px_, uint256 fx_) external {
        px = px_;
        fx = fx_;
    }

    function setStale(bool s) external {
        stale = s;
    }

    function prices() external view returns (uint256, uint256, uint256) {
        return (px, fx, stale ? block.timestamp - 3_600 : block.timestamp);
    }

    function isIndependent() external pure returns (bool) {
        return false;
    }
}

/// @notice TEST FIXTURE — the slice of Perpl's exchange HedgedEngine uses, with Perpl's units:
///         prices 5 dp, lots 0 dp (1 lot = 1 MON), collateral 6 dp. IOC shorts fill in full at the
///         mark when the limit allows, or not at all. One perpetual, shorts only.
contract MockPerpl {
    uint256 public constant MIN_OPEN = 100e6;
    IERC20 public immutable collateral;
    uint256 public immutable perpId;
    uint256 public markPNS = 3_100; // 0.03100

    struct Acct {
        uint256 id;
        uint256 balance;
        uint256 lots;
        uint256 deposit;
        uint256 entry;
    }

    mapping(address => Acct) internal accts;
    uint256 internal nextId = 1;
    uint256 public lastLeverage;

    constructor(IERC20 collateral_, uint256 perpId_) {
        collateral = collateral_;
        perpId = perpId_;
    }

    function setMark(uint256 m) external {
        markPNS = m;
    }

    function createAccount(uint256 amount) external returns (uint256 id) {
        require(accts[msg.sender].id == 0, "exists");
        require(amount >= MIN_OPEN, "min open");
        collateral.transferFrom(msg.sender, address(this), amount);
        id = nextId++;
        accts[msg.sender].id = id;
        accts[msg.sender].balance = amount;
    }

    function depositCollateral(uint256 amount) external {
        require(accts[msg.sender].id != 0, "no account");
        collateral.transferFrom(msg.sender, address(this), amount);
        accts[msg.sender].balance += amount;
    }

    function withdrawCollateral(uint256 amount) external {
        Acct storage a = accts[msg.sender];
        require(amount <= a.balance, "free balance");
        a.balance -= amount;
        collateral.transfer(msg.sender, amount);
    }

    function execOrder(IPerplExchange.OrderDesc calldata o) external returns (IPerplExchange.OrderSignature memory) {
        Acct storage a = accts[msg.sender];
        require(a.id != 0, "no account");
        require(o.perpId == perpId && o.immediateOrCancel, "order");
        lastLeverage = o.leverageHdths;
        if (o.orderType == 1) {
            if (o.pricePNS > markPNS) return IPerplExchange.OrderSignature(perpId, 0); // IOC: no fill
            uint256 dep = _notional(o.lotLNS) * 100 / o.leverageHdths;
            require(dep <= a.balance, "margin");
            a.balance -= dep;
            a.entry = a.lots == 0 ? markPNS : (a.entry * a.lots + markPNS * o.lotLNS) / (a.lots + o.lotLNS);
            a.lots += o.lotLNS;
            a.deposit += dep;
        } else if (o.orderType == 3) {
            if (o.pricePNS < markPNS) return IPerplExchange.OrderSignature(perpId, 0);
            require(o.lotLNS <= a.lots, "reduce only");
            uint256 depOut = a.deposit * o.lotLNS / a.lots;
            int256 pnl = (int256(a.entry) - int256(markPNS)) * int256(o.lotLNS) * 10;
            int256 back = int256(depOut) + pnl;
            a.balance = back > 0 ? a.balance + uint256(back) : a.balance;
            a.deposit -= depOut;
            a.lots -= o.lotLNS;
            if (a.lots == 0) a.entry = 0;
        } else {
            revert("type");
        }
        return IPerplExchange.OrderSignature(perpId, 1);
    }

    function getAccountByAddr(address who) external view returns (IPerplExchange.AccountInfo memory info) {
        Acct storage a = accts[who];
        require(a.id != 0, "no account");
        info.accountId = a.id;
        info.balanceCNS = a.balance;
        info.accountAddr = who;
    }

    function getPosition(uint256, uint256 accountId)
        external
        view
        returns (IPerplExchange.PositionInfo memory pos, uint256, bool)
    {
        // Tests use a single engine account; look it up by id through the caller.
        Acct storage a = accts[msg.sender];
        if (a.id == accountId && a.lots > 0) {
            pos.accountId = a.id;
            pos.positionType = 1;
            pos.depositCNS = a.deposit;
            pos.pricePNS = a.entry;
            pos.lotLNS = a.lots;
            pos.pnlCNS = (int256(a.entry) - int256(markPNS)) * int256(a.lots) * 10;
            pos.deltaPnlCNS = pos.pnlCNS;
        }
        return (pos, markPNS, true);
    }

    function getPerpetualInfoV2(uint256) external view returns (IPerplExchange.PerpetualInfoV2 memory p) {
        p.priceDecimals = 5;
        p.lotDecimals = 0;
        p.markPNS = markPNS;
        p.markTimestamp = block.timestamp;
    }

    function getExchangeInfo() external view returns (uint256, uint256, uint256, uint256, address, address) {
        return (0, 0, 0, 6, address(collateral), address(0));
    }

    /// @dev 6-dp collateral value of `lots` MON at the mark (5-dp price): lots × mark × 10.
    function _notional(uint256 lots) internal view returns (uint256) {
        return lots * markPNS * 10;
    }
}

/// @notice TEST FIXTURE — a Kuru NATIVE_IN_BASE market (MON / 6-dp quote) with Kuru's units:
///         pricePrecision 1e8, sizePrecision 1e10. Fills fill-or-kill at bid/ask around `mid`.
contract MockKuruBook {
    uint32 public constant PRICE_PRECISION = 1e8;
    uint96 public constant SIZE_PRECISION = 1e10;
    IERC20 public immutable quote;
    uint256 public mid = 3_100_000; // 0.031 quote per MON
    uint256 public halfSpreadBps = 3;

    constructor(IERC20 quote_) {
        quote = quote_;
    }

    receive() external payable {}

    function set(uint256 mid_, uint256 halfSpreadBps_) external {
        mid = mid_;
        halfSpreadBps = halfSpreadBps_;
    }

    function getMarketParams()
        external
        view
        returns (uint32, uint96, address, uint256, address, uint256, uint32, uint96, uint96, uint256, uint256)
    {
        return (PRICE_PRECISION, SIZE_PRECISION, address(0), 18, address(quote), 6, 100, 1e10, 1e18, 0, 0);
    }

    function placeAndExecuteMarketBuy(uint96 quoteSize, uint256 minOut, bool, bool) external payable returns (uint256) {
        uint256 quoteIn = uint256(quoteSize) * 1e6 / PRICE_PRECISION;
        quote.transferFrom(msg.sender, address(this), quoteIn);
        uint256 ask = mid * (10_000 + halfSpreadBps) / 10_000;
        uint256 out = quoteIn * 1e12 * PRICE_PRECISION / ask;
        require(out >= minOut, "SlippageExceeded");
        (bool ok,) = msg.sender.call{value: out}("");
        require(ok, "native");
        return out;
    }

    function placeAndExecuteMarketSell(uint96 size, uint256 minOut, bool, bool) external payable returns (uint256) {
        require(msg.value == uint256(size) * 1e18 / SIZE_PRECISION, "value");
        uint256 bid = mid * (10_000 - halfSpreadBps) / 10_000;
        uint256 out = msg.value * bid / PRICE_PRECISION / 1e12;
        require(out >= minOut, "SlippageExceeded");
        quote.transfer(msg.sender, out);
        return out;
    }
}

/// @notice TEST FIXTURE — Kuru Router `anyToAnySwap` for the two-market route the engine uses.
contract MockKuruRouter {
    receive() external payable {}

    function anyToAnySwap(
        address[] calldata markets,
        bool[] calldata isBuy,
        bool[] calldata nativeSend,
        address debitToken,
        address creditToken,
        uint256 amount,
        uint256 minAmountOut
    ) external payable returns (uint256 out) {
        require(markets.length == 2 && isBuy[0] && !isBuy[1] && !nativeSend[0] && nativeSend[1], "route");
        IERC20(debitToken).transferFrom(msg.sender, address(this), amount);
        MockKuruBook a = MockKuruBook(payable(markets[0]));
        MockKuruBook b = MockKuruBook(payable(markets[1]));
        require(address(a.quote()) == debitToken && address(b.quote()) == creditToken, "tokens");
        IERC20(debitToken).approve(address(a), amount);
        uint256 mon = a.placeAndExecuteMarketBuy(uint96(amount * 1e8 / 1e6), 0, false, true);
        uint256 size = mon * 1e10 / 1e18;
        out = b.placeAndExecuteMarketSell{value: size * 1e18 / 1e10}(uint96(size), 0, false, true);
        require(out >= minAmountOut, "SlippageExceeded");
        IERC20(creditToken).transfer(msg.sender, out);
    }
}
