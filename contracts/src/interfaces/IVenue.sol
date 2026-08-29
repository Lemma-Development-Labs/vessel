// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IVenue
/// @notice Hedge venue interface. SimVenue implements this today; PerplVenue.stub is the live-market successor.
interface IVenue {
    /// @notice Open a short of `notional` (dUSD, 6 decimals). Returns a position id.
    function openShort(uint256 notional) external returns (uint256 id);

    /// @notice Close position `id`. Returns realized PnL in dUSD (6 decimals, signed).
    function closeShort(uint256 id) external returns (int256 pnl);

    /// @notice Current notional and unrealized funding for `id`.
    function position(uint256 id) external view returns (uint256 notional, int256 fundingAccrued);

    /// @notice Realize funding since last sweep into the caller. Positive = venue pays engine.
    function sweepFunding(uint256 id) external returns (int256 realized);

    /// @notice Human-readable venue name.
    function venueName() external view returns (string memory);

    /// @notice True when this venue is a simulation (not a live perp market).
    function isSimulated() external view returns (bool);
}
