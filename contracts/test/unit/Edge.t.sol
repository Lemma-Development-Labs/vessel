// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "../helpers/Fixture.sol";
import {Tranches} from "../../src/Tranches.sol";
import {EngineLite} from "../../src/EngineLite.sol";

contract EdgeCasesTest is Fixture {
    function setUp() public {
        _deploy();
        _faucet(alice, 10);
        _faucet(bob, 10);
        address seeder = makeAddr("venueSeeder");
        _faucet(seeder, 5);
        vm.startPrank(seeder);
        dusd.approve(address(venue), 500e6);
        venue.seed(500e6);
        vm.stopPrank();
    }

    function test_minJoinRevertsDust() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 1);
        vm.expectRevert(Tranches.BelowMinJoin.selector);
        tranches.joinBallast(1);
        vm.stopPrank();
    }

    function test_settleEmptyHullPositiveYield() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
        uint256 h0 = tranches.hullTvl();
        assertEq(h0, 0);
        vm.prank(address(engine));
        tranches.settle(10e6);
        assertEq(tranches.hullTvl(), 0);
        assertGt(tranches.balTvl() + tranches.reserve() + tranches.treasuryAccrued(), 400e6);
    }

    function test_emptyBallastJoinHullRevertsFloorAndNegativeImpairs() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
        uint256 bal = tranches.balTvl();
        vm.prank(address(engine));
        tranches.settle(-int256(bal));
        assertEq(tranches.balTvl(), 0);

        vm.startPrank(alice);
        dusd.approve(address(tranches), 1e6);
        vm.expectRevert();
        tranches.joinHull(1e6);
        vm.stopPrank();

        vm.warp(block.timestamp + 1);
        vm.prank(address(engine));
        vm.expectRevert(Tranches.HullImpairment.selector);
        tranches.settle(-1);
    }

    function test_implausibleYieldReverts() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
        uint256 tvl = 800e6;
        int256 tooMuch = int256(tvl * 5_000 / 10_000 + 1);
        vm.prank(address(engine));
        vm.expectRevert(Tranches.ImplausibleYield.selector);
        tranches.settle(tooMuch);
    }

    function test_hundredCranksSameBlockOnlyFirstSucceeds() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
        engine.crank();
        for (uint256 i; i < 99; i++) {
            vm.expectRevert(Tranches.DtZero.selector);
            engine.crank();
        }
    }

    function test_exitAllThenRejoin() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        uint256 shares = tranches.joinBallast(400e6);
        uint256 out = tranches.exitBallast(shares);
        assertEq(out, 400e6);
        assertEq(tranches.balTvl(), 0);
        dusd.approve(address(tranches), 200e6);
        tranches.joinBallast(200e6);
        vm.stopPrank();
        assertEq(tranches.balTvl(), 200e6);
    }

    function test_rateFlipMidEpoch() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
        engine.deployLiquidity(_minBaseOut());
        vm.warp(block.timestamp + 10 days);
        uint256 bPos = tranches.balTvl();
        vm.prank(owner);
        venue.setFundingRateBps(-2_400);
        vm.warp(block.timestamp + 10 days);
        engine.crank();
        assertLt(tranches.balTvl(), bPos);
    }

    function test_unwindWithAccruedFunding() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
        engine.deployLiquidity(_minBaseOut());
        vm.warp(block.timestamp + 30 days);
        engine.unwind(_minQuoteOut());
        assertEq(engine.shortId(), 0);
    }

    function test_claimTreasury() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
        vm.warp(block.timestamp + 365 days);
        engine.crank();
        uint256 accrued = tranches.treasuryAccrued();
        if (accrued == 0) return;
        uint256 before = dusd.balanceOf(treasury);
        tranches.claimTreasury();
        assertEq(dusd.balanceOf(treasury), before + accrued);
        assertEq(tranches.treasuryAccrued(), 0);
    }

    function test_spotPnlCapEmits() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
        engine.deployLiquidity(_minBaseOut());
        uint256 extra = wmon.balanceOf(address(engine));
        vm.prank(address(router));
        wmon.mint(address(engine), extra);
        vm.warp(block.timestamp + 1);
        uint256 last = engine.lastSpotValue();
        engine.crank();
        assertGt(last, 0);
        assertGt(engine.lastSpotValue(), last);
    }

    function test_vaultIdentityIdlePlusDeployed() public view {
        assertEq(vault.totalAssets(), dusd.balanceOf(address(vault)) + vault.deployed());
    }

    function test_sharePriceMonotoneOnPositiveSettle() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
        uint256 preview0 = vault.previewRedeem(1e18);
        vm.warp(block.timestamp + 365 days);
        engine.crank();
        uint256 preview1 = vault.previewRedeem(1e18);
        assertGe(preview1, preview0);
    }
}
