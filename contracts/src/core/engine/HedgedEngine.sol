// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPauseGuardian, IStrategyEngine} from "../interfaces/ICore.sol";
import {IEngineValuation, IKuruOrderBook, IKuruRouter, IPerplExchange} from "../interfaces/IVenues.sol";

/// @title HedgedEngine
/// @notice The book's strategy engine (spec §10–§11): MON spot bought on Kuru against USDC, and an
///         equal MON short on Perpl margined in AUSD. On testnet the spot asset may be vMON, a
///         Vessel test token quoted at the Perpl mark (ADR-010); the short is always real MON. The engine itself owns the Perpl account
///         (G01), so no wallet ever holds venue funds. USDC⇄AUSD moves through two Kuru markets in
///         one transaction under an aggregate output floor (D02).
///
///         The operator (keeper) chooses when to act; this contract decides what is allowed:
///         - every trade is one slice of at most min(100 USDC, 0.5% of the engine's value);
///         - spot and short may differ by at most one slice, unless a trade narrows the gap;
///         - spot fills are bounded at 30 bps and conversions at 20 bps from the valuation prices,
///           and the keeper cannot pass a looser minimum;
///         - nothing trades on prices older than PRICE_MAX_AGE;
///         - buying spot and opening shorts stop while the guardian has paused RISK_INCREASE;
///           reductions, margin top-ups and conversions never do;
///         - money leaves only to custody (`release`). Venue outputs land here.
///
///         The book's holdings are an internal ledger (USDC, AUSD, MON) plus the Perpl account,
///         which only this contract can fund. Tokens or MON sent here any other way are
///         quarantined and never valued (IStrategyEngine.credit).
contract HedgedEngine is IStrategyEngine, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant SPOT_SLIPPAGE_BPS = 30;
    uint256 public constant CONVERSION_BPS = 20;
    uint256 public constant PERP_PRICE_BAND_BPS = 30;
    uint256 public constant MAX_SLICE_USDC = 100e6;
    uint256 public constant SLICE_BPS = 50;
    uint256 public constant PRICE_MAX_AGE = 60;
    uint256 public constant MAX_MATCHES = 100;
    uint256 public constant MAX_NEG_PNL_COLLAT_BPS = 1_000;
    uint256 public constant MIN_LEVERAGE_HDTHS = 100;
    uint256 public constant MAX_LEVERAGE_HDTHS = 300;
    uint8 internal constant RISK_INCREASE = 2;
    uint8 internal constant OPEN_SHORT = 1;
    uint8 internal constant CLOSE_SHORT = 3;
    uint8 internal constant SHORT = 1;

    struct Config {
        IERC20 usdc;
        IERC20 ausd;
        address custody;
        address operator;
        address governance;
        IPauseGuardian guardian;
        IEngineValuation valuation;
        IPerplExchange perpl;
        uint256 perpId;
        uint256 leverageHdths;
        IKuruRouter kuruRouter;
        IKuruOrderBook monUsdc;
        IKuruOrderBook monAusd;
    }

    IERC20 public immutable usdc;
    IERC20 public immutable ausd;
    address public immutable custody;
    address public immutable operator;
    address public immutable governance;
    IPauseGuardian public immutable guardian;
    IEngineValuation public immutable valuation;
    IPerplExchange public immutable perpl;
    uint256 public immutable perpId;
    uint256 public immutable leverageHdths;
    IKuruRouter public immutable kuruRouter;
    IKuruOrderBook public immutable monUsdc;
    IKuruOrderBook public immutable monAusd;
    /// @dev 10 ** Perpl priceDecimals and lotDecimals for `perpId`.
    uint256 public immutable perpPriceScale;
    uint256 public immutable perpLotScale;
    /// @dev Kuru MON/USDC precisions (quote sizes are scaled by pricePrecision, base by sizePrecision).
    uint256 public immutable spotPricePrecision;
    uint256 public immutable spotSizePrecision;
    /// @notice The spot asset both Kuru markets trade: address(0) is native MON. An ERC-20 here is a
    ///         testnet stand-in priced at the Perpl mark (ADR-010); it is refused on Monad mainnet.
    address public immutable spot;

    /// @notice The book's USDC, AUSD and MON held by this contract.
    uint256 public usdcCash;
    uint256 public ausdCash;
    uint256 public monQty;
    /// @notice The engine's own Perpl account (0 until the first margin deposit).
    uint256 public perplAccountId;
    uint256 public orderNonce;

    error NotCustody();
    error NotOperator();
    error NotAllowed();
    error ZeroAddress();
    error BadConfig();
    error RiskPaused();
    error StalePrice();
    error Insufficient();
    error SliceTooLarge(uint256 usdcValue, uint256 cap);
    error FloorTooLoose(uint256 given, uint256 required);
    error BelowMinimum(uint256 got, uint256 minimum);
    error HedgeGap(uint256 gapUsdc, uint256 cap);
    error ZeroAmount();
    error TestSpotOnMainnet();

    event Credited(uint256 amount);
    event Released(uint256 amount);
    event SpotBought(uint256 usdcIn, uint256 monOut);
    event SpotSold(uint256 monIn, uint256 usdcOut);
    event ShortChanged(uint8 orderType, uint256 lotsRequested, uint256 shortLotsAfter);
    event MarginDeposited(uint256 accountId, uint256 amount);
    event MarginWithdrawn(uint256 amount);
    event Converted(address indexed tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(Config memory c) {
        if (
            address(c.usdc) == address(0) || address(c.ausd) == address(0) || c.custody == address(0)
                || c.operator == address(0) || c.governance == address(0) || address(c.guardian) == address(0)
                || address(c.valuation) == address(0) || address(c.perpl) == address(0)
                || address(c.kuruRouter) == address(0) || address(c.monUsdc) == address(0)
                || address(c.monAusd) == address(0)
        ) revert ZeroAddress();
        if (IERC20Metadata(address(c.usdc)).decimals() != 6 || IERC20Metadata(address(c.ausd)).decimals() != 6) {
            revert BadConfig();
        }
        if (c.leverageHdths < MIN_LEVERAGE_HDTHS || c.leverageHdths > MAX_LEVERAGE_HDTHS) revert BadConfig();
        (,,,, address collateral,) = c.perpl.getExchangeInfo();
        if (collateral != address(c.ausd)) revert BadConfig();
        IPerplExchange.PerpetualInfoV2 memory p = c.perpl.getPerpetualInfoV2(c.perpId);
        if (p.markPNS == 0 || p.priceDecimals > 18 || p.lotDecimals > 18) revert BadConfig();
        (uint32 pp, uint96 sp, address base) = _checkMarket(c.monUsdc, address(c.usdc));
        (,, address base2) = _checkMarket(c.monAusd, address(c.ausd));
        if (base2 != base) revert BadConfig();
        if (base != address(0)) {
            if (block.chainid == 143) revert TestSpotOnMainnet();
            if (IERC20Metadata(base).decimals() != 18) revert BadConfig();
        }

        usdc = c.usdc;
        ausd = c.ausd;
        custody = c.custody;
        operator = c.operator;
        governance = c.governance;
        guardian = c.guardian;
        valuation = c.valuation;
        perpl = c.perpl;
        perpId = c.perpId;
        leverageHdths = c.leverageHdths;
        kuruRouter = c.kuruRouter;
        monUsdc = c.monUsdc;
        monAusd = c.monAusd;
        perpPriceScale = 10 ** p.priceDecimals;
        perpLotScale = 10 ** p.lotDecimals;
        spotPricePrecision = pp;
        spotSizePrecision = sp;
        spot = base;
    }

    /// @dev Native-MON markets pay proceeds as native MON. Only measured trade proceeds enter `monQty`.
    receive() external payable {}

    modifier onlyCustody() {
        if (msg.sender != custody) revert NotCustody();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @dev Reductions stay available to governance if the keeper key is lost.
    modifier onlyOperatorOrGovernance() {
        if (msg.sender != operator && msg.sender != governance) revert NotAllowed();
        _;
    }

    modifier riskIncrease() {
        if (guardian.isPaused(RISK_INCREASE)) revert RiskPaused();
        _;
    }

    // ================================================================== IStrategyEngine
    /// @inheritdoc IStrategyEngine
    /// @dev Cash-only books are valued at the current block. Anything priced reports the price's
    ///      own observation time, so the controller's staleness check halts settlement on old prices.
    function value() external view returns (uint256 usdcValue, uint256 observedAt) {
        if (monQty == 0 && ausdCash == 0 && perplAccountId == 0) return (usdcCash, block.timestamp);
        (uint256 px, uint256 fx, uint256 at) = valuation.prices();
        return (_value(px, fx), at > block.timestamp ? block.timestamp : at);
    }

    /// @inheritdoc IStrategyEngine
    function credit(uint256 amount) external onlyCustody {
        if (usdc.balanceOf(address(this)) < usdcCash + amount) revert Insufficient();
        usdcCash += amount;
        emit Credited(amount);
    }

    /// @inheritdoc IStrategyEngine
    /// @dev Pays only from USDC cash. The keeper unwinds slices first; `recallFromEngine` then pulls.
    function release(uint256 amount) external onlyCustody nonReentrant {
        if (amount > usdcCash) revert Insufficient();
        usdcCash -= amount;
        usdc.safeTransfer(custody, amount);
        emit Released(amount);
    }

    // ================================================================== spot (Kuru MON/USDC)
    function buySpot(uint256 usdcIn, uint256 minMonOut) external onlyOperator nonReentrant riskIncrease {
        if (usdcIn == 0) revert ZeroAmount();
        if (usdcIn > usdcCash) revert Insufficient();
        (uint256 px, uint256 fx) = _freshPrices();
        (uint256 gapBefore, uint256 cap) = _gapAndCap(px, fx);
        if (usdcIn > cap) revert SliceTooLarge(usdcIn, cap);
        uint256 floor = (usdcIn * 1e30 / px) * (BPS - SPOT_SLIPPAGE_BPS) / BPS;
        if (minMonOut < floor) revert FloorTooLoose(minMonOut, floor);

        uint256 quoteSize = usdcIn * spotPricePrecision / 1e6;
        uint256 usdcBefore = usdc.balanceOf(address(this));
        uint256 monBefore = _spotBalance();
        usdc.forceApprove(address(monUsdc), usdcIn);
        monUsdc.placeAndExecuteMarketBuy(_u96(quoteSize), minMonOut, false, true);
        usdc.forceApprove(address(monUsdc), 0);
        uint256 spent = usdcBefore - usdc.balanceOf(address(this));
        uint256 got = _spotBalance() - monBefore;
        if (spent > usdcIn) revert Insufficient();
        if (got < minMonOut) revert BelowMinimum(got, minMonOut);

        usdcCash -= spent;
        monQty += got;
        _checkGap(px, gapBefore, cap);
        emit SpotBought(spent, got);
    }

    function sellSpot(uint256 monIn, uint256 minUsdcOut) external onlyOperatorOrGovernance nonReentrant {
        if (monIn > monQty) revert Insufficient();
        (uint256 px, uint256 fx) = _freshPrices();
        (uint256 gapBefore, uint256 cap) = _gapAndCap(px, fx);
        uint256 size = monIn * spotSizePrecision / 1e18;
        uint256 exact = size * 1e18 / spotSizePrecision;
        if (exact == 0) revert ZeroAmount();
        uint256 usdcValue = exact * px / 1e30;
        if (usdcValue > cap) revert SliceTooLarge(usdcValue, cap);
        uint256 floor = usdcValue * (BPS - SPOT_SLIPPAGE_BPS) / BPS;
        if (minUsdcOut < floor) revert FloorTooLoose(minUsdcOut, floor);

        uint256 usdcBefore = usdc.balanceOf(address(this));
        uint256 spotBefore = _spotBalance();
        if (spot == address(0)) {
            monUsdc.placeAndExecuteMarketSell{value: exact}(_u96(size), minUsdcOut, false, true);
        } else {
            IERC20(spot).forceApprove(address(monUsdc), exact);
            monUsdc.placeAndExecuteMarketSell(_u96(size), minUsdcOut, false, true);
            IERC20(spot).forceApprove(address(monUsdc), 0);
        }
        if (spotBefore - _spotBalance() != exact) revert Insufficient();
        uint256 got = usdc.balanceOf(address(this)) - usdcBefore;
        if (got < minUsdcOut) revert BelowMinimum(got, minUsdcOut);

        monQty -= exact;
        usdcCash += got;
        _checkGap(px, gapBefore, cap);
        emit SpotSold(exact, got);
    }

    // ================================================================== short (Perpl)
    function openShort(uint256 lots, uint256 minPricePNS) external onlyOperator nonReentrant riskIncrease {
        (uint256 px, uint256 fx) = _freshPrices();
        (uint256 gapBefore, uint256 cap) = _gapAndCap(px, fx);
        uint256 usdcValue = (lots * 1e18 / perpLotScale) * px / 1e30;
        if (usdcValue > cap) revert SliceTooLarge(usdcValue, cap);
        uint256 floor = (px * perpPriceScale / 1e18) * (BPS - PERP_PRICE_BAND_BPS) / BPS;
        if (minPricePNS < floor) revert FloorTooLoose(minPricePNS, floor);
        _order(OPEN_SHORT, lots, minPricePNS);
        _checkGap(px, gapBefore, cap);
    }

    function closeShort(uint256 lots, uint256 maxPricePNS) external onlyOperatorOrGovernance nonReentrant {
        (uint256 px, uint256 fx) = _freshPrices();
        (uint256 gapBefore, uint256 cap) = _gapAndCap(px, fx);
        uint256 usdcValue = (lots * 1e18 / perpLotScale) * px / 1e30;
        if (usdcValue > cap) revert SliceTooLarge(usdcValue, cap);
        uint256 ceiling = (px * perpPriceScale / 1e18) * (BPS + PERP_PRICE_BAND_BPS) / BPS;
        if (maxPricePNS > ceiling) revert FloorTooLoose(maxPricePNS, ceiling);
        _order(CLOSE_SHORT, lots, maxPricePNS);
        _checkGap(px, gapBefore, cap);
    }

    // ================================================================== margin (Perpl account)
    /// @notice Moves AUSD into the engine's own Perpl account, opening it on first use.
    /// @dev Allowed while RISK_INCREASE is paused: margin top-ups protect an open short.
    function depositMargin(uint256 amount) external onlyOperatorOrGovernance nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > ausdCash) revert Insufficient();
        uint256 before = ausd.balanceOf(address(this));
        ausd.forceApprove(address(perpl), amount);
        if (perplAccountId == 0) {
            perplAccountId = perpl.createAccount(amount);
            if (perpl.getAccountByAddr(address(this)).accountId != perplAccountId) revert BadConfig();
        } else {
            perpl.depositCollateral(amount);
        }
        ausd.forceApprove(address(perpl), 0);
        uint256 moved = before - ausd.balanceOf(address(this));
        if (moved != amount) revert Insufficient();
        ausdCash -= amount;
        emit MarginDeposited(perplAccountId, amount);
    }

    function withdrawMargin(uint256 amount) external onlyOperatorOrGovernance nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 before = ausd.balanceOf(address(this));
        perpl.withdrawCollateral(amount);
        uint256 got = ausd.balanceOf(address(this)) - before;
        ausdCash += got;
        emit MarginWithdrawn(got);
    }

    // ================================================================== USDC ⇄ AUSD (Kuru, atomic)
    /// @dev Allowed while RISK_INCREASE is paused, so margin can be topped up. MON exposure is unchanged.
    function convertToMargin(uint256 usdcIn, uint256 minAusdOut) external onlyOperatorOrGovernance nonReentrant {
        if (usdcIn == 0) revert ZeroAmount();
        if (usdcIn > usdcCash) revert Insufficient();
        (, uint256 fx) = _freshPrices();
        uint256 floor = (usdcIn * 1e18 / fx) * (BPS - CONVERSION_BPS) / BPS;
        if (minAusdOut < floor) revert FloorTooLoose(minAusdOut, floor);
        uint256 got = _route(usdc, ausd, monUsdc, monAusd, usdcIn, minAusdOut);
        usdcCash -= usdcIn;
        ausdCash += got;
    }

    function convertToCash(uint256 ausdIn, uint256 minUsdcOut) external onlyOperatorOrGovernance nonReentrant {
        if (ausdIn == 0) revert ZeroAmount();
        if (ausdIn > ausdCash) revert Insufficient();
        (, uint256 fx) = _freshPrices();
        uint256 floor = (ausdIn * fx / 1e18) * (BPS - CONVERSION_BPS) / BPS;
        if (minUsdcOut < floor) revert FloorTooLoose(minUsdcOut, floor);
        uint256 got = _route(ausd, usdc, monAusd, monUsdc, ausdIn, minUsdcOut);
        ausdCash -= ausdIn;
        usdcCash += got;
    }

    // ================================================================== views
    /// @notice Short size in Perpl lots (0 when flat or long).
    function shortLots() public view returns (uint256) {
        if (perplAccountId == 0) return 0;
        (IPerplExchange.PositionInfo memory pos,,) = perpl.getPosition(perpId, perplAccountId);
        return pos.positionType == SHORT ? pos.lotLNS : 0;
    }

    /// @notice Perpl account equity in AUSD units: free balance + position deposit + marked PnL
    ///         (PnL includes funding). Negative equity reads as 0; it cannot be withdrawn.
    function perplEquity() public view returns (uint256) {
        if (perplAccountId == 0) return 0;
        uint256 free = perpl.getAccountByAddr(address(this)).balanceCNS;
        (IPerplExchange.PositionInfo memory pos,,) = perpl.getPosition(perpId, perplAccountId);
        if (pos.lotLNS == 0) return free;
        int256 eq = int256(free + pos.depositCNS) + pos.pnlCNS;
        return eq > 0 ? uint256(eq) : 0;
    }

    /// @notice Largest slice allowed now, in USDC: min(100 USDC, 0.5% of the engine's value).
    function sliceCap() external view returns (uint256) {
        (uint256 px, uint256 fx,) = valuation.prices();
        (, uint256 cap) = _gapAndCap(px, fx);
        return cap;
    }

    /// @notice USDC and AUSD held here outside the book's ledger. Never valued.
    function quarantined() external view returns (uint256 usdcAmount, uint256 ausdAmount, uint256 monAmount) {
        return
            (
                usdc.balanceOf(address(this)) - usdcCash,
                ausd.balanceOf(address(this)) - ausdCash,
                _spotBalance() - monQty
            );
    }

    // ================================================================== internals
    function _value(uint256 px, uint256 fx) private view returns (uint256) {
        return usdcCash + (ausdCash + perplEquity()) * fx / 1e18 + monQty * px / 1e30;
    }

    function _freshPrices() private view returns (uint256 px, uint256 fx) {
        uint256 at;
        (px, fx, at) = valuation.prices();
        if (px == 0 || fx == 0 || at + PRICE_MAX_AGE < block.timestamp) revert StalePrice();
    }

    /// @return gap |spot − short| in USDC at `px`
    /// @return cap the slice cap: min(MAX_SLICE_USDC, SLICE_BPS of the engine's value)
    function _gapAndCap(uint256 px, uint256 fx) private view returns (uint256 gap, uint256 cap) {
        gap = _gap(px);
        cap = _value(px, fx) * SLICE_BPS / BPS;
        if (cap > MAX_SLICE_USDC) cap = MAX_SLICE_USDC;
    }

    function _gap(uint256 px) private view returns (uint256) {
        uint256 shortMon = shortLots() * 1e18 / perpLotScale;
        uint256 d = monQty > shortMon ? monQty - shortMon : shortMon - monQty;
        return d * px / 1e30;
    }

    /// @dev After a trade the hedge may be off by at most one slice, unless the trade narrowed it.
    function _checkGap(uint256 px, uint256 gapBefore, uint256 cap) private view {
        uint256 gapAfter = _gap(px);
        if (gapAfter > cap && gapAfter > gapBefore) revert HedgeGap(gapAfter, cap);
    }

    function _order(uint8 orderType, uint256 lots, uint256 limitPNS) private {
        if (lots == 0) revert ZeroAmount();
        if (perplAccountId == 0) revert Insufficient();
        perpl.execOrder(
            IPerplExchange.OrderDesc({
                orderDescId: ++orderNonce,
                perpId: perpId,
                orderType: orderType,
                orderId: 0,
                pricePNS: limitPNS,
                lotLNS: lots,
                expiryBlock: 0,
                postOnly: false,
                fillOrKill: false,
                immediateOrCancel: true,
                maxMatches: MAX_MATCHES,
                leverageHdths: leverageHdths,
                lastExecutionBlock: block.number + 1,
                amountCNS: 0,
                maxNegPnlCollatBPS: MAX_NEG_PNL_COLLAT_BPS
            })
        );
        emit ShortChanged(orderType, lots, shortLots());
    }

    /// @dev tokenIn → MON on `first`, MON → tokenOut on `second`, in one router call.
    function _route(
        IERC20 tokenIn,
        IERC20 tokenOut,
        IKuruOrderBook first,
        IKuruOrderBook second,
        uint256 amountIn,
        uint256 minOut
    ) private returns (uint256 got) {
        address[] memory markets = new address[](2);
        markets[0] = address(first);
        markets[1] = address(second);
        bool[] memory isBuy = new bool[](2);
        isBuy[0] = true;
        bool[] memory nativeSend = new bool[](2);
        nativeSend[1] = spot == address(0); // the second leg sells the spot asset

        uint256 inBefore = tokenIn.balanceOf(address(this));
        uint256 outBefore = tokenOut.balanceOf(address(this));
        tokenIn.forceApprove(address(kuruRouter), amountIn);
        kuruRouter.anyToAnySwap(markets, isBuy, nativeSend, address(tokenIn), address(tokenOut), amountIn, minOut);
        tokenIn.forceApprove(address(kuruRouter), 0);
        if (inBefore - tokenIn.balanceOf(address(this)) != amountIn) revert Insufficient();
        got = tokenOut.balanceOf(address(this)) - outBefore;
        if (got < minOut) revert BelowMinimum(got, minOut);
        emit Converted(address(tokenIn), amountIn, got);
    }

    function _checkMarket(IKuruOrderBook market, address quote)
        private
        view
        returns (uint32 pp, uint96 sp, address base)
    {
        address q;
        (pp, sp, base,, q,,,,,,) = market.getMarketParams();
        if (q != quote || pp == 0 || sp == 0) revert BadConfig();
    }

    /// @dev The engine's holding of the spot asset (native MON or the testnet ERC-20).
    function _spotBalance() private view returns (uint256) {
        return spot == address(0) ? address(this).balance : IERC20(spot).balanceOf(address(this));
    }

    function _u96(uint256 x) private pure returns (uint96) {
        if (x > type(uint96).max) revert SliceTooLarge(x, type(uint96).max);
        return uint96(x);
    }
}
