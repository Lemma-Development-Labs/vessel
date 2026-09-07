// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVenue} from "../interfaces/IVenue.sol";

/// @title PerplVenue
/// @notice Skeleton for the live Perpl hedge. Swap = replace SimVenue with this
///         contract once PerplFoundation/api-docs is wired.
/// @dev TODOs:
///      - Read PerplFoundation/api-docs for position open/close + funding
///      - Map openShort notional (dUSD 6dec) onto Perpl's perp market size
///      - Map closeShort / sweepFunding onto Perpl settle + funding harvest
///      - isSimulated() MUST return false ONLY in the live implementation.
///        This stub returns true so UI / chips never treat NotImplemented as live.
contract PerplVenue is IVenue {
    error NotImplemented();

    /// @inheritdoc IVenue
    function openShort(uint256) external pure returns (uint256) {
        revert NotImplemented();
    }

    /// @inheritdoc IVenue
    function closeShort(uint256) external pure returns (int256) {
        revert NotImplemented();
    }

    /// @inheritdoc IVenue
    function position(uint256) external pure returns (uint256, int256) {
        revert NotImplemented();
    }

    /// @inheritdoc IVenue
    function sweepFunding(uint256) external pure returns (int256) {
        revert NotImplemented();
    }

    /// @inheritdoc IVenue
    function venueName() external pure returns (string memory) {
        return "PerplVenue";
    }

    /// @inheritdoc IVenue
    /// @dev Stub is not a live hedge. Returning false here was a honesty bug.
    function isSimulated() external pure returns (bool) {
        return true;
    }
}
