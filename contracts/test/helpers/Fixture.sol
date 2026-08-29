// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DemoUSD} from "../../src/DemoUSD.sol";
import {Guardian} from "../../src/guards/Guardian.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Tranches} from "../../src/Tranches.sol";
import {SimVenue} from "../../src/venues/SimVenue.sol";
import {EngineLite} from "../../src/EngineLite.sol";
import {MockWMON} from "../../src/mocks/MockWMON.sol";
import {MockRouter} from "../../src/mocks/MockRouter.sol";

contract Fixture is Test {
    DemoUSD internal dusd;
    Guardian internal guardian;
    BlitzVault internal vault;
    Tranches internal tranches;
    SimVenue internal venue;
    EngineLite internal engine;
    MockWMON internal wmon;
    MockRouter internal router;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");

    function _deploy() internal {
        vm.startPrank(owner);
        dusd = new DemoUSD();
        guardian = new Guardian(owner);
        vault = new BlitzVault(dusd, address(guardian));
        tranches = new Tranches(address(vault), address(guardian), treasury);
        venue = new SimVenue(address(dusd));
        wmon = new MockWMON();
        router = new MockRouter(address(dusd), address(wmon));
        wmon.setRouter(address(router));
        engine = new EngineLite(address(guardian));
        vault.setEngine(address(engine));
        tranches.setEngine(address(engine));
        engine.wire(address(vault), address(tranches), address(venue), address(router), address(wmon));
        vm.stopPrank();
    }

    function _faucet(address user, uint256 times) internal {
        uint256 t = block.timestamp;
        for (uint256 i; i < times; i++) {
            t += 1 hours;
            vm.warp(t);
            vm.prank(user);
            dusd.faucet();
        }
    }

    function _approveTranches(address user, uint256 amount) internal {
        vm.prank(user);
        dusd.approve(address(tranches), amount);
    }
}
