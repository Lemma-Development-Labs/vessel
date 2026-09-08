// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISpotOracle} from "../interfaces/ISpotOracle.sol";

/// @title ManualTwapOracle
/// @notice Keeper-/CRE-pushed TWAP observation for spot mark.
/// @dev Not a Chainlink feed. Operator must push within `maxStale`. Gate 1
///      accepts this only until a native Monad TWAP/oracle product is wired.
///      `isSimulated`-style honesty: `oracleName` discloses "ManualTwapOracle".
contract ManualTwapOracle is ISpotOracle {
    address public immutable updater;
    uint256 public immutable maxStale;
    uint8 public immutable baseDecimals; // 18 for WMON
    uint8 public immutable quoteDecimals; // 6 for USDC

    /// @notice Quote units (1equoteDecimals) per 1 base token (1ebaseDecimals).
    uint256 public priceQuotePerBase;
    uint256 public updatedAt;

    error ZeroAddress();
    error NotUpdater();
    error ZeroPrice();
    error Stale();

    event PriceUpdated(uint256 priceQuotePerBase, uint256 updatedAt);

    constructor(address updater_, uint256 maxStale_, uint8 baseDecimals_, uint8 quoteDecimals_) {
        if (updater_ == address(0)) revert ZeroAddress();
        if (maxStale_ == 0) revert ZeroPrice();
        updater = updater_;
        maxStale = maxStale_;
        baseDecimals = baseDecimals_;
        quoteDecimals = quoteDecimals_;
    }

    function pushPrice(uint256 priceQuotePerBase_) external {
        if (msg.sender != updater) revert NotUpdater();
        if (priceQuotePerBase_ == 0) revert ZeroPrice();
        priceQuotePerBase = priceQuotePerBase_;
        updatedAt = block.timestamp;
        emit PriceUpdated(priceQuotePerBase_, updatedAt);
    }

    /// @inheritdoc ISpotOracle
    function quoteBaseInQuote(uint256 baseAmount) external view returns (uint256) {
        if (isStale()) revert Stale();
        if (baseAmount == 0) return 0;
        // quote = base * price / 10^baseDecimals
        return (baseAmount * priceQuotePerBase) / (10 ** uint256(baseDecimals));
    }

    /// @inheritdoc ISpotOracle
    function isStale() public view returns (bool) {
        if (updatedAt == 0) return true;
        return block.timestamp - updatedAt > maxStale;
    }

    /// @inheritdoc ISpotOracle
    function oracleName() external pure returns (string memory) {
        return "ManualTwapOracle";
    }
}
