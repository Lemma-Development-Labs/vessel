// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRouter} from "../interfaces/IRouter.sol";
import {IKuruOrderBook} from "../interfaces/IKuruOrderBook.sol";
import {IWETH} from "../interfaces/IWETH.sol";

/// @title KuruRouter
/// @notice IRouter over the official Kuru MON-USDC CLOB. Quote = Kuru testnet USDC
///         (6dec). Base delivered to the engine = WMON (18dec). The book itself
///         trades native MON (baseAsset = address(0)); this adapter wraps/unwraps.
/// @dev Market orders are fill-or-kill so a partial fill cannot leave a resting
///      order and still report success. minOut is always caller-supplied.
contract KuruRouter is IRouter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IKuruOrderBook public immutable orderBook;
    address public immutable marginAccount;
    IERC20 public immutable quoteToken;
    IWETH public immutable baseToken; // WMON — what EngineLite holds

    uint32 public immutable pricePrecision;
    uint96 public immutable sizePrecision;
    address public immutable bookBaseAsset; // address(0) for native MON
    address public immutable bookQuoteAsset;

    error Expired();
    error ZeroAmount();
    error InsufficientOutput(uint256 got, uint256 minOut);
    error DecimalsMismatch(uint8 gotQuote, uint8 gotBase);
    error QuoteTokenMismatch(address expected, address got);
    error BaseMustBeWMON();
    error SizeOverflow();
    // NativeTransferFailed removed — WMON.deposit reverts on failure.

    constructor(address orderBook_, address marginAccount_, address quoteToken_, address baseToken_) {
        if (orderBook_ == address(0) || marginAccount_ == address(0) || quoteToken_ == address(0) || baseToken_ == address(0))
        {
            revert ZeroAmount();
        }
        uint8 qDec = IERC20Metadata(quoteToken_).decimals();
        uint8 bDec = IERC20Metadata(baseToken_).decimals();
        if (qDec != 6 || bDec != 18) revert DecimalsMismatch(qDec, bDec);

        (
            uint32 pricePrecision_,
            uint96 sizePrecision_,
            address baseAsset_,
            ,
            address quoteAsset_,
            ,
            ,
            ,
            ,
            ,
        ) = IKuruOrderBook(orderBook_).getMarketParams();

        if (quoteAsset_ != quoteToken_) revert QuoteTokenMismatch(quoteToken_, quoteAsset_);
        // Engine holds WMON. Book base must be native MON so we can wrap.
        if (baseAsset_ != address(0)) revert BaseMustBeWMON();

        orderBook = IKuruOrderBook(orderBook_);
        marginAccount = marginAccount_;
        quoteToken = IERC20(quoteToken_);
        baseToken = IWETH(baseToken_);
        pricePrecision = pricePrecision_;
        sizePrecision = sizePrecision_;
        bookBaseAsset = baseAsset_;
        bookQuoteAsset = quoteAsset_;
    }

    receive() external payable {}

    /// @inheritdoc IRouter
    /// @dev Uses callStatic-equivalent: best-effort via orderBook call simulation
    ///      is not available on-chain; we walk bestAsk as a conservative mark and
    ///      document that keeper minOut must come from off-chain CostEstimator.
    function quoteExactQuoteForBase(uint256 quoteIn) external view returns (uint256 baseOut) {
        if (quoteIn == 0) return 0;
        (, uint256 bestAsk) = orderBook.bestBidAsk();
        // Empty book: ask == 0. Keeper must still supply minOut from off-chain L2.
        if (bestAsk == 0) return 0;
        // humanQuote = quoteIn / 1e6; base ≈ humanQuote * pricePrecision / ask
        // then scale to 18dec: baseOut = quoteIn * 1e12 * pricePrecision / ask
        baseOut = (quoteIn * 1e12 * uint256(pricePrecision)) / bestAsk;
    }

    /// @inheritdoc IRouter
    function quoteExactBaseForQuote(uint256 baseIn) external view returns (uint256 quoteOut) {
        if (baseIn == 0) return 0;
        (uint256 bestBid,) = orderBook.bestBidAsk();
        // Empty book: bid == 0 or type(uint256).max sentinel.
        if (bestBid == 0 || bestBid == type(uint256).max) return 0;
        // humanBase = baseIn / 1e18; quoteOut (6dec) = baseIn * bid / pricePrecision / 1e12
        quoteOut = (baseIn * bestBid) / (uint256(pricePrecision) * 1e12);
    }

    /// @inheritdoc IRouter
    function swapExactQuoteForBase(uint256 quoteIn, uint256 minBaseOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 baseOut)
    {
        if (block.timestamp > deadline) revert Expired();
        if (quoteIn == 0) revert ZeroAmount();
        if (minBaseOut == 0) revert InsufficientOutput(0, minBaseOut);

        quoteToken.safeTransferFrom(msg.sender, address(this), quoteIn);
        quoteToken.forceApprove(address(orderBook), 0);
        quoteToken.forceApprove(address(orderBook), quoteIn);

        uint96 quoteSize = _toQuoteSize(quoteIn);
        // Fill-or-kill: no resting leftover. isMargin=false → wallet path.
        uint256 monOut = orderBook.placeAndExecuteMarketBuy(quoteSize, minBaseOut, false, true);
        if (monOut < minBaseOut) revert InsufficientOutput(monOut, minBaseOut);

        uint256 before = baseToken.balanceOf(address(this));
        baseToken.deposit{value: monOut}();
        baseOut = baseToken.balanceOf(address(this)) - before;
        if (baseOut < minBaseOut) revert InsufficientOutput(baseOut, minBaseOut);

        IERC20(address(baseToken)).safeTransfer(msg.sender, baseOut);
    }

    /// @inheritdoc IRouter
    function swapExactBaseForQuote(uint256 baseIn, uint256 minQuoteOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 quoteOut)
    {
        if (block.timestamp > deadline) revert Expired();
        if (baseIn == 0) revert ZeroAmount();
        if (minQuoteOut == 0) revert InsufficientOutput(0, minQuoteOut);

        IERC20(address(baseToken)).safeTransferFrom(msg.sender, address(this), baseIn);
        baseToken.withdraw(baseIn);

        uint96 size = _toBaseSize(baseIn);
        uint256 before = quoteToken.balanceOf(address(this));
        // Native MON sell: msg.value = wei amount (18dec), size arg = sizePrecision units.
        quoteOut = orderBook.placeAndExecuteMarketSell{value: baseIn}(size, minQuoteOut, false, true);
        uint256 got = quoteToken.balanceOf(address(this)) - before;
        // Prefer balance delta if the return is zero/stale; take the max of both signals.
        if (got > quoteOut) quoteOut = got;
        if (quoteOut < minQuoteOut) revert InsufficientOutput(quoteOut, minQuoteOut);

        quoteToken.safeTransfer(msg.sender, quoteOut);
    }

    /// @dev Kuru market-buy `_quoteSize` is human-quote scaled by pricePrecision
    ///      (see IOC.constructMarketBuyTransaction), not raw 6-dec units.
    function _toQuoteSize(uint256 quoteIn6) internal view returns (uint96) {
        uint256 scaled = (quoteIn6 * uint256(pricePrecision)) / 1e6;
        if (scaled > type(uint96).max) revert SizeOverflow();
        return uint96(scaled);
    }

    /// @dev Kuru market-sell `_size` is human-base scaled by sizePrecision.
    function _toBaseSize(uint256 baseIn18) internal view returns (uint96) {
        uint256 scaled = (baseIn18 * uint256(sizePrecision)) / 1e18;
        if (scaled > type(uint96).max) revert SizeOverflow();
        return uint96(scaled);
    }
}
