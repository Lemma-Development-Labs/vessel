// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISpotOracle} from "../interfaces/ISpotOracle.sol";
import {IRouter} from "../interfaces/IRouter.sol";

/// @title RouterMidOracle
/// @notice Default mark = IRouter mid. Honest label: this is NOT a TWAP.
/// @dev Use only behind SPOT_PNL_CAP on testnet. Replace with TwapOracle before
///      mainnet size (Gate 1).
contract RouterMidOracle is ISpotOracle {
    IRouter public immutable router;

    error ZeroAddress();

    constructor(address router_) {
        if (router_ == address(0)) revert ZeroAddress();
        router = IRouter(router_);
    }

    /// @inheritdoc ISpotOracle
    function quoteBaseInQuote(uint256 baseAmount) external view returns (uint256) {
        if (baseAmount == 0) return 0;
        return router.quoteExactBaseForQuote(baseAmount);
    }

    /// @inheritdoc ISpotOracle
    function isStale() external pure returns (bool) {
        return false;
    }

    /// @inheritdoc ISpotOracle
    function oracleName() external pure returns (string memory) {
        return "RouterMidOracle";
    }
}
