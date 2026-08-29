// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "../helpers/Fixture.sol";
import {Guardian} from "../../src/guards/Guardian.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Tranches} from "../../src/Tranches.sol";
import {MockRouter} from "../../src/mocks/MockRouter.sol";

/// @dev Hits remaining branches so src/ line coverage clears 95% (ex Perpl stub).
contract CoverageBoostTest is Fixture {
    function setUp() public {
        _deploy();
        _faucet(alice, 6);
        _faucet(bob, 6);
    }

    function test_viewsAndPauseIdempotence() public {
        assertEq(wmon.decimals(), 18);
        assertEq(venue.venueName(), "SimVenue");
        assertTrue(venue.isSimulated());
        vm.prank(owner);
        guardian.pause();
        vm.prank(owner);
        vm.expectRevert(Guardian.AlreadyPaused.selector);
        guardian.pause();
        vm.prank(owner);
        guardian.unpause();
        vm.prank(owner);
        vm.expectRevert(Guardian.NotPaused.selector);
        guardian.unpause();
    }

    function test_vaultMintAndReturnZero() public {
        vm.startPrank(alice);
        dusd.approve(address(vault), 10e6);
        uint256 shares = vault.mint(1e12, alice);
        assertGt(shares, 0);
        vm.stopPrank();
        vm.prank(address(engine));
        vault.returnFromEngine(0);
    }

    function test_claimTreasuryAfterFundedSettle() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
        vm.warp(block.timestamp + 365 days);
        vm.prank(address(engine));
        tranches.settle(100e6);
        uint256 accrued = tranches.treasuryAccrued();
        assertGt(accrued, 0);
        uint256 before = dusd.balanceOf(treasury);
        tranches.claimTreasury();
        assertEq(dusd.balanceOf(treasury), before + accrued);
        assertEq(tranches.treasuryAccrued(), 0);
    }

    function test_lossEatsReserve() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 200e6);
        tranches.joinBallast(100e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
        vm.warp(block.timestamp + 365 days);
        vm.prank(address(engine));
        tranches.settle(10e6);
        uint256 b = tranches.balTvl();
        uint256 r = tranches.reserve();
        assertGt(r, 0);
        vm.warp(block.timestamp + 1);
        vm.prank(address(engine));
        tranches.settle(-int256(b + 1));
        assertEq(tranches.balTvl(), 0);
        assertLt(tranches.reserve(), r);
    }

    function test_routerBadPathTwoTokens() public {
        address[] memory path = new address[](2);
        path[0] = address(dusd);
        path[1] = address(dusd);
        vm.expectRevert(MockRouter.BadPath.selector);
        router.getAmountsOut(1e6, path);
        dusd.approve(address(router), 1e6);
        vm.startPrank(alice);
        dusd.approve(address(router), 1e6);
        vm.expectRevert(MockRouter.BadPath.selector);
        router.swapExactTokensForTokens(1e6, 1, path, alice, block.timestamp + 1);
        vm.stopPrank();
    }

    function test_unwindCashLessThanDeployedAndZero() public {
        address seeder = makeAddr("seeder2");
        _faucet(seeder, 3);
        vm.startPrank(seeder);
        dusd.approve(address(venue), 300e6);
        venue.seed(300e6);
        vm.stopPrank();
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
        engine.deployLiquidity();
        uint256 dep = vault.deployed();
        assertGt(dep, 0);
        deal(address(wmon), address(engine), 0);
        deal(address(dusd), address(engine), dep / 2);
        engine.unwind();
        assertEq(engine.shortId(), 0);

        engine.deployLiquidity();
        deal(address(dusd), address(engine), 0);
        deal(address(wmon), address(engine), 0);
        engine.unwind();
        assertEq(vault.deployed(), 0);
    }
}
