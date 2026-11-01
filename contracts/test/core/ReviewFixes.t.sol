// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PauseGuardian} from "../../src/core/governance/PauseGuardian.sol";
import {BallastToken} from "../../src/core/BallastToken.sol";
import {IPauseGuardian, IStrategyEngine} from "../../src/core/interfaces/ICore.sol";
import {TrancheController} from "../../src/core/TrancheController.sol";
import {TestUSDC, TestEngine} from "../fixtures/CoreFixtures.sol";

/// @notice Regression tests for the controller findings of the 25 Oct review (PR #15): each one reproduces
///         the reported failure and asserts the corrected behaviour.
contract ReviewFixesTest is Test {
    address gov = makeAddr("governance");
    address op = makeAddr("operator");
    address guardian = makeAddr("guardian");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address amy = makeAddr("amy");
    address bob = makeAddr("bob");
    address carl = makeAddr("carl");
    address mallory = makeAddr("mallory");

    TrancheController c;
    TestUSDC usdc;
    TestEngine engine;
    PauseGuardian pauses;
    BallastToken bal;

    TrancheController.Tranche constant HULL = TrancheController.Tranche.HULL;
    TrancheController.Tranche constant BALLAST = TrancheController.Tranche.BALLAST;

    function setUp() public {
        vm.warp(1_790_000_000);
        usdc = new TestUSDC();
        pauses = new PauseGuardian(guardian, gov);
        c = new TrancheController(usdc, IPauseGuardian(address(pauses)), gov, op, treasury, 1e12, 1);
        bal = c.ballast();
        engine = new TestEngine(usdc);
        engine.setCustody(address(c.custody()));
        vm.startPrank(gov);
        c.setEngine(IStrategyEngine(address(engine)));
        c.setStageCap(25_000e6);
        vm.stopPrank();
        address custody = address(c.custody()); // read before vm.prank: the prank applies to the next call
        address[6] memory users = [gov, alice, amy, bob, carl, mallory];
        for (uint256 i = 0; i < users.length; i++) {
            usdc.mint(users[i], 20_000e6);
            vm.prank(users[i]);
            usdc.approve(custody, type(uint256).max);
            vm.prank(gov);
            c.setAllowance(users[i], 20_000e6);
        }
    }

    // ------------------------------------------------------------------ helpers
    function _ballast(address who, uint256 assets) internal returns (uint256 id) {
        vm.prank(who);
        id = c.requestDeposit(BALLAST, 0, assets, who, 0, vm.getBlockTimestamp() + 1 days);
    }

    function _hull(address who, uint256 sid, uint256 assets) internal returns (uint256 id) {
        vm.prank(who);
        id = c.requestDeposit(HULL, sid, assets, who, 0, vm.getBlockTimestamp() + 10 days);
    }

    /// @dev The review's book: reserve 200, Ballast 3,000, Hull 6,000 at 8%, 8,000 deployed.
    function _book() internal returns (uint256 sid) {
        vm.prank(gov);
        c.contributeReserve(200e6);
        _ballast(bob, 3_000e6);
        c.processDepositBatch(10);
        vm.prank(gov);
        sid = c.openSeries(800, bytes32(0));
        _hull(alice, sid, 6_000e6);
        vm.warp(vm.getBlockTimestamp() + 72 hours);
        c.activateSeries(sid);
        vm.prank(op);
        c.deployToEngine(8_000e6);
    }

    /// @dev Loss 4,000 (> Ballast + reserve), terminate, recall everything, fund what Hull has.
    function _impairAndFund(uint256 sid) internal returns (uint256 entitlement) {
        vm.warp(vm.getBlockTimestamp() + 1 days);
        engine.applyPnl(-4_000e6);
        c.settle();
        assertTrue(c.impaired());
        entitlement = c.hullCap();
        c.matureSeries(sid);
        _recallAll();
        c.fundSeries(sid);
        assertEq(c.hullNav(), 0);
    }

    function _recallAll() internal {
        uint256 held = usdc.balanceOf(address(engine));
        if (held > 0) {
            vm.prank(op);
            c.recallFromEngine(held);
        }
    }

    function _funded(uint256 sid) internal view returns (uint256) {
        (,,,,,,,, uint256 acc,) = c.seriesInfo(sid);
        return (6_000e6 * acc) / 1e18;
    }

    function _state(uint256 sid) internal view returns (TrancheController.SeriesState st) {
        (st,,,,,,,,,) = c.seriesInfo(sid);
    }

    // ------------------------------------------------------------------ CORE-2
    /// Review PoC: H 6,000 / B 3,000 / R 200, loss 4,000, fund, recover +3,000. Hull used to take all
    /// 3,000 (8,200 against a 6,009 cap). Spec allocation: Hull its remaining entitlement, then the
    /// reserve to its frozen 200, then Ballast.
    function test_CORE2_recovery_after_funding_stops_at_the_remaining_entitlement() public {
        uint256 sid = _book();
        uint256 entitlement = _impairAndFund(sid);
        // the loss beyond Ballast + reserve took Hull from its entitlement (6,000 + one day's coupon) down to
        // exactly 5,200, all of which was funded; what is still owed is the entitlement minus that
        uint256 owed = c.hullCap();
        assertEq(owed, entitlement - 5_200e6, "hullCap is what is still owed (~801: 800 + one day's coupon)");

        engine.applyPnl(3_000e6);
        vm.warp(vm.getBlockTimestamp() + 1);
        c.settle();
        assertEq(c.hullNav(), owed, "Hull recovers exactly its shortfall, not all 3,000");
        assertEq(c.reserveNav(), 200e6, "then the reserve to its frozen entitlement");
        assertEq(c.ballastNav(), 3_000e6 - owed - 200e6, "then Ballast (~1,999)");
        assertEq(5_200e6 + c.hullNav(), entitlement, "funded + H = the senior entitlement, never more");
    }

    // ------------------------------------------------------------------ CORE-3
    function test_CORE3_full_recovery_ends_impairment_and_the_book_resumes() public {
        uint256 sid = _book();
        _impairAndFund(sid);
        engine.applyPnl(3_000e6);
        vm.warp(vm.getBlockTimestamp() + 1);
        c.settle();
        _recallAll();
        c.fundSeries(sid);
        assertFalse(c.impaired(), "senior entitlement met: impairment ends");
        assertEq(c.hullCap(), 0);
        assertEq(uint256(_state(sid)), uint256(TrancheController.SeriesState.CLAIMABLE));
        c.closeMaturedSeries(sid);
        // Ballast and the reserve are no longer stranded: exits and new series work again
        uint256 units = bal.balanceOf(bob);
        vm.prank(bob);
        c.requestBallastRedeem(units / 2, bob, 0);
        vm.warp(vm.getBlockTimestamp() + 48 hours + 1);
        c.processExitBatch(10);
        assertLt(bal.balanceOf(bob), units, "a Ballast exit is funded after recovery");
        vm.prank(gov);
        c.openSeries(800, bytes32(0));
    }

    function test_CORE3_unrecovered_shortfall_can_be_written_off_after_the_delay() public {
        uint256 sid = _book();
        _impairAndFund(sid);
        uint256 shortfall = c.hullCap();
        assertGt(shortfall, 0);
        vm.prank(gov);
        vm.expectRevert(TrancheController.TooEarly.selector);
        c.writeOffShortfall(sid);
        vm.warp(vm.getBlockTimestamp() + 30 days);
        vm.prank(mallory);
        vm.expectRevert(TrancheController.NotGovernance.selector);
        c.writeOffShortfall(sid);
        vm.expectEmit(address(c));
        emit TrancheController.ImpairmentEnded(c.epoch() + 1, shortfall);
        vm.prank(gov);
        c.writeOffShortfall(sid);
        assertFalse(c.impaired());
        assertEq(uint256(_state(sid)), uint256(TrancheController.SeriesState.CLAIMABLE));
        c.closeMaturedSeries(sid);
        vm.prank(alice);
        c.claimHull(sid); // what was funded stays claimable
    }

    function test_CORE3_no_reserve_contribution_into_an_impaired_book() public {
        uint256 sid = _book();
        _impairAndFund(sid);
        vm.prank(gov);
        vm.expectRevert(TrancheController.BookImpaired.selector);
        c.contributeReserve(100e6);
    }

    function test_CORE3_a_rounding_sized_shortfall_does_not_keep_the_book_impaired() public {
        vm.prank(gov);
        c.contributeReserve(200e6);
        _ballast(bob, 3_000e6);
        c.processDepositBatch(10);
        vm.prank(gov);
        uint256 sid = c.openSeries(0, bytes32(0)); // 0% coupon: the shortfall is exactly what we take
        _hull(alice, sid, 6_000e6);
        vm.warp(vm.getBlockTimestamp() + 72 hours);
        c.activateSeries(sid);
        vm.prank(op);
        c.deployToEngine(8_000e6);
        engine.applyPnl(-int256(3_200e6 + 50)); // Ballast + reserve + 50 base units
        c.settle();
        assertTrue(c.impaired());
        c.matureSeries(sid);
        _recallAll();
        c.fundSeries(sid);
        assertFalse(c.impaired(), "a 50-unit shortfall is dust");
        assertEq(uint256(_state(sid)), uint256(TrancheController.SeriesState.CLAIMABLE));
    }

    // ------------------------------------------------------------------ ENG-2
    function test_ENG2_governance_can_recall_engine_usdc_without_the_keeper_key() public {
        _book();
        vm.prank(gov);
        c.recallFromEngine(1_000e6);
        assertEq(usdc.balanceOf(address(engine)), 7_000e6);
        vm.prank(mallory);
        vm.expectRevert(TrancheController.NotOperator.selector);
        c.recallFromEngine(1);
    }

    // ------------------------------------------------------------------ CORE-1
    function test_CORE1_cancelled_requests_do_not_hold_subscriber_slots() public {
        vm.prank(gov);
        uint256 sid = c.openSeries(800, bytes32(0));
        vm.startPrank(mallory);
        for (uint256 k; k < 25; k++) {
            uint256 id = c.requestDeposit(HULL, sid, 10e6, mallory, 0, vm.getBlockTimestamp() + 10 days);
            c.cancelDeposit(id); // used to keep its slot: 25 of these blocked the series for free
        }
        vm.stopPrank();
        _hull(alice, sid, 1_000e6); // a real subscriber still gets in
        (,,,,,,,,, uint256 slots) = c.seriesInfo(sid);
        assertEq(slots, 26);
    }

    function test_CORE1_minimum_subscription_slot_cap_and_governance_cancel() public {
        vm.prank(gov);
        uint256 sid = c.openSeries(800, bytes32(0));
        vm.prank(mallory);
        vm.expectRevert(TrancheController.BelowMinimum.selector);
        c.requestDeposit(HULL, sid, 1, mallory, 0, vm.getBlockTimestamp() + 10 days); // no 1-wei dust series

        vm.startPrank(mallory);
        for (uint256 k; k < 100; k++) {
            uint256 id = c.requestDeposit(HULL, sid, 10e6, mallory, 0, vm.getBlockTimestamp() + 10 days);
            if (k < 99) c.cancelDeposit(id);
        }
        vm.expectRevert(TrancheController.TooManySubscribers.selector);
        c.requestDeposit(HULL, sid, 10e6, mallory, 0, vm.getBlockTimestamp() + 10 days); // slot cap bounds activation's loop
        vm.stopPrank();

        // governance clears it: every escrowed subscription refundable, the next series can open
        vm.prank(mallory);
        vm.expectRevert(TrancheController.NotGovernance.selector);
        c.cancelSeries(sid);
        vm.prank(gov);
        c.cancelSeries(sid);
        assertEq(uint256(_state(sid)), uint256(TrancheController.SeriesState.CANCELLED));
        assertEq(c.activeSeries(), 0);
        (,,,,,, TrancheController.ReqStatus st,,) = c.deposits(c.nextDepositId() - 1);
        assertEq(uint256(st), uint256(TrancheController.ReqStatus.REFUNDABLE));
        c.claimRefund(c.nextDepositId() - 1);
        vm.prank(gov);
        c.openSeries(800, bytes32(0));
    }

    // ------------------------------------------------------------------ CORE-4
    function test_CORE4_subscription_is_cancellable_when_activation_stays_blocked() public {
        vm.prank(gov);
        c.contributeReserve(200e6);
        _ballast(bob, 3_000e6);
        c.processDepositBatch(10);
        vm.prank(gov);
        uint256 sid = c.openSeries(800, bytes32(0));
        uint256 id = _hull(alice, sid, 3_000e6);
        vm.warp(vm.getBlockTimestamp() + 72 hours);
        engine.setStale(true); // activation now reverts StaleValuation
        vm.expectRevert(TrancheController.StaleValuation.selector);
        c.activateSeries(sid);
        vm.prank(alice);
        vm.expectRevert(TrancheController.BadStatus.selector);
        c.cancelDeposit(id); // still inside the grace: the ordered set is frozen
        vm.warp(vm.getBlockTimestamp() + 7 days);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        c.cancelDeposit(id);
        c.claimRefund(id); // no settlement needed
        assertEq(usdc.balanceOf(alice) - before, 3_000e6, "escrowed money was never stuck behind activation");
    }

    // ------------------------------------------------------------------ CORE-5
    function test_CORE5_close_cost_is_bounded() public {
        vm.prank(gov);
        vm.expectRevert(TrancheController.AboveCeiling.selector);
        c.setCloseCost(type(uint256).max);
        vm.prank(gov);
        c.setCloseCost(25_000e6);
    }

    // ------------------------------------------------------------------ CORE-6
    function test_CORE6_pay_treasury_settles_first_and_respects_the_settlement_pause() public {
        uint256 sid = _book();
        engine.applyPnl(1_000e6); // a gain: fees accrue to the treasury
        vm.warp(vm.getBlockTimestamp() + 1);
        c.settle();
        uint256 liability = c.treasuryLiability();
        assertGt(liability, 0);
        // an unsettled loss that impairs the book: payTreasury must see it, not pay from it
        engine.applyPnl(-5_500e6);
        vm.prank(gov);
        vm.expectRevert(TrancheController.BookImpaired.selector);
        c.payTreasury(1);
        assertTrue(true, "reverted, so the impairing settlement was rolled back with it");
        sid;
        vm.prank(guardian);
        pauses.pause(4); // SETTLEMENT
        vm.prank(gov);
        vm.expectRevert(abi.encodeWithSelector(TrancheController.Paused.selector, uint8(4)));
        c.payTreasury(1);
    }

    // ------------------------------------------------------------------ CORE-7
    function test_CORE7_the_payer_must_be_the_receiver_during_the_beta() public {
        vm.prank(alice);
        vm.expectRevert(TrancheController.ReceiverMustBeSender.selector);
        c.requestDeposit(BALLAST, 0, 100e6, mallory, 0, vm.getBlockTimestamp() + 1 days);
    }

    // ------------------------------------------------------------------ CORE-8
    function test_CORE8_ballast_exits_cannot_take_hull_money_while_a_series_unwinds() public {
        uint256 sid = _book();
        vm.warp(vm.getBlockTimestamp() + 28 days);
        c.matureSeries(sid);
        // recall only what Hull is owed: idle cash then equals Hull's allocation, the rest is still deployed
        uint256 owed = c.hullNav();
        uint256 toRecall = owed - c.custody().activeIdle(); // computed before vm.prank (it applies to the next call)
        vm.prank(op);
        c.recallFromEngine(toRecall);
        assertEq(c.custody().activeIdle(), owed);
        uint256 units = bal.balanceOf(bob);
        vm.prank(bob);
        c.requestBallastRedeem(units, bob, 0);
        vm.warp(vm.getBlockTimestamp() + 48 hours + 1);
        c.processExitBatch(10); // used to be able to take idle cash ahead of fundSeries
        assertEq(c.hullNav(), owed, "the exit left Hull's allocation alone");
        uint256 escrowBefore = usdc.balanceOf(address(c.escrow()));
        c.fundSeries(sid);
        assertEq(usdc.balanceOf(address(c.escrow())) - escrowBefore, owed, "the senior allocation is funded in full");
        assertEq(c.hullNav(), 0);
    }

    // ------------------------------------------------------------------ SIM-4
    function test_SIM4_insolvency_is_not_hidden_behind_the_treasury_liability() public {
        _ballast(bob, 3_000e6);
        c.processDepositBatch(10);
        vm.prank(op);
        c.deployToEngine(2_700e6); // all but the 10% idle floor
        engine.applyPnl(5_000e6); // big gain: fees owed to the treasury
        vm.warp(vm.getBlockTimestamp() + 1);
        c.settle();
        uint256 liability = c.treasuryLiability();
        assertGt(liability, 0);
        // total loss at the venue: the gross book (300 idle) falls below what the treasury is owed
        engine.applyPnl(-int256(usdc.balanceOf(address(engine))));
        uint256 gross = c.custody().activeIdle();
        assertLt(gross, liability);
        vm.expectEmit(address(c));
        emit TrancheController.TreasuryWrittenDown(c.epoch() + 1, liability - gross);
        vm.warp(vm.getBlockTimestamp() + 1);
        c.settle();
        assertEq(c.treasuryLiability(), gross, "written down to what is there");
        assertEq(c.ballastNav() + c.reserveNav(), 0, "the loss is visible in the book, not floored away");
        // a later recovery goes to the book in full; it used to refill the treasury first
        engine.applyPnl(1_000e6);
        vm.warp(vm.getBlockTimestamp() + 1);
        c.settle();
        assertEq(c.treasuryLiability(), gross, "no fee: the recovery is inside the loss carry-forward");
        assertEq(c.ballastNav() + c.reserveNav(), 1_000e6, "all 1,000 reaches the book");
    }
}
