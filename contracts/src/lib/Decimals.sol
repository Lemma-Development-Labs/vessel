// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Decimals
/// @notice Single place for dUSD (6) ↔ WMON/WAD (18) conversions.
///         Rounding helpers: Down favors the protocol on payouts; Up is for
///         losses charged to Ballast.
library Decimals {
    uint256 internal constant DUSD_UNIT = 1e6;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant SCALE = 1e12; // 10 ** (18 - 6)

    /// @notice 6-dec dUSD → 18-dec WMON units at 1:1 (sim router).
    function dusdToWmon(uint256 dusdAmount) internal pure returns (uint256) {
        return dusdAmount * SCALE;
    }

    /// @notice 18-dec → 6-dec, rounds down (protocol/senior-favoring on payouts).
    function wmonToDusdDown(uint256 wmonAmount) internal pure returns (uint256) {
        return wmonAmount / SCALE;
    }

    /// @notice 18-dec → 6-dec, rounds up (used when a loss is charged).
    function wmonToDusdUp(uint256 wmonAmount) internal pure returns (uint256) {
        if (wmonAmount == 0) return 0;
        return (wmonAmount + SCALE - 1) / SCALE;
    }
}
