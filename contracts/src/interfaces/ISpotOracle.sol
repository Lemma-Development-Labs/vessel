// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISpotOracle
/// @notice Marks base (WMON) inventory in quote (vault asset) units.
/// @dev Router mid is manipulable. Mainnet must wire a TWAP / independent feed
///      and keep SPOT_PNL_CAP as a second line of defence — not the only one.
interface ISpotOracle {
    /// @return quoteAmount Vault-asset units (6dec for USDC / DemoUSD) for `baseAmount` of WMON.
    function quoteBaseInQuote(uint256 baseAmount) external view returns (uint256 quoteAmount);

    /// @return True when the feed must not be used for settle (stale / unset).
    function isStale() external view returns (bool);

    function oracleName() external view returns (string memory);
}
