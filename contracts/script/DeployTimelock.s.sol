// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Script, console} from "forge-std/Script.sol";

/// @title DeployTimelock
/// @notice Deploys OZ TimelockController for Guardian ownership + future param ops.
/// @dev Gate 2: transfer Guardian ownership to this timelock after verifying proposers/executors
///      are independent Safe signers — not three keys on one laptop.
///
/// Env:
///   DEPLOYER_PK
///   TIMELOCK_MIN_DELAY   (seconds, default 2 days)
///   TIMELOCK_PROPOSERS   (comma-separated; default = broadcaster)
///   TIMELOCK_EXECUTORS   (comma-separated; default = address(0) = anyone)
contract DeployTimelock is Script {
    function run() external returns (TimelockController tl) {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);
        uint256 minDelay = vm.envOr("TIMELOCK_MIN_DELAY", uint256(2 days));

        address[] memory proposers = new address[](1);
        proposers[0] = vm.envOr("TIMELOCK_PROPOSER", deployer);
        address[] memory executors = new address[](1);
        // address(0) = open execution once the delay elapses (OZ convention).
        executors[0] = vm.envOr("TIMELOCK_EXECUTOR", address(0));

        vm.startBroadcast(pk);
        tl = new TimelockController(minDelay, proposers, executors, deployer);
        vm.stopBroadcast();

        console.log("TimelockController", address(tl));
        console.log("minDelay", minDelay);
        console.log("proposer", proposers[0]);
        console.log("Next: Guardian.transferOwnership(timelock) then accept via schedule/execute");
    }
}
