// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

interface IDemoUSD {
    function faucet() external;
    function approve(address spender, uint256 amount) external returns (bool);
}

interface ITranchesJoin {
    function joinBallast(uint256 assets) external returns (uint256);
    function joinHull(uint256 assets) external returns (uint256);
}

/// @notice Position two demo wallets: Alice on Hull, Bob on Ballast.
contract Seed is Script {
    function run() external {
        _bob();
        _alice();
        console.log("seeded alice hull + bob ballast 100 dUSD each");
    }

    function _bob() internal {
        uint256 bobPk = vm.envUint("BOB_PK");
        address dusd = vm.envAddress("DUSD");
        address t = vm.envAddress("TRANCHES");
        vm.startBroadcast(bobPk);
        IDemoUSD(dusd).faucet();
        IDemoUSD(dusd).approve(t, 100e6);
        ITranchesJoin(t).joinBallast(100e6);
        vm.stopBroadcast();
    }

    function _alice() internal {
        uint256 alicePk = vm.envUint("ALICE_PK");
        address dusd = vm.envAddress("DUSD");
        address t = vm.envAddress("TRANCHES");
        vm.startBroadcast(alicePk);
        IDemoUSD(dusd).faucet();
        IDemoUSD(dusd).approve(t, 100e6);
        ITranchesJoin(t).joinHull(100e6);
        vm.stopBroadcast();
    }
}
