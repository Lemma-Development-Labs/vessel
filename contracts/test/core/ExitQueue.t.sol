// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PauseGuardian} from "../../src/core/governance/PauseGuardian.sol";
import {BallastToken} from "../../src/core/BallastToken.sol";
import {IPauseGuardian, IStrategyEngine} from "../../src/core/interfaces/ICore.sol";
import {TrancheController} from "../../src/core/TrancheController.sol";
import {TestUSDC, TestEngine} from "../fixtures/CoreFixtures.sol";

/// @notice Exit queue: cancelled entries cannot make batches unbounded, and an unmet holder minimum
///         returns the units instead of stranding them behind the queue head.
contract ExitQueueTest is Test {
    address governance = makeAddr("governance");
    address operator = makeAddr("operator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    TrancheController c;
    TestUSDC usdc;
    BallastToken ballast;

    function setUp() public {
        vm.warp(1_790_000_000);
        usdc = new TestUSDC();
        PauseGuardian pauses = new PauseGuardian(makeAddr("guardian"), governance);
        c = new TrancheController(
            usdc, IPauseGuardian(address(pauses)), governance, operator, makeAddr("treasury"), 1e12, 1
        );
        TestEngine engine = new TestEngine(usdc);
        engine.setCustody(address(c.custody()));
        ballast = c.ballast();
        vm.startPrank(governance);
        c.setEngine(IStrategyEngine(address(engine)));
        c.setStageCap(10_000e6);
        c.setAllowance(alice, 5_000e6);
        c.setAllowance(bob, 5_000e6);
        vm.stopPrank();
        _deposit(alice, 1_000e6);
        _deposit(bob, 1_000e6);
        c.processDepositBatch(10);
    }

    function _deposit(address who, uint256 assets) internal {
        usdc.mint(who, assets);
        vm.startPrank(who);
        usdc.approve(address(c.custody()), assets);
        c.requestDeposit(TrancheController.Tranche.BALLAST, 0, assets, who, 0, block.timestamp + 1 days);
        vm.stopPrank();
    }

    function test_requestCancelFloodCannotBlockExits() public {
        vm.startPrank(alice);
        for (uint256 k; k < 300; k++) {
            uint256 id = c.requestBallastRedeem(1, alice, 0);
            c.cancelRedeem(id);
        }
        vm.stopPrank();
        uint256 bobUnits = ballast.balanceOf(bob);
        vm.prank(bob);
        uint256 bobExit = c.requestBallastRedeem(bobUnits, bob, 0);
        vm.warp(block.timestamp + 48 hours + 1);
        uint256 calls;
        while (ballast.balanceOf(bob) > 0) {
            uint256 g = gasleft();
            c.processExitBatch(10);
            assertLe(g - gasleft(), 2_000_000, "a batch stays bounded");
            if (++calls > 40) revert("exit never reached");
        }
        (,,, TrancheController.ExitStatus status,,,) = c.exits(bobExit);
        assertEq(uint8(status), uint8(TrancheController.ExitStatus.FUNDED));
    }

    function test_unmetMinimumReturnsUnitsAndDoesNotBlock() public {
        uint256 aliceUnits = ballast.balanceOf(alice);
        vm.prank(alice);
        uint256 aliceExit = c.requestBallastRedeem(aliceUnits, alice, 2_000e6);
        uint256 bobUnits = ballast.balanceOf(bob);
        vm.prank(bob);
        uint256 bobExit = c.requestBallastRedeem(bobUnits, bob, 0);
        vm.warp(block.timestamp + 48 hours + 1);
        c.processExitBatch(10);
        (,,, TrancheController.ExitStatus sa,,,) = c.exits(aliceExit);
        assertEq(uint8(sa), uint8(TrancheController.ExitStatus.CANCELLED));
        assertEq(ballast.lockedOf(alice), 0);
        assertEq(ballast.balanceOf(alice), aliceUnits);
        (,,, TrancheController.ExitStatus sb,,,) = c.exits(bobExit);
        assertEq(uint8(sb), uint8(TrancheController.ExitStatus.FUNDED));
    }
}
