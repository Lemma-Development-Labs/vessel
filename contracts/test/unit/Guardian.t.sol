// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "../helpers/Fixture.sol";
import {Guardian} from "../../src/guards/Guardian.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Tranches} from "../../src/Tranches.sol";
import {EngineLite} from "../../src/EngineLite.sol";

contract GuardianTest is Fixture {
    function setUp() public {
        _deploy();
        _faucet(alice, 4);
        _faucet(bob, 4);
    }

    function test_pauseBlocksAllMutative() public {
        vm.prank(owner);
        guardian.pause();

        vm.startPrank(alice);
        dusd.approve(address(tranches), 100e6);
        vm.expectRevert(Tranches.Paused.selector);
        tranches.joinBallast(100e6);
        vm.stopPrank();

        // Pranked as Tranches so this proves the pause gate, not the NotTranches gate.
        vm.prank(address(tranches));
        vm.expectRevert(BlitzVault.Paused.selector);
        vault.deposit(100e6, alice);

        vm.expectRevert(EngineLite.Paused.selector);
        engine.crank();
        uint256 minBaseForExpect = _minBaseOut();
        vm.expectRevert(EngineLite.Paused.selector);
        engine.deployLiquidity(minBaseForExpect);
    }

    function test_viewsWorkWhilePaused() public {
        vm.prank(owner);
        guardian.pause();
        vault.totalAssets();
        tranches.deckStats();
        engine.netDelta();
        engine.netDeltaBps();
        assertTrue(guardian.paused());
    }

    function test_twoStepOwnership() public {
        address next = makeAddr("next");
        vm.prank(owner);
        guardian.transferOwnership(next);
        assertEq(guardian.owner(), owner);
        vm.prank(next);
        guardian.acceptOwnership();
        assertEq(guardian.owner(), next);
        vm.prank(owner);
        vm.expectRevert();
        guardian.pause();
    }

    function test_unpauseRestores() public {
        vm.startPrank(owner);
        guardian.pause();
        guardian.unpause();
        vm.stopPrank();
        vm.startPrank(bob);
        dusd.approve(address(tranches), 200e6);
        tranches.joinBallast(200e6);
        vm.stopPrank();
        assertEq(tranches.balTvl(), 200e6);
    }
}
