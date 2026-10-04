// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SimulatedEngine} from "../../src/core/testnet/SimulatedEngine.sol";
import {TestUSDC} from "../fixtures/CoreFixtures.sol";

contract SimulatedEngineTest is Test {
    TestUSDC usd;
    SimulatedEngine eng;
    address custody = makeAddr("custody");
    address gov = makeAddr("gov");

    function setUp() public {
        vm.warp(1_790_000_000);
        usd = new TestUSDC();
        eng = new SimulatedEngine(usd, custody, gov);
        usd.mint(address(this), 1_000e6);
        usd.approve(address(eng), type(uint256).max);
        eng.seed(100e6);
        // custody deploys 1,000 into the book
        usd.mint(custody, 1_000e6);
        vm.prank(custody);
        usd.transfer(address(eng), 1_000e6);
        vm.prank(custody);
        eng.credit(1_000e6);
    }

    function test_positive_funding_paid_from_pot_and_capped() public {
        vm.prank(gov);
        eng.setFundingRateBps(1_200);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        (uint256 v,) = eng.value();
        assertEq(v, 1_100e6, "12% on 1,000 is 120, capped by the 100 pot");
        eng.accrue();
        assertEq(eng.book(), 1_100e6);
        assertEq(eng.pot(), 0);
    }

    function test_negative_funding_moves_book_into_pot() public {
        vm.prank(gov);
        eng.setFundingRateBps(-2_400);
        vm.warp(vm.getBlockTimestamp() + 30 days);
        (uint256 v,) = eng.value();
        assertEq(v, 1_000e6 - (1_000e6 * 2_400 * 30 days) / (10_000 * uint256(365 days)));
    }

    function test_donations_are_quarantined_not_valued() public {
        usd.mint(address(eng), 555e6);
        (uint256 v,) = eng.value();
        assertEq(v, 1_000e6);
        assertEq(eng.quarantined(), 555e6);
    }

    function test_only_custody_credits_and_releases_to_custody() public {
        vm.expectRevert(SimulatedEngine.NotCustody.selector);
        eng.credit(1);
        vm.expectRevert(SimulatedEngine.NotCustody.selector);
        eng.release(1);
        vm.prank(custody);
        vm.expectRevert(SimulatedEngine.Insufficient.selector);
        eng.credit(1); // no matching transfer
        vm.prank(custody);
        eng.release(400e6);
        assertEq(usd.balanceOf(custody), 400e6);
        assertEq(eng.book(), 600e6);
    }

    function test_rate_is_governance_only_and_bounded() public {
        vm.expectRevert(SimulatedEngine.NotGovernance.selector);
        eng.setFundingRateBps(100);
        vm.prank(gov);
        vm.expectRevert(SimulatedEngine.ImplausibleRate.selector);
        eng.setFundingRateBps(10_001);
    }

    function test_refuses_mainnet() public {
        vm.chainId(143);
        vm.expectRevert(SimulatedEngine.Mainnet.selector);
        new SimulatedEngine(usd, custody, gov);
    }
}
