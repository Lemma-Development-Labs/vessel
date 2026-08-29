// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title Guardian
/// @notice Pause switch for Vault / Tranches / Engine mutative paths.
///         Guardian can ONLY pause or unpause. It cannot move funds or change params.
///         Ownership is two-step.
contract Guardian is Ownable2Step {
    bool public paused;

    event Paused(address indexed account);
    event Unpaused(address indexed account);

    error AlreadyPaused();
    error NotPaused();

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Pause mutative protocol paths.
    function pause() external onlyOwner {
        if (paused) revert AlreadyPaused();
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Resume mutative protocol paths.
    function unpause() external onlyOwner {
        if (!paused) revert NotPaused();
        paused = false;
        emit Unpaused(msg.sender);
    }
}
