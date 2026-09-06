// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "../helpers/Fixture.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Tranches} from "../../src/Tranches.sol";
import {EngineLite} from "../../src/EngineLite.sol";
import {Guardian} from "../../src/guards/Guardian.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

    function test_everyMutativeSelectorRevertsWhenPaused() public {
        vm.startPrank(alice);
        dusd.approve(address(vault), 100e6);
        dusd.approve(address(tranches), 100e6);
        vm.expectRevert(BlitzVault.Paused.selector);
        vault.withdraw(1, alice, alice);
        vm.expectRevert(BlitzVault.Paused.selector);
        vault.redeem(1, alice, alice);
        vm.stopPrank();

        // deposit/mint are Tranches-only, so prank as Tranches to reach the pause gate.
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
        vm.prank(address(engine));
        vm.expectRevert(BlitzVault.Paused.selector);
        vault.returnFromEngine(0);
        vm.prank(address(engine));
        vm.expectRevert(BlitzVault.Paused.selector);
        vault.creditYield(1);
        vm.prank(address(engine));
        vm.expectRevert(BlitzVault.Paused.selector);
        vault.notifyLoss(0);

        vm.startPrank(alice);
        vm.expectRevert(Tranches.Paused.selector);
        tranches.joinHull(1e6);
        vm.expectRevert(Tranches.Paused.selector);
        tranches.joinBallast(1e6);
        vm.expectRevert(Tranches.Paused.selector);
        tranches.exitHull(1);
        vm.expectRevert(Tranches.Paused.selector);
        tranches.exitBallast(1);
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
        uint256 minQuoteForExpect = _minQuoteOut();
        vm.expectRevert(EngineLite.Paused.selector);
        engine.unwind(minQuoteForExpect);
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

    function test_setEnginePausedOnFreshVault() public {
        BlitzVault fresh = new BlitzVault(dusd, address(guardian));
        vm.prank(address(this));
        vm.expectRevert(BlitzVault.Paused.selector);
        fresh.setEngine(address(engine));
        vm.expectRevert(BlitzVault.Paused.selector);
        fresh.seedDeadShares(100e6);
        vm.expectRevert(BlitzVault.Paused.selector);
        fresh.setTranches(address(tranches));
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
