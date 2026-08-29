// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DemoUSD} from "../../src/DemoUSD.sol";
import {Guardian} from "../../src/guards/Guardian.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Tranches} from "../../src/Tranches.sol";

/// @dev Tranches unit tests with the test contract as Engine so we can settle directly.
contract TranchesTest is Test {
    DemoUSD internal dusd;
    Guardian internal guardian;
    BlitzVault internal vault;
    Tranches internal tranches;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");

    uint256 internal constant YEAR = 365 days;

    function setUp() public {
        vm.startPrank(owner);
        dusd = new DemoUSD();
        guardian = new Guardian(owner);
        vault = new BlitzVault(dusd, address(guardian));
        tranches = new Tranches(address(vault), address(guardian), treasury);
        vault.setEngine(address(this)); // unused by these tests
        tranches.setEngine(address(this));
        vm.stopPrank();
        _fill(alice, 10);
        _fill(bob, 10);
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

    function _seedDecks(uint256 hull, uint256 bal) internal {
        vm.startPrank(bob);
        dusd.approve(address(tranches), bal);
        tranches.joinBallast(bal);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), hull);
        tranches.joinHull(hull);
        vm.stopPrank();
    }

    function test_positiveYieldGGreaterThanFeePlusAccrual() public {
        _seedDecks(400e6, 400e6);
        vm.warp(tranches.lastSettle() + YEAR);
        uint256 h0 = tranches.hullTvl();
        uint256 b0 = tranches.balTvl();
        uint256 r0 = tranches.reserve();
        uint256 t0 = tranches.treasuryAccrued();

        int256 G = 100e6;
        tranches.settle(G);

        int256 dH = int256(tranches.hullTvl()) - int256(h0);
        int256 dB = int256(tranches.balTvl()) - int256(b0);
        int256 dR = int256(tranches.reserve()) - int256(r0);
        int256 dT = int256(tranches.treasuryAccrued()) - int256(t0);
        assertEq(dH + dB + dR + dT, G);

        uint256 fee = 10e6;
        uint256 toReserve = 5e6;
        uint256 hullTarget = (400e6 * 800) / 10_000; // 32e6 over exactly 1 year
        assertEq(tranches.hullTvl() - h0, hullTarget);
        assertEq(tranches.balTvl() - b0, 100e6 - fee - hullTarget);
        assertEq(tranches.reserve() - r0, toReserve);
    }

    function test_positiveYieldGLessThanAccrual() public {
        _seedDecks(400e6, 400e6);
        vm.warp(block.timestamp + YEAR);
        uint256 h0 = tranches.hullTvl();
        uint256 b0 = tranches.balTvl();
        uint256 r0 = tranches.reserve();
        uint256 t0 = tranches.treasuryAccrued();

        int256 G = 10e6;
        tranches.settle(G);

        int256 dH = int256(tranches.hullTvl()) - int256(h0);
        int256 dB = int256(tranches.balTvl()) - int256(b0);
        int256 dR = int256(tranches.reserve()) - int256(r0);
        int256 dT = int256(tranches.treasuryAccrued()) - int256(t0);
        assertEq(dH + dB + dR + dT, G);
        // remainder 9e6 all goes to hull (target 32e6)
        assertEq(uint256(dH), 9e6);
        assertEq(uint256(dB), 0);
    }

    function test_negativeSmallEatsBallast() public {
        _seedDecks(400e6, 400e6);
        vm.warp(block.timestamp + 1);
        uint256 h0 = tranches.hullTvl();
        uint256 b0 = tranches.balTvl();
        uint256 r0 = tranches.reserve();
        uint256 t0 = tranches.treasuryAccrued();

        int256 G = -10e6;
        tranches.settle(G);
        assertEq(tranches.hullTvl(), h0);
        assertEq(tranches.balTvl(), b0 - 10e6);
        int256 dH = int256(tranches.hullTvl()) - int256(h0);
        int256 dB = int256(tranches.balTvl()) - int256(b0);
        int256 dR = int256(tranches.reserve()) - int256(r0);
        int256 dT = int256(tranches.treasuryAccrued()) - int256(t0);
        assertEq(dH + dB + dR + dT, G);
    }

    function test_negativeThroughReserveThenImpair() public {
        _seedDecks(400e6, 100e6); // 20% floor exactly
        vm.warp(block.timestamp + YEAR);
        // Build a reserve via a modest positive settle that spills to ballast/reserve
        tranches.settle(20e6);
        vm.warp(block.timestamp + 1);

        uint256 balPlusReserve = tranches.balTvl() + tranches.reserve();
        vm.expectRevert(Tranches.HullImpairment.selector);
        tranches.settle(-int256(balPlusReserve + 1));
    }

    function test_subordinationJoinHullRevertsAtFloor() public {
        _seedDecks(400e6, 100e6); // exactly 20%
        vm.startPrank(alice);
        dusd.approve(address(tranches), 1e6);
        vm.expectRevert();
        tranches.joinHull(1e6);
        vm.stopPrank();
    }

    function test_subordinationJoinBallastAlwaysOk() public {
        _seedDecks(400e6, 100e6);
        vm.startPrank(bob);
        dusd.approve(address(tranches), 50e6);
        tranches.joinBallast(50e6);
        vm.stopPrank();
        assertEq(tranches.balTvl(), 150e6);
    }

    function test_exitHullImprovesRatio() public {
        _seedDecks(400e6, 100e6);
        uint256 shares = tranches.hullToken().balanceOf(alice);
        vm.prank(alice);
        tranches.exitHull(shares / 2);
        assertGt((tranches.balTvl() * 10_000) / (tranches.hullTvl() + tranches.balTvl()), 2_000);
    }

    function test_exitBallastRevertsAtFloor() public {
        _seedDecks(400e6, 100e6);
        uint256 shares = tranches.ballastToken().balanceOf(bob);
        vm.prank(bob);
        vm.expectRevert();
        tranches.exitBallast(shares / 2);
    }

    function test_pauseBlocksJoin() public {
        vm.prank(owner);
        guardian.pause();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 100e6);
        vm.expectRevert(Tranches.Paused.selector);
        tranches.joinBallast(100e6);
        vm.stopPrank();
    }

    function test_dtZeroReverts() public {
        _seedDecks(400e6, 400e6);
        // lastSettle was set at setEngine then we warped during faucet; warp 0 extra
        // Force lastSettle == now by settling once then immediately again.
        vm.warp(block.timestamp + 1);
        tranches.settle(0);
        vm.expectRevert(Tranches.DtZero.selector);
        tranches.settle(1e6);
    }

    function test_wireOnce() public {
        vm.prank(owner);
        vm.expectRevert(Tranches.EngineAlreadySet.selector);
        tranches.setEngine(address(1));
    }

    function test_onlyEngineSettle() public {
        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        vm.expectRevert(Tranches.NotEngine.selector);
        tranches.settle(0);
    }

    function test_int256MinYieldReverts() public {
        _seedDecks(400e6, 400e6);
        vm.warp(block.timestamp + 1);
        vm.expectRevert(Tranches.ImplausibleYield.selector);
        tranches.settle(type(int256).min);
    }

    function test_emptyTvlPositiveYieldReverts() public {
        vm.warp(block.timestamp + 1);
        vm.expectRevert(Tranches.ImplausibleYield.selector);
        tranches.settle(1);
    }

    function test_settleAtYieldCapConserves() public {
        _seedDecks(400e6, 400e6);
        vm.warp(block.timestamp + 1);
        uint256 tvl = tranches.hullTvl() + tranches.balTvl() + tranches.reserve();
        int256 G = int256(tvl * 5_000 / 10_000);
        uint256 h0 = tranches.hullTvl();
        uint256 b0 = tranches.balTvl();
        uint256 r0 = tranches.reserve();
        uint256 t0 = tranches.treasuryAccrued();
        tranches.settle(G);
        assertEq(
            int256(tranches.hullTvl()) - int256(h0) + int256(tranches.balTvl()) - int256(b0)
                + int256(tranches.reserve()) - int256(r0) + int256(tranches.treasuryAccrued()) - int256(t0),
            G
        );
    }

    function test_settleNegativeCapDrainsBallast() public {
        _seedDecks(400e6, 400e6);
        vm.warp(block.timestamp + 1);
        uint256 tvl = tranches.hullTvl() + tranches.balTvl() + tranches.reserve();
        int256 G = -int256(tvl * 5_000 / 10_000); // -400e6 == entire ballast
        uint256 h0 = tranches.hullTvl();
        tranches.settle(G);
        assertEq(tranches.hullTvl(), h0);
        assertEq(tranches.balTvl(), 0);
    }

    function test_spillToKeepFloorOnThinBallast() public {
        _seedDecks(400e6, 100e6); // exactly 20%
        vm.warp(block.timestamp + 365 days);
        uint256 h0 = tranches.hullTvl();
        uint256 b0 = tranches.balTvl();
        tranches.settle(10e6);
        uint256 h1 = tranches.hullTvl();
        uint256 b1 = tranches.balTvl();
        assertGe(b1 * 10_000, 2_000 * (h1 + b1), "spill keeps floor");
        assertEq(int256(h1 + b1 + tranches.reserve() + tranches.treasuryAccrued()) - int256(h0 + b0), 10e6);
    }

    /// @dev Characterization: settle() books NAV without moving vault cash. Not a silent fix.
    function test_unfundedSettleDivergesLedgerFromVaultCash() public {
        _seedDecks(400e6, 400e6);
        uint256 cash = vault.totalAssets();
        vm.warp(block.timestamp + 1);
        tranches.settle(1e6);
        uint256 ledger = tranches.hullTvl() + tranches.balTvl() + tranches.reserve() + tranches.treasuryAccrued();
        assertGt(ledger, cash);
        assertEq(vault.totalAssets(), cash);
    }
}
