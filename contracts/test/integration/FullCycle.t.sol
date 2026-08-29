// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "../helpers/Fixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FullCycleTest is Fixture {
    function setUp() public {
        _deploy();
        _faucet(alice, 10);
        _faucet(bob, 10);
        // Seed sim venue pot from a third wallet's faucet drip (owner has no dUSD).
        address seeder = makeAddr("seeder");
        _faucet(seeder, 5); // 500 dUSD
        vm.startPrank(seeder);
        dusd.approve(address(venue), 500e6);
        venue.seed(500e6);
        vm.stopPrank();
    }

    function test_fullCycleBalancesToWei() public {
        // Ballast first so hull can join without floor revert.
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        uint256 balShares = tranches.joinBallast(400e6);
        vm.stopPrank();

        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        uint256 hullShares = tranches.joinHull(400e6);
        vm.stopPrank();

        assertEq(tranches.hullTvl(), 400e6);
        assertEq(tranches.balTvl(), 400e6);
        assertEq(vault.totalAssets(), 900e6); // 800 user + 100 dead seed

        uint256 deployable = vault.deployable();
        assertEq(deployable, 810e6);

        engine.deployLiquidity();
        assertEq(vault.deployed(), 810e6);
        assertEq(engine.shortId(), 1);
        assertEq(engine.netDelta(), 0);

        vm.warp(block.timestamp + 30 days);
        engine.crank(); // positive sim funding

        // Bad day
        vm.prank(owner);
        venue.setFundingRateBps(-2_400);
        vm.warp(block.timestamp + 7 days);
        engine.crank();

        engine.unwind();
        assertEq(engine.shortId(), 0);
        assertEq(IERC20(address(wmon)).balanceOf(address(engine)), 0);

        vm.prank(alice);
        uint256 hullOut = tranches.exitHull(hullShares);
        vm.prank(bob);
        uint256 balOut = tranches.exitBallast(balShares);

        assertGt(hullOut, 0);
        assertGt(balOut, 0);
        // Reserve + treasury stay in the vault; decks are empty.
        assertLe(tranches.hullTvl(), 1);
        assertLe(tranches.balTvl(), 1);
        assertApproxEqAbs(vault.totalAssets(), tranches.reserve() + tranches.treasuryAccrued() + 100e6, 10);
    }
}
