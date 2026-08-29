// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DemoUSD} from "../src/DemoUSD.sol";
import {Tranches} from "../src/Tranches.sol";

/// @notice Position two demo wallets: Alice on Hull, Bob on Ballast.
///         Each account must have already faucet'd enough dUSD (lifetime cap 1,000).
contract Seed is Script {
    function run() external {
        uint256 alicePk = vm.envUint("ALICE_PK");
        uint256 bobPk = vm.envUint("BOB_PK");
        address dusd = vm.envAddress("DUSD");
        address tranchesAddr = vm.envAddress("TRANCHES");
        Tranches tranches = Tranches(tranchesAddr);

        vm.startBroadcast(bobPk);
        DemoUSD(dusd).faucet();
        DemoUSD(dusd).approve(tranchesAddr, 100e6);
        tranches.joinBallast(100e6);
        vm.stopBroadcast();

        vm.startBroadcast(alicePk);
        DemoUSD(dusd).faucet();
        DemoUSD(dusd).approve(tranchesAddr, 100e6);
        tranches.joinHull(100e6);
        vm.stopBroadcast();

        console.log("seeded alice hull + bob ballast 100 dUSD each");
    }
}
