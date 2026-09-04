// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IKuruOrderBook
/// @notice Slice of the Kuru OrderBook ABI used by KuruRouter.
/// @dev Signatures from the compiled OrderBook artifact in `@kuru-labs/kuru-sdk`
///      (abi/OrderBook.json). Docs page shortens `_minAmountOut` to `uint96` and
///      omits the return — the artifact is authoritative for calls.
interface IKuruOrderBook {
    function getMarketParams()
        external
        view
        returns (
            uint32 pricePrecision,
            uint96 sizePrecision,
            address baseAsset,
            uint256 baseAssetDecimals,
            address quoteAsset,
            uint256 quoteAssetDecimals,
            uint32 tickSize,
            uint96 minSize,
            uint96 maxSize,
            uint256 takerFeeBps,
            uint256 makerFeeBps
        );

    /// @dev Artifact returns uint256. Empty book conventionally uses max bid / zero ask.
    function bestBidAsk() external view returns (uint256 bestBid, uint256 bestAsk);

    /// @return baseOut Amount of base asset received (18-dec when base is MON).
    function placeAndExecuteMarketBuy(uint96 quoteSize, uint256 minAmountOut, bool isMargin, bool isFillOrKill)
        external
        payable
        returns (uint256 baseOut);

    /// @return quoteOut Amount of quote asset received (6-dec when quote is USDC).
    function placeAndExecuteMarketSell(uint96 size, uint256 minAmountOut, bool isMargin, bool isFillOrKill)
        external
        payable
        returns (uint256 quoteOut);
}
