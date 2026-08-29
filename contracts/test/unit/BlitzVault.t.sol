// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "../helpers/Fixture.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Guardian} from "../../src/guards/Guardian.sol";

contract BlitzVaultTest is Fixture {
    function setUp() public {
        _deploy();
        _faucet(alice, 5);
    }

    function test_deployableIs90Percent() public {
        vm.startPrank(alice);
        dusd.approve(address(vault), 500e6);
        vault.deposit(500e6, alice);
        vm.stopPrank();
        assertEq(vault.deployable(), 450e6);
        assertEq(vault.deployed(), 0);
    }

    function test_wireOnce() public {
        vm.prank(owner);
        vm.expectRevert(BlitzVault.EngineAlreadySet.selector);
        vault.setEngine(address(1));
    }

    function test_onlyEnginePulls() public {
        vm.startPrank(alice);
        dusd.approve(address(vault), 100e6);
        vault.deposit(100e6, alice);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(BlitzVault.NotEngine.selector);
        vault.pullForEngine(10e6);
    }

    function test_pauseBlocksDeposit() public {
        vm.prank(owner);
        guardian.pause();
        vm.startPrank(alice);
        dusd.approve(address(vault), 100e6);
        vm.expectRevert(BlitzVault.Paused.selector);
        vault.deposit(100e6, alice);
        vm.stopPrank();
    }

    function test_guardianCannotSetEngine() public {
        // Guardian has no setEngine. Owner already wired. Guardian pause is the only knob.
        assertEq(vault.engine(), address(engine));
        vm.prank(address(guardian));
        vm.expectRevert(BlitzVault.NotDeployer.selector);
        vault.setEngine(address(2));
    }
}
