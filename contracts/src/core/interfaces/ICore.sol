// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPauseGuardian {
    function isPaused(uint8 dim) external view returns (bool);
}

/// @notice Strategy engine as seen by the core. Its value must come from verifiable venue state
///         and vetted prices (ValuationAdapter, Session 3) — never from keeper-supplied numbers.
interface IStrategyEngine {
    /// @return usdcValue value of assets held by the engine, in USDC base units
    /// @return observedAt timestamp of the observation the value is derived from
    function value() external view returns (uint256 usdcValue, uint256 observedAt);

    /// @notice Send `amount` USDC back to AssetCustody (the only permitted destination).
    function release(uint256 amount) external;

    /// @notice Called by AssetCustody immediately after transferring `amount` to the engine, so the
    ///         engine attributes exactly that amount to the book. Tokens sent any other way are
    ///         not the book's and must never be valued as it.
    function credit(uint256 amount) external;
}
