// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IGuardian
interface IGuardian {
    /// @notice True when mutative protocol paths must revert.
    function paused() external view returns (bool);
}
