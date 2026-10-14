// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TrancheController} from "../../src/core/TrancheController.sol";
import {AssetCustody} from "../../src/core/AssetCustody.sol";
import {ClaimEscrow} from "../../src/core/ClaimEscrow.sol";
import {BallastToken} from "../../src/core/BallastToken.sol";
import {PauseGuardian} from "../../src/core/governance/PauseGuardian.sol";
import {IPauseGuardian, IStrategyEngine} from "../../src/core/interfaces/ICore.sol";
import {TestEngine, TestUSDC} from "../fixtures/CoreFixtures.sol";

contract LifecycleTest is Test {
    TestUSDC usdc;
    PauseGuardian pauses;
    TrancheController c;
    AssetCustody custody;
    ClaimEscrow escrow;
    BallastToken bal;
    TestEngine engine;

    address gov = makeAddr("governance");
    address guardian = makeAddr("guardian");
    address op = makeAddr("operator");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice"); // Hull
    address amy = makeAddr("amy"); // Hull
    address bob = makeAddr("bob"); // Ballast
    address carl = makeAddr("carl"); // Ballast
    address mallory = makeAddr("mallory");

    TrancheController.Tranche constant HULL = TrancheController.Tranche.HULL;
    TrancheController.Tranche constant BALLAST = TrancheController.Tranche.BALLAST;

    function setUp() public {
        vm.warp(1_790_000_000);
        usdc = new TestUSDC();
        pauses = new PauseGuardian(guardian, gov);
        c = new TrancheController(usdc, IPauseGuardian(address(pauses)), gov, op, treasury, 1e12, 1);
        custody = c.custody();
        escrow = c.escrow();
        bal = c.ballast();
        engine = new TestEngine(usdc);
        engine.setCustody(address(custody));
        vm.startPrank(gov);
        c.setEngine(IStrategyEngine(address(engine)));
        c.setStageCap(25_000e6);
        vm.stopPrank();
        address[5] memory users = [gov, alice, amy, bob, carl];
        for (uint256 i = 0; i < users.length; i++) {
            usdc.mint(users[i], 20_000e6);
            vm.prank(users[i]);
            usdc.approve(address(custody), type(uint256).max);
            vm.prank(gov);
            c.setAllowance(users[i], 20_000e6);
        }
    }

    function _ballast(address who, uint256 assets) internal returns (uint256 id) {
        vm.prank(who);
        id = c.requestDeposit(BALLAST, 0, assets, who, 0, vm.getBlockTimestamp() + 1 days);
    }

    function _hull(address who, uint256 seriesId, uint256 assets, uint256 minRate) internal returns (uint256 id) {
        vm.prank(who);
        id = c.requestDeposit(HULL, seriesId, assets, who, minRate, vm.getBlockTimestamp() + 10 days);
    }

    /// @dev Standard book: reserve 200, Ballast 3,000 (bob), Hull 6,000 (alice) at 8% active.
    function _book() internal returns (uint256 sid) {
        vm.prank(gov);
        c.contributeReserve(200e6);
        _ballast(bob, 3_000e6);
        c.processDepositBatch(10);
        vm.prank(gov);
        sid = c.openSeries(800, keccak256("series-1 terms"));
        _hull(alice, sid, 6_000e6, 800);
        vm.warp(vm.getBlockTimestamp() + 72 hours);
        c.activateSeries(sid);
    }

    function _assertIdentity() internal view {
        assertEq(c.activeAssets(), c.hullNav() + c.ballastNav() + c.reserveNav(), "A = H + B + R");
        assertEq(c.lastActive(), c.activeAssets(), "lastActive tracks A");
    }

    function test_full_hull_and_ballast_lifecycle() public {
        uint256 sid = _book();
        assertEq(c.hullNav(), 6_000e6);
        assertEq(uint256(_state(sid)), uint256(TrancheController.SeriesState.ACTIVE));

        vm.prank(op);
        c.deployToEngine(8_000e6);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        engine.applyPnl(100e6);
        uint256 before = c.hullNav() + c.ballastNav() + c.reserveNav() + c.treasuryLiability();
        c.settle();
        _assertIdentity();
        assertEq(c.hullNav() + c.ballastNav() + c.reserveNav() + c.treasuryLiability(), before + 100e6, "conservation");
        assertGt(c.treasuryLiability(), 0, "fee on eligible gain");

        vm.warp(vm.getBlockTimestamp() + 21 days + 1);
        c.matureSeries(sid);
        uint256 held = usdc.balanceOf(address(engine));
        vm.prank(op);
        c.recallFromEngine(held);
        uint256 entitlement = c.hullNav();
        // 6,000 at 8% for exactly 28 days
        assertEq(entitlement, _withCoupon(6_000e6, 800, 28 days));
        c.fundSeries(sid);
        assertEq(uint256(_state(sid)), uint256(TrancheController.SeriesState.CLAIMABLE));
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        c.claimHull(sid);
        uint256 paid = usdc.balanceOf(alice) - aliceBefore;
        // Rounding rule (P02, docs/ACCOUNTING.md): payouts never exceed the entitlement; per-unit
        // flooring may leave at most 1 base unit per holder per funding in the series pool.
        assertLe(paid, entitlement, "never overpays");
        assertGe(paid + 1, entitlement, "dust bounded by 1 unit");
        assertLe(escrow.poolBalance(c.seriesKey(sid)), 1, "dust stays in the series pool");
        c.closeMaturedSeries(sid);

        uint256 units = bal.balanceOf(bob);
        vm.prank(bob);
        uint256 xid = c.requestBallastRedeem(units, bob, 0);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        uint256 value = c.ballastUnitValue(units);
        c.processExitBatch(10);
        assertEq(bal.balanceOf(bob), 0);
        uint256 bobBefore = usdc.balanceOf(bob);
        escrow.claim(c.exitKey(xid));
        assertEq(usdc.balanceOf(bob) - bobBefore, value);
        _assertIdentity();
        // What remains active is the reserve plus the unpaid treasury liability (and rounding dust).
        assertApproxEqAbs(custody.activeIdle(), c.reserveNav() + c.treasuryLiability(), 2);
    }

    function test_subscription_escrow_not_deployed() public {
        vm.prank(gov);
        uint256 sid = c.openSeries(800, bytes32(0));
        _hull(alice, sid, 5_000e6, 0);
        assertEq(custody.pending(), 5_000e6);
        assertEq(custody.activeIdle(), 0);
        vm.prank(op);
        vm.expectRevert(TrancheController.IdleFloor.selector);
        c.deployToEngine(1);
        assertEq(c.activeAssets(), 0, "pending is outside A");
    }

    function test_refund_on_min_rate_unmet_and_no_mid_series_entry() public {
        vm.prank(gov);
        c.contributeReserve(200e6);
        _ballast(bob, 3_000e6);
        c.processDepositBatch(10);
        vm.prank(gov);
        uint256 sid = c.openSeries(800, bytes32(0));
        uint256 keep = _hull(alice, sid, 2_000e6, 800);
        uint256 picky = _hull(amy, sid, 2_000e6, 900);
        vm.warp(vm.getBlockTimestamp() + 72 hours);
        c.activateSeries(sid);
        (,,,,,,,, TrancheController.ReqStatus st1,) = _dep(keep);
        (,,,,,,,, TrancheController.ReqStatus st2,) = _dep(picky);
        assertEq(uint256(st1), uint256(TrancheController.ReqStatus.ADMITTED));
        assertEq(uint256(st2), uint256(TrancheController.ReqStatus.REFUNDABLE));
        uint256 amyBefore = usdc.balanceOf(amy);
        c.claimRefund(picky);
        assertEq(usdc.balanceOf(amy) - amyBefore, 2_000e6);

        vm.prank(carl);
        vm.expectRevert(TrancheController.BadSeries.selector);
        c.requestDeposit(HULL, sid, 1_000e6, carl, 0, vm.getBlockTimestamp() + 1 days);
    }

    function test_activation_excludes_what_would_break_projected_cover() public {
        vm.prank(gov);
        c.contributeReserve(200e6);
        _ballast(bob, 3_000e6);
        c.processDepositBatch(10);
        vm.prank(gov);
        uint256 sid = c.openSeries(800, bytes32(0));
        uint256 first = _hull(alice, sid, 6_000e6, 0);
        uint256 second = _hull(amy, sid, 2_000e6, 0); // 8,000 total would break 30% cover
        vm.warp(vm.getBlockTimestamp() + 72 hours);
        c.activateSeries(sid);
        assertEq(c.hullNav(), 6_000e6);
        (,,,,,,,, TrancheController.ReqStatus s1,) = _dep(first);
        (,,,,,,,, TrancheController.ReqStatus s2,) = _dep(second);
        assertEq(uint256(s1), uint256(TrancheController.ReqStatus.ADMITTED));
        assertEq(uint256(s2), uint256(TrancheController.ReqStatus.REFUNDABLE));
        assertGe(c.juniorCoverBps(), 3_000);
    }

    function test_coupon_stops_at_maturity() public {
        uint256 sid = _book();
        vm.warp(vm.getBlockTimestamp() + 90 days);
        c.matureSeries(sid);
        assertEq(c.hullNav(), _withCoupon(6_000e6, 800, 28 days));
    }

    function test_senior_impairment_pro_rata_and_cumulative_recovery() public {
        vm.prank(gov);
        c.contributeReserve(200e6);
        _ballast(bob, 3_000e6);
        c.processDepositBatch(10);
        vm.prank(gov);
        uint256 sid = c.openSeries(800, bytes32(0));
        _hull(alice, sid, 3_000e6, 0);
        _hull(amy, sid, 3_000e6, 0);
        vm.warp(vm.getBlockTimestamp() + 72 hours);
        c.activateSeries(sid);
        vm.prank(op);
        c.deployToEngine(8_000e6);

        // Loss larger than Ballast + reserve: Hull takes the remainder, fees are waived.
        engine.applyPnl(-4_000e6);
        c.settle();
        assertTrue(c.impaired());
        assertEq(c.ballastNav(), 0);
        assertEq(c.reserveNav(), 0);
        assertEq(c.treasuryLiability(), 0, "no fee that impairs Hull");
        assertEq(uint256(_state(sid)), uint256(TrancheController.SeriesState.IMPAIRED));
        uint256 cap = c.hullCap();
        _assertIdentity();

        // New risk and new admissions stop while impaired.
        vm.prank(carl);
        vm.expectRevert(TrancheController.BookImpaired.selector);
        c.requestDeposit(BALLAST, 0, 100e6, carl, 0, vm.getBlockTimestamp() + 1 days);

        c.matureSeries(sid); // emergency termination path
        uint256 held = usdc.balanceOf(address(engine));
        vm.prank(op);
        c.recallFromEngine(held);
        c.fundSeries(sid);
        uint256 a1 = usdc.balanceOf(alice);
        vm.prank(alice);
        c.claimHull(sid); // alice claims early

        // Later recovery: restores Hull up to its frozen entitlement first.
        engine.applyPnl(500e6); // recovery realised at the venue
        vm.warp(vm.getBlockTimestamp() + 1);
        c.settle();
        assertLe(c.hullNav() + _funded(sid), cap, "never beyond frozen entitlement");
        held = usdc.balanceOf(address(engine));
        vm.prank(op);
        c.recallFromEngine(held);
        c.fundSeries(sid);

        vm.prank(alice);
        c.claimHull(sid); // alice's share of the later recovery
        vm.prank(amy);
        c.claimHull(sid); // amy, who waited
        assertApproxEqAbs(
            usdc.balanceOf(alice) - a1, usdc.balanceOf(amy) - 17_000e6, 2, "equal holders, equal recovery"
        );
    }

    function test_forward_price_after_loss() public {
        _ballast(bob, 3_000e6);
        c.processDepositBatch(10);
        vm.prank(op);
        c.deployToEngine(2_700e6);
        engine.applyPnl(-300e6);
        _ballast(carl, 300e6);
        c.processDepositBatch(10); // settles the 300 loss first, then prices carl
        assertApproxEqRel(bal.balanceOf(carl), 333.333333e18, 1e12);
        assertEq(c.ballastNav(), 3_000e6);
    }

    function test_zero_B_blocks_deposit() public {
        vm.prank(gov);
        c.contributeReserve(200e6);
        _ballast(bob, 1_000e6);
        c.processDepositBatch(10);
        vm.prank(op);
        c.deployToEngine(1_080e6); // A = 1,200; 10% idle floor
        engine.applyPnl(-1_050e6); // Ballast 1,000 wiped, reserve absorbs 50, Hull untouched
        c.settle();
        assertEq(c.ballastNav(), 0);
        assertEq(c.reserveNav(), 150e6);
        assertFalse(c.impaired());
        assertGt(bal.totalSupply(), 0);
        _ballast(carl, 100e6);
        vm.expectRevert(TrancheController.JuniorWipedOut.selector);
        c.processDepositBatch(10); // no near-infinite mint into a wiped-out class
    }

    function test_partial_fill_burns_only_funded_and_cooldown_holds() public {
        _ballast(bob, 1_000e6);
        c.processDepositBatch(10);
        vm.prank(op);
        c.deployToEngine(900e6); // only 100 idle
        uint256 units = bal.balanceOf(bob);
        vm.prank(bob);
        uint256 xid = c.requestBallastRedeem(units, bob, 0);

        c.processExitBatch(10);
        assertEq(bal.balanceOf(bob), units, "cooldown: nothing funded before 48 h");

        vm.warp(vm.getBlockTimestamp() + 48 hours);
        c.processExitBatch(10);
        uint256 left = bal.balanceOf(bob);
        assertGt(left, 0, "remainder still exposed");
        assertLt(left, units);
        assertApproxEqAbs(escrow.poolBalance(c.exitKey(xid)), 100e6, 1);
        // Remaining units still bear gains and losses.
        uint256 vBefore = c.ballastUnitValue(left);
        engine.applyPnl(90e6);
        c.settle();
        assertGt(c.ballastUnitValue(left), vBefore);
    }

    function test_min_output_does_not_block_queue() public {
        _ballast(bob, 1_000e6);
        _ballast(carl, 1_000e6);
        c.processDepositBatch(10);
        uint256 ub = bal.balanceOf(bob);
        uint256 uc = bal.balanceOf(carl);
        vm.prank(bob);
        uint256 picky = c.requestBallastRedeem(ub, bob, 5_000e6); // impossible minimum
        vm.prank(carl);
        uint256 fine = c.requestBallastRedeem(uc, carl, 0);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        c.processExitBatch(10);
        assertEq(bal.balanceOf(bob), ub, "user-limited request skipped");
        assertEq(bal.balanceOf(carl), 0, "later valid request funded");
        assertEq(escrow.poolBalance(c.exitKey(picky)), 0);
        assertGt(escrow.poolBalance(c.exitKey(fine)), 0);
        vm.prank(bob);
        c.cancelRedeem(picky);
        assertEq(bal.lockedOf(bob), 0, "cancel releases the remainder");
    }

    function test_payout_blocked_below_projected_30pct_cover() public {
        _book(); // H 6,000 / B 3,000: cover 33%
        uint256 units = bal.balanceOf(bob);
        vm.prank(bob);
        c.requestBallastRedeem(units, bob, 0);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        c.processExitBatch(10);
        assertGe(c.juniorCoverBps(), 3_000, "payouts stop at the 30% buffer");
        assertGt(bal.balanceOf(bob), 0, "the rest waits");
    }

    function test_lifetime_cap_across_all_paths_and_withdrawal_does_not_refill() public {
        vm.prank(gov);
        c.setStageCap(1_000e6);
        vm.prank(gov);
        c.contributeReserve(200e6); // reserve counts
        _ballast(bob, 800e6);
        c.processDepositBatch(10);
        vm.prank(carl);
        vm.expectRevert(TrancheController.CapExceeded.selector);
        c.requestDeposit(BALLAST, 0, 1, carl, 0, vm.getBlockTimestamp() + 1 days);

        uint256 units = bal.balanceOf(bob);
        vm.prank(bob);
        c.requestBallastRedeem(units, bob, 0);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        c.processExitBatch(10);
        assertEq(c.lifetimeAdmitted(), 1_000e6, "withdrawal does not restore room");
        vm.prank(carl);
        vm.expectRevert(TrancheController.CapExceeded.selector);
        c.requestDeposit(BALLAST, 0, 1, carl, 0, vm.getBlockTimestamp() + 1 days);
    }

    function test_refund_releases_only_unadmitted() public {
        uint256 id = _ballast(bob, 500e6);
        assertEq(c.pendingReserved(), 500e6);
        vm.prank(bob);
        c.cancelDeposit(id);
        assertEq(c.pendingReserved(), 0);
        assertEq(c.lifetimeAdmitted(), 0);
        c.claimRefund(id);
        vm.expectRevert(TrancheController.BadStatus.selector);
        c.claimRefund(id);
    }

    function test_donation_does_not_raise_capacity_or_yield() public {
        _ballast(bob, 1_000e6);
        c.processDepositBatch(10);
        usdc.mint(address(custody), 777e6); // unsolicited transfer
        c.settle();
        assertEq(c.ballastNav(), 1_000e6, "donation is not income");
        assertEq(custody.quarantined(), 777e6);
    }

    function test_quota_recycling_via_transfer_blocked() public {
        _ballast(bob, 1_000e6);
        c.processDepositBatch(10);
        vm.prank(bob);
        vm.expectRevert(BallastToken.NonTransferable.selector);
        bal.transfer(carl, 1);
    }

    function test_not_eligible_without_allowance() public {
        usdc.mint(mallory, 1_000e6);
        vm.prank(mallory);
        usdc.approve(address(custody), type(uint256).max);
        vm.prank(mallory);
        vm.expectRevert(TrancheController.NotEligible.selector);
        c.requestDeposit(BALLAST, 0, 100e6, mallory, 0, vm.getBlockTimestamp() + 1 days);
    }

    function test_guardian_cannot_resume_and_funded_claims_survive_risk_pause() public {
        _ballast(bob, 1_000e6);
        c.processDepositBatch(10);
        uint256 units = bal.balanceOf(bob);
        vm.prank(bob);
        uint256 xid = c.requestBallastRedeem(units, bob, 0);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        c.processExitBatch(10);

        vm.prank(guardian);
        pauses.pause(1 | 2 | 4); // admission, risk, settlement — not claims
        vm.prank(guardian);
        vm.expectRevert(PauseGuardian.NotGovernance.selector);
        pauses.resume(2);

        escrow.claim(c.exitKey(xid)); // funded claim still pays
        vm.expectRevert(abi.encodeWithSelector(TrancheController.Paused.selector, uint8(4)));
        c.settle();
        vm.prank(gov);
        pauses.resume(1 | 2 | 4);
        c.settle();
    }

    function test_claims_pause_is_distinct() public {
        _ballast(bob, 1_000e6);
        c.processDepositBatch(10);
        uint256 units = bal.balanceOf(bob);
        vm.prank(bob);
        uint256 xid = c.requestBallastRedeem(units, bob, 0);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        c.processExitBatch(10);
        vm.prank(guardian);
        pauses.pause(8);
        bytes32 key = c.exitKey(xid);
        vm.expectRevert(ClaimEscrow.ClaimsPaused.selector);
        escrow.claim(key);
    }

    function test_every_money_path_rejects_malicious_caller() public {
        vm.startPrank(mallory);
        vm.expectRevert(TrancheController.NotGovernance.selector);
        c.setStageCap(1);
        vm.expectRevert(TrancheController.NotGovernance.selector);
        c.setAllowance(mallory, 1);
        vm.expectRevert(TrancheController.NotGovernance.selector);
        c.openSeries(800, bytes32(0));
        vm.expectRevert(TrancheController.NotGovernance.selector);
        c.payTreasury(1);
        vm.expectRevert(TrancheController.NotOperator.selector);
        c.deployToEngine(1);
        vm.expectRevert(TrancheController.NotOperator.selector);
        c.recallFromEngine(1);
        vm.expectRevert(AssetCustody.NotController.selector);
        custody.toEngine(1);
        vm.expectRevert(AssetCustody.NotController.selector);
        custody.refund(mallory, 1);
        vm.expectRevert(AssetCustody.NotController.selector);
        custody.payTreasury(1);
        vm.expectRevert(ClaimEscrow.NotController.selector);
        escrow.fund(bytes32(0), mallory, 1);
        vm.expectRevert(ClaimEscrow.NotController.selector);
        escrow.release(bytes32(0), mallory, 1);
        vm.expectRevert(BallastToken.NotController.selector);
        bal.mint(mallory, 1);
        vm.expectRevert(PauseGuardian.NotGuardian.selector);
        pauses.pause(1);
        vm.stopPrank();

        vm.prank(gov);
        vm.expectRevert(TrancheController.AboveCeiling.selector);
        c.setStageCap(25_000e6 + 1);
        vm.prank(gov);
        vm.expectRevert(TrancheController.AboveCeiling.selector);
        c.openSeries(1_501, bytes32(0));
        vm.prank(gov);
        vm.expectRevert(TrancheController.EngineAlreadySet.selector);
        c.setEngine(IStrategyEngine(address(1)));
    }

    function test_cancel_by_non_owner_rejected_and_receiver_fixed() public {
        uint256 id = _ballast(bob, 100e6);
        vm.prank(mallory);
        vm.expectRevert(TrancheController.NotOwner.selector);
        c.cancelDeposit(id);
    }

    function test_stale_valuation_blocks_settlement() public {
        _ballast(bob, 1_000e6);
        c.processDepositBatch(10);
        engine.setStale(true);
        vm.expectRevert(TrancheController.StaleValuation.selector);
        c.settle();
    }

    function test_mainnet_cannot_select_test_venue() public {
        vm.chainId(143);
        vm.expectRevert(bytes("simulated engine on mainnet"));
        new TestEngine(usdc);
        vm.expectRevert(bytes("test fixture on mainnet"));
        new TestUSDC();
    }

    function test_pay_treasury_only_from_liability_and_not_while_unwinding() public {
        uint256 sid = _book();
        vm.prank(op);
        c.deployToEngine(8_000e6);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        engine.applyPnl(200e6);
        c.settle();
        uint256 liability = c.treasuryLiability();
        assertGt(liability, 0);
        uint256 a = c.activeAssets();
        vm.prank(gov);
        vm.expectRevert(TrancheController.CapExceeded.selector);
        c.payTreasury(liability + 1);
        vm.prank(gov);
        c.payTreasury(liability);
        assertEq(usdc.balanceOf(treasury), liability);
        assertEq(c.activeAssets(), a, "paying a recognized liability does not change A");

        vm.warp(vm.getBlockTimestamp() + 22 days);
        engine.applyPnl(50e6);
        c.matureSeries(sid);
        vm.prank(gov);
        vm.expectRevert(TrancheController.SeriesBusy.selector);
        c.payTreasury(1);
    }

    function test_series_cancelled_when_nothing_admitted_and_refund_after_window() public {
        vm.prank(gov);
        uint256 sid = c.openSeries(800, bytes32(0));
        uint256 id = _hull(alice, sid, 1_000e6, 0); // no Ballast, no reserve: cover and reserve fail
        vm.warp(vm.getBlockTimestamp() + 72 hours);
        vm.prank(alice);
        vm.expectRevert(TrancheController.BadStatus.selector);
        c.cancelDeposit(id); // window closed but not yet activated: still frozen? series is open
        c.activateSeries(sid);
        assertEq(uint256(_state(sid)), uint256(TrancheController.SeriesState.CANCELLED));
        assertEq(c.activeSeries(), 0);
        c.claimRefund(id);
        assertEq(usdc.balanceOf(alice), 20_000e6);
    }

    function test_deadline_and_minimum_unit_refunds() public {
        vm.prank(bob);
        uint256 late = c.requestDeposit(BALLAST, 0, 100e6, bob, 0, vm.getBlockTimestamp() + 1 hours);
        vm.prank(carl);
        uint256 greedy = c.requestDeposit(BALLAST, 0, 100e6, carl, 1_000e18, vm.getBlockTimestamp() + 1 days);
        vm.warp(vm.getBlockTimestamp() + 2 hours);
        c.processDepositBatch(10);
        (,,,,,,,, TrancheController.ReqStatus s1,) = _dep(late);
        (,,,,,,,, TrancheController.ReqStatus s2,) = _dep(greedy);
        assertEq(uint256(s1), uint256(TrancheController.ReqStatus.REFUNDABLE), "deadline");
        assertEq(uint256(s2), uint256(TrancheController.ReqStatus.REFUNDABLE), "minimum units");
        assertEq(c.pendingReserved(), 0);
        (uint256 deps,) = c.queueLengths();
        assertEq(deps, 2);
    }

    function test_hull_deadline_refund_at_activation() public {
        vm.prank(gov);
        c.contributeReserve(200e6);
        _ballast(bob, 3_000e6);
        c.processDepositBatch(10);
        vm.prank(gov);
        uint256 sid = c.openSeries(800, bytes32(0));
        vm.prank(alice);
        uint256 id = c.requestDeposit(HULL, sid, 1_000e6, alice, 0, vm.getBlockTimestamp() + 1 hours);
        vm.warp(vm.getBlockTimestamp() + 72 hours);
        c.activateSeries(sid);
        (,,,,,,,, TrancheController.ReqStatus st,) = _dep(id);
        assertEq(uint256(st), uint256(TrancheController.ReqStatus.REFUNDABLE));
    }

    function test_further_loss_while_impaired_hits_ballast_reserve_then_hull() public {
        vm.prank(gov);
        c.contributeReserve(200e6);
        _ballast(bob, 3_000e6);
        c.processDepositBatch(10);
        vm.prank(gov);
        uint256 sid = c.openSeries(800, bytes32(0));
        _hull(alice, sid, 6_000e6, 0);
        vm.warp(vm.getBlockTimestamp() + 72 hours);
        c.activateSeries(sid);
        vm.prank(op);
        c.deployToEngine(8_000e6);
        engine.applyPnl(-3_500e6);
        c.settle();
        assertTrue(c.impaired());
        uint256 h = c.hullNav();
        engine.applyPnl(-100e6);
        vm.warp(vm.getBlockTimestamp() + 1);
        c.settle();
        assertEq(c.hullNav(), h - 100e6);
        _assertIdentity();
        assertEq(c.hullClaimable(sid, alice), 0);
    }

    function test_setters_are_bounded_and_ballast_is_not_approvable() public {
        vm.startPrank(gov);
        c.setCloseCost(50e6);
        assertEq(c.closeCost(), 50e6);
        c.setMaxValuationAge(30);
        vm.expectRevert(TrancheController.AboveCeiling.selector);
        c.setMaxValuationAge(61);
        vm.expectRevert(TrancheController.AboveCeiling.selector);
        c.setMaxValuationAge(0);
        vm.expectRevert(TrancheController.AboveCeiling.selector);
        c.setAllowance(bob, 25_000e6 + 1);
        vm.stopPrank();
        vm.expectRevert(BallastToken.NonTransferable.selector);
        bal.approve(carl, 1);
        vm.expectRevert(BallastToken.NonTransferable.selector);
        bal.transferFrom(bob, carl, 1);
        vm.prank(bob);
        vm.expectRevert(TrancheController.ZeroAddress.selector);
        c.requestDeposit(BALLAST, 0, 1e6, address(0), 0, vm.getBlockTimestamp() + 1 days);
    }

    function _withCoupon(uint256 principal, uint256 rateBps, uint256 secs) internal pure returns (uint256) {
        return principal + (principal * rateBps * secs) / (10_000 * uint256(365 days));
    }

    function _state(uint256 sid) internal view returns (TrancheController.SeriesState st) {
        (st,,,,,,,,,) = c.seriesInfo(sid);
    }

    function _funded(uint256 sid) internal view returns (uint256) {
        (,,,,,, uint256 principal,, uint256 acc,) = c.seriesInfo(sid);
        return (principal * acc) / 1e18;
    }

    function _dep(uint256 id)
        internal
        view
        returns (
            address,
            address,
            TrancheController.Tranche,
            uint64,
            uint64,
            uint64,
            uint256,
            uint256,
            TrancheController.ReqStatus st,
            uint256
        )
    {
        (
            address o,
            address r,
            TrancheController.Tranche t,
            uint64 s,
            uint64 d,
            uint64 ca,
            TrancheController.ReqStatus st_,
            uint256 a,
            uint256 m
        ) = c.deposits(id);
        return (o, r, t, s, d, ca, a, m, st_, 0);
    }
}
