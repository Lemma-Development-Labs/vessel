// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "../helpers/Fixture.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Tranches} from "../../src/Tranches.sol";

/// @dev The classic ERC-4626 first-depositor inflation attack needs an outsider to be
///      able to mint vault shares. That is now impossible: `deposit`/`mint` are
///      Tranches-only. These tests pin the gate shut and then show the remaining
///      surface — Tranches' own share math — is not inflatable either.
contract InflationTest is Fixture {
    address internal attacker;
    address internal victim;

    function setUp() public {
        _deploy();
        attacker = alice;
        victim = bob;
        deal(address(dusd), attacker, 10_000e6, true);
        deal(address(dusd), victim, 10_000e6, true);
    }

    /// @dev The historical attack (1-wei first deposit, then donate) cannot even start.
    function test_rawFirstDepositorAttackIsUnreachable() public {
        vm.startPrank(attacker);
        dusd.approve(address(vault), type(uint256).max);

        vm.expectRevert(BlitzVault.NotTranches.selector);
        vault.deposit(1, attacker);
        vm.expectRevert(BlitzVault.NotTranches.selector);
        vault.mint(1, attacker);

        // Even donating first does not open a path.
        dusd.transfer(address(vault), 500e6);
        vm.expectRevert(BlitzVault.NotTranches.selector);
        vault.deposit(1, attacker);
        vm.stopPrank();

        assertEq(vault.balanceOf(attacker), 0, "attacker holds no vBLITZ");
    }

    /// @dev The dead-share seed plus `_decimalsOffset() = 6` are still in place.
    function test_deadShareSeedExists() public view {
        assertTrue(vault.deadSharesSeeded(), "seed flag set at deploy");
        assertEq(vault.balanceOf(vault.DEAD()), 100e6 * 10 ** vault.DECIMALS_OFFSET(), "100 dUSD of dead shares");
        assertEq(vault.DECIMALS_OFFSET(), 6);
    }

    /// @dev Donations into the vault and into Tranches cannot inflate the BAL share
    ///      price: `balTvl` only moves on join / exit / settle, none of which a donor
    ///      controls. The victim must still receive proportional shares.
    function test_donationCannotInflateTrancheShares() public {
        uint256 attackerBefore = dusd.balanceOf(attacker);

        vm.startPrank(attacker);
        dusd.approve(address(tranches), type(uint256).max);
        uint256 atkShares = tranches.joinBallast(tranches.MIN_JOIN());
        dusd.transfer(address(vault), 500e6);
        dusd.transfer(address(tranches), 500e6);
        vm.stopPrank();

        vm.startPrank(victim);
        dusd.approve(address(tranches), type(uint256).max);
        uint256 victimShares = tranches.joinBallast(200e6);
        vm.stopPrank();

        assertGt(victimShares, 0, "victim must receive shares");
        // Shares are proportional to assets, unaffected by the 1000 dUSD of donations.
        assertEq(victimShares, atkShares * 200e6 / tranches.MIN_JOIN(), "share price not inflated");

        vm.prank(victim);
        uint256 victimOut = tranches.exitBallast(victimShares);
        assertEq(victimOut, 200e6, "victim recovers principal exactly");

        vm.prank(attacker);
        uint256 atkOut = tranches.exitBallast(atkShares);
        assertEq(atkOut, tranches.MIN_JOIN(), "attacker recovers only its own stake");
        assertLt(dusd.balanceOf(attacker), attackerBefore, "attacker is strictly poorer");
        assertEq(dusd.balanceOf(attacker), attackerBefore - 1000e6, "donation is unrecoverable");
    }

    /// @dev A minimum-size first join cannot round a later joiner down to zero shares.
    function test_minJoinCannotRoundVictimToZero() public {
        vm.startPrank(attacker);
        dusd.approve(address(tranches), type(uint256).max);
        tranches.joinBallast(tranches.MIN_JOIN());
        dusd.transfer(address(vault), 9_000e6);
        vm.stopPrank();

        vm.startPrank(victim);
        dusd.approve(address(tranches), type(uint256).max);
        uint256 victimShares = tranches.joinBallast(tranches.MIN_JOIN());
        vm.stopPrank();
        assertGt(victimShares, 0, "victim never rounds to zero shares");
    }
}
