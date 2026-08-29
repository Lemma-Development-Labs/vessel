// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DemoUSD} from "../../src/DemoUSD.sol";
import {Guardian} from "../../src/guards/Guardian.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Tranches} from "../../src/Tranches.sol";

contract RoundingTest is Test {
    DemoUSD internal dusd;
    Guardian internal guardian;
    BlitzVault internal vault;
    Tranches internal tranches;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        dusd = new DemoUSD();
        guardian = new Guardian(address(this));
        vault = new BlitzVault(dusd, address(guardian));
        tranches = new Tranches(address(vault), address(guardian), treasury);
        vault.setEngine(address(this));
        tranches.setEngine(address(this));
        dusd.faucet();
        dusd.approve(address(vault), 100e6);
        vault.seedDeadShares(100e6);
        vault.setTranches(address(tranches));
        _fill(alice, 5);
        _fill(bob, 5);
    }

    function _fill(address user, uint256 times) internal {
        uint256 t = block.timestamp;
        for (uint256 i; i < times; i++) {
            t += 1 hours;
            vm.warp(t);
            vm.prank(user);
            dusd.faucet();
        }
    }

    function test_shareMintFloorsAt1Wei() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 3e6);
        tranches.joinBallast(3e6);
        vm.stopPrank();

        uint256 supply = tranches.ballastToken().totalSupply();
        uint256 tvl = tranches.balTvl();
        uint256 assets = 1e6 + 1;
        uint256 expected = (assets * supply) / tvl; // floor
        vm.startPrank(alice);
        dusd.approve(address(tranches), assets);
        uint256 got = tranches.joinBallast(assets);
        vm.stopPrank();
        assertEq(got, expected);
        assertLt(got * tvl, assets * supply + supply); // classic floor remainder
    }

    function test_shareBurnFloorsAssetsOut() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 3e6);
        uint256 shares = tranches.joinBallast(3e6);
        uint256 out = tranches.exitBallast(1);
        vm.stopPrank();
        uint256 naive = (1 * 3e6) / shares;
        assertEq(out, naive);
        assertEq(out, 0); // 1 share of 3e6*1e12 supply is dust — floors to 0
    }

    function test_feeCeilsAt1WeiGross() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);

        uint256 t0 = tranches.treasuryAccrued();
        uint256 r0 = tranches.reserve();
        tranches.settle(1);
        // ceil(1 * 1000 / 10000) = 1. Remainder 0. Fee split: toReserve 0, treasury 1.
        assertEq(tranches.treasuryAccrued() + tranches.reserve() - t0 - r0, 1);
        assertEq(
            int256(tranches.hullTvl()) + int256(tranches.balTvl()) + int256(tranches.reserve())
                + int256(tranches.treasuryAccrued()) - int256(400e6 + 400e6 + t0 + r0),
            1
        );
    }

    function test_hullAccrualFloors() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
        vm.warp(tranches.lastSettle() + 1);
        uint256 h0 = tranches.hullTvl();
        tranches.settle(100e6);
        uint256 hullTarget = (uint256(400e6) * 800 * 1) / (10_000 * uint256(365 days));
        assertEq(tranches.hullTvl() - h0, hullTarget);
    }

    function test_lossAgainstBallastTakesFullWei() public {
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
        uint256 b0 = tranches.balTvl();
        uint256 h0 = tranches.hullTvl();
        tranches.settle(-1);
        assertEq(tranches.balTvl(), b0 - 1);
        assertEq(tranches.hullTvl(), h0);
    }
}
