// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Controllable stand-in for the Kuru OrderBook used in fork/unit tests of
///      KuruRouter. Fills at a fixed price with optional taker fee bps.
contract MockKuruBook {
    using SafeERC20 for IERC20;

    uint32 public pricePrecision;
    uint96 public sizePrecision;
    address public baseAsset; // address(0) = native MON
    uint256 public baseAssetDecimals = 18;
    address public quoteAsset;
    uint256 public quoteAssetDecimals = 6;
    uint32 public tickSize = 1;
    uint96 public minSize = 1;
    uint96 public maxSize = type(uint96).max;
    uint256 public takerFeeBps;
    uint256 public makerFeeBps;

    uint256 public bestBid;
    uint256 public bestAsk;

    error InsufficientLiquidity();
    error MinOutUnmet(uint256 got, uint256 minOut);

    constructor(address quoteAsset_, uint32 pricePrecision_, uint96 sizePrecision_) {
        quoteAsset = quoteAsset_;
        pricePrecision = pricePrecision_;
        sizePrecision = sizePrecision_;
        // Default 1.0 quote per base in pricePrecision units.
        bestBid = pricePrecision_;
        bestAsk = pricePrecision_;
    }

    receive() external payable {}

    function setBestBidAsk(uint256 bid, uint256 ask) external {
        bestBid = bid;
        bestAsk = ask;
    }

    function setTakerFeeBps(uint256 bps) external {
        takerFeeBps = bps;
    }

    function getMarketParams()
        external
        view
        returns (
            uint32,
            uint96,
            address,
            uint256,
            address,
            uint256,
            uint32,
            uint96,
            uint96,
            uint256,
            uint256
        )
    {
        return (
            pricePrecision,
            sizePrecision,
            baseAsset,
            baseAssetDecimals,
            quoteAsset,
            quoteAssetDecimals,
            tickSize,
            minSize,
            maxSize,
            takerFeeBps,
            makerFeeBps
        );
    }

    function bestBidAsk() external view returns (uint256, uint256) {
        return (bestBid, bestAsk);
    }

    /// @param quoteSize humanQuote * pricePrecision (Kuru market-buy units)
    function placeAndExecuteMarketBuy(uint96 quoteSize, uint256 minAmountOut, bool, bool)
        external
        payable
        returns (uint256 baseOut)
    {
        if (bestAsk == 0) revert InsufficientLiquidity();
        // humanQuote = quoteSize / pricePrecision; pull raw 6dec = human * 1e6
        uint256 quoteIn6 = (uint256(quoteSize) * 1e6) / uint256(pricePrecision);
        IERC20(quoteAsset).safeTransferFrom(msg.sender, address(this), quoteIn6);
        // baseOut 18dec ≈ humanQuote * 1e18 * pricePrecision / ask
        baseOut = (quoteIn6 * 1e12 * uint256(pricePrecision)) / bestAsk;
        if (takerFeeBps > 0) {
            baseOut = (baseOut * (10_000 - takerFeeBps)) / 10_000;
        }
        if (baseOut < minAmountOut) revert MinOutUnmet(baseOut, minAmountOut);
        (bool ok,) = payable(msg.sender).call{value: baseOut}("");
        require(ok, "mon");
    }

    /// @param size humanBase * sizePrecision
    function placeAndExecuteMarketSell(uint96 size, uint256 minAmountOut, bool, bool)
        external
        payable
        returns (uint256 quoteOut)
    {
        if (bestBid == 0 || bestBid == type(uint256).max) revert InsufficientLiquidity();
        require(msg.value > 0, "value");
        // Prefer msg.value (18dec wei) as the true size; `size` is for API parity.
        uint256 baseIn = msg.value;
        // quoteOut 6dec = baseIn * bid / pricePrecision / 1e12
        quoteOut = (baseIn * bestBid) / (uint256(pricePrecision) * 1e12);
        if (takerFeeBps > 0) {
            quoteOut = (quoteOut * (10_000 - takerFeeBps)) / 10_000;
        }
        if (quoteOut < minAmountOut) revert MinOutUnmet(quoteOut, minAmountOut);
        // silence unused size when value path is authoritative
        size;
        IERC20(quoteAsset).safeTransfer(msg.sender, quoteOut);
    }
}
