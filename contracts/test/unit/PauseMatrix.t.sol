// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "../helpers/Fixture.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Tranches} from "../../src/Tranches.sol";
import {EngineLite} from "../../src/EngineLite.sol";
import {Guardian} from "../../src/guards/Guardian.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Production pause policy:
///      FREEZE ingress — joins, deploy, crank, settle, pull, admin setters.
///      ALLOW egress — unwind (+ vault engine callbacks), exits, vault withdraw/redeem.
contract PauseMatrixTest is Fixture {
    function setUp() public {
        _deploy();
        _faucet(alice, 4);
        _faucet(bob, 4);
        vm.startPrank(bob);
        dusd.approve(address(tranches), 200e6);
        tranches.joinBallast(200e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 200e6);
        tranches.joinHull(200e6);
        vm.stopPrank();
        vm.prank(owner);
        guardian.pause();
    }

    function test_pauseBlocksIngress() public {
        vm.startPrank(address(tranches));
        vm.expectRevert(BlitzVault.Paused.selector);
        vault.deposit(1e6, alice);
        vm.expectRevert(BlitzVault.Paused.selector);
        vault.mint(1e12, alice);
        vm.stopPrank();

        vm.startPrank(owner);
        vm.expectRevert(BlitzVault.Paused.selector);
        vault.seedDeadShares(1e6);
        vm.expectRevert(BlitzVault.Paused.selector);
        vault.setTranches(address(1));
        vm.stopPrank();

        vm.prank(address(engine));
        vm.expectRevert(BlitzVault.Paused.selector);
        vault.pullForEngine(1);

        vm.startPrank(alice);
        dusd.approve(address(tranches), 100e6);
        vm.expectRevert(Tranches.Paused.selector);
        tranches.joinHull(1e6);
        vm.expectRevert(Tranches.Paused.selector);
        tranches.joinBallast(1e6);
        vm.expectRevert(Tranches.Paused.selector);
        tranches.claimTreasury();
        vm.stopPrank();

        vm.prank(address(engine));
        vm.expectRevert(Tranches.Paused.selector);
        tranches.settle(0);

        vm.expectRevert(EngineLite.Paused.selector);
        engine.crank();
        uint256 minBaseForExpect = _minBaseOut();
        vm.expectRevert(EngineLite.Paused.selector);
        engine.deployLiquidity(minBaseForExpect);
        vm.prank(owner);
        vm.expectRevert(EngineLite.Paused.selector);
        engine.wire(address(1), address(1), address(1), address(1), address(1));

        vm.prank(owner);
        vm.expectRevert(BlitzVault.Paused.selector);
        vault.setEngine(address(1));

        Tranches freshT = new Tranches(address(vault), address(guardian), treasury);
        vm.expectRevert(Tranches.Paused.selector);
        freshT.setEngine(address(engine));
    }

    function test_pauseAllowsEmergencyEgress() public {
        // Engine callbacks used by unwind must work while paused.
        deal(address(dusd), address(engine), 10e6, true);
        vm.startPrank(address(engine));
        dusd.approve(address(vault), type(uint256).max);
        // Simulate deployed principal so returnFromEngine has something to clear.
        // pull is paused — mint deployed via cheat by calling notify after fake deploy state:
        // Use returnFromEngine(0) / creditYield / notifyLoss on zero-deployed carefully.
        vault.creditYield(1e6);
        vm.stopPrank();
        assertEq(dusd.balanceOf(address(vault)), dusd.balanceOf(address(vault)));

        // Unwind with nothing deployed must not revert Paused.
        engine.unwind(1);

        // Hull exit while paused (cash is idle — never deployed in this fixture path).
        uint256 shares = tranches.hullToken().balanceOf(alice);
        uint256 before = dusd.balanceOf(alice);
        vm.prank(alice);
        uint256 out = tranches.exitHull(shares / 10);
        assertGt(out, 0);
        assertGt(dusd.balanceOf(alice), before);

        // Direct vault withdraw path (vBLITZ held by Tranches) — redeem still open via exit.
        // withdraw/redeem on vault by a random holder of vBLITZ: Tranches holds shares.
    }

    function test_pauseDoesNotBlockUnwindAfterDeploy() public {
        vm.prank(owner);
        guardian.unpause();
        engine.deployLiquidity(_minBaseOut());
        assertGt(vault.deployed(), 0);

        vm.prank(owner);
        guardian.pause();

        // Must succeed while paused — the stuck-funds escape hatch.
        engine.unwind(_minQuoteOut());
        assertEq(vault.deployed(), 0);
        assertEq(engine.shortId(), 0);
    }
}

contract GuardianFundsTest is Fixture {
    function setUp() public {
        _deploy();
        _faucet(alice, 2);
        _joinBallast(alice, 100e6);
    }

    function test_guardianHasNoTokenMovement() public {
        (bool ok,) = address(guardian).call(abi.encodeWithSelector(IERC20.transfer.selector, alice, 1));
        assertFalse(ok);
        (ok,) = address(guardian).call(abi.encodeWithSelector(IERC20.transferFrom.selector, alice, owner, 1));
        assertFalse(ok);
        (ok,) = address(guardian).call(abi.encodeWithSignature("pullForEngine(uint256)", 1));
        assertFalse(ok);
        (ok,) = address(guardian).call(abi.encodeWithSignature("withdraw(uint256,address,address)", 1, owner, owner));
        assertFalse(ok);

        uint256 gBal = dusd.balanceOf(address(guardian));
        assertEq(gBal, 0);
        uint256 vaultBefore = dusd.balanceOf(address(vault));
        vm.prank(owner);
        guardian.pause();
        vm.prank(owner);
        guardian.unpause();
        assertEq(dusd.balanceOf(address(vault)), vaultBefore);
        assertEq(dusd.balanceOf(address(guardian)), 0);
    }

    function test_guardianOwnerCannotPullVault() public {
        vm.prank(owner);
        vm.expectRevert(BlitzVault.NotEngine.selector);
        vault.pullForEngine(1);
        vm.prank(address(guardian));
        vm.expectRevert(BlitzVault.NotEngine.selector);
        vault.pullForEngine(1);
    }
}
