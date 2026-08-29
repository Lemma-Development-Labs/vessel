// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "../helpers/Fixture.sol";

/// @dev Classic ERC-4626 inflation: 1-wei first deposit + donation, then a victim
///      deposit. Offset=6 plus 100 dUSD dead shares must make it unprofitable.
contract InflationTest is Fixture {
    function setUp() public {
        _deploy();
        _faucet(alice, 10);
        _faucet(bob, 10);
    }

    function test_donationPlusFirstDepositUnprofitable() public {
        address attacker = alice;
        address victim = bob;
        uint256 victimDeposit = 200e6;
        uint256 donation = 50e6;

        uint256 attackerBefore = dusd.balanceOf(attacker);

        vm.startPrank(attacker);
        dusd.approve(address(vault), type(uint256).max);
        vault.deposit(1, attacker);
        dusd.transfer(address(vault), donation);
        vm.stopPrank();

        vm.startPrank(victim);
        dusd.approve(address(vault), victimDeposit);
        uint256 victimShares = vault.deposit(victimDeposit, victim);
        vm.stopPrank();

        assertGt(victimShares, 0, "victim must receive shares");

        uint256 attackerShares = vault.balanceOf(attacker);
        vm.prank(attacker);
        uint256 attackerOut = vault.redeem(attackerShares, attacker, attacker);

        uint256 attackerAfter = dusd.balanceOf(attacker);
        assertLt(attackerAfter, attackerBefore, "attacker is poorer after donation");
        assertLt(attackerOut, donation + victimDeposit, "cannot extract donation plus victim");

        vm.prank(victim);
        uint256 victimOut = vault.redeem(victimShares, victim, victim);
        assertGe(victimOut, victimDeposit * 99 / 100, "victim keeps ~principal");
    }
}
