// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DeployV2} from "../../script/DeployV2.s.sol";
import {DemoUSD} from "../../src/DemoUSD.sol";
import {TrancheController} from "../../src/core/TrancheController.sol";
import {SimulatedEngine} from "../../src/core/testnet/SimulatedEngine.sol";
import {PauseGuardian} from "../../src/core/governance/PauseGuardian.sol";

/// @notice Rehearses the testnet deployment end to end on a local chain: DeployV2 script, Safe →
///         timelock governance batches, DemoUSD faucet limits, simulated funding, and the full
///         Hull + Ballast lifecycle.
contract DeployV2RehearsalTest is Test {
    DemoUSD dusd;
    DeployV2.Deployed d;
    TrancheController c;
    SimulatedEngine eng;
    TimelockController tl;
    address safe = makeAddr("safe");
    address op = makeAddr("operator");
    uint256 constant DELAY = 300;
    uint256 salt;

    function setUp() public {
        vm.warp(1_790_000_000);
        dusd = new DemoUSD();
        vm.setEnv("DEPLOYER_PK", vm.toString(uint256(0xA11CE)));
        vm.setEnv("V2_SAFE", vm.toString(safe));
        vm.setEnv("V2_OPERATOR", vm.toString(op));
        vm.setEnv("V2_ASSET", vm.toString(address(dusd)));
        vm.setEnv("V2_TIMELOCK_DELAY", vm.toString(DELAY));
        vm.setEnv("V2_MANIFEST_OUT", "out/rehearsal-v2.json");
        d = new DeployV2().run();
        c = TrancheController(d.controller);
        eng = SimulatedEngine(d.engine);
        tl = TimelockController(payable(d.timelock));
    }

    /// @dev Safe schedules a batch on the timelock, waits the delay, executes.
    function _govern(address[] memory targets, bytes[] memory payloads) internal {
        uint256[] memory values = new uint256[](targets.length);
        bytes32 s = bytes32(++salt);
        vm.prank(safe);
        tl.scheduleBatch(targets, values, payloads, bytes32(0), s, DELAY);
        vm.expectRevert(); // not ready before the delay
        vm.prank(safe);
        tl.executeBatch(targets, values, payloads, bytes32(0), s);
        vm.warp(vm.getBlockTimestamp() + DELAY);
        vm.prank(safe);
        tl.executeBatch(targets, values, payloads, bytes32(0), s);
    }

    function _faucet(address who, uint256 times) internal {
        for (uint256 i = 0; i < times; i++) {
            vm.prank(who);
            dusd.faucet();
            vm.warp(vm.getBlockTimestamp() + 1 hours);
        }
    }

    function test_deployer_keeps_no_role_and_mainnet_refused() public {
        address deployer = vm.addr(0xA11CE);
        assertEq(c.governance(), d.timelock);
        assertEq(c.operator(), op);
        assertEq(PauseGuardian(d.pauses).governance(), d.timelock);
        assertTrue(c.governance() != deployer && c.operator() != deployer);
        assertTrue(eng.isSimulated());
        assertEq(tl.getMinDelay(), DELAY);
        assertFalse(tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), deployer), "no timelock admin");
        assertTrue(tl.hasRole(tl.PROPOSER_ROLE(), safe));

        vm.chainId(143);
        DeployV2 s = new DeployV2();
        vm.expectRevert(bytes("DeployV2: mainnet requires the release process (Session 8)"));
        s.run();
    }

    function test_rehearsal_full_lifecycle_through_timelock() public {
        address[6] memory users =
            [makeAddr("b1"), makeAddr("b2"), makeAddr("b3"), makeAddr("h1"), makeAddr("h2"), makeAddr("seed")];

        // Test dollars for the reserve seed and the funding pot come from faucets, then move to
        // the timelock (reserve) and the engine pot.
        _faucet(users[5], 3);
        vm.prank(users[5]);
        dusd.transfer(d.timelock, 20e6);
        vm.prank(users[5]);
        dusd.approve(address(eng), 200e6);
        vm.prank(users[5]);
        eng.seed(200e6);

        // Governance batch 1: wire the engine, set caps and allowances, fund the reserve, set funding.
        address[] memory t = new address[](11);
        bytes[] memory p = new bytes[](11);
        t[0] = d.controller;
        p[0] = abi.encodeCall(TrancheController.setEngine, (eng));
        t[1] = d.controller;
        p[1] = abi.encodeCall(TrancheController.setStageCap, (1_000e6));
        for (uint256 i = 0; i < 5; i++) {
            t[2 + i] = d.controller;
            p[2 + i] = abi.encodeCall(TrancheController.setAllowance, (users[i], 500e6));
        }
        t[7] = address(dusd);
        p[7] = abi.encodeWithSignature("approve(address,uint256)", d.custody, 20e6);
        t[8] = d.controller;
        p[8] = abi.encodeCall(TrancheController.contributeReserve, (20e6));
        t[9] = d.engine;
        p[9] = abi.encodeCall(SimulatedEngine.setFundingRateBps, (int256(1_200)));
        t[10] = d.controller;
        p[10] = abi.encodeCall(TrancheController.setCloseCost, (1e6));
        _govern(t, p);
        assertEq(c.reserveNav(), 20e6);

        // Ballast from three wallets (faucet limits: 100 dUSD / hour).
        for (uint256 i = 0; i < 3; i++) {
            _faucet(users[i], 3);
            vm.prank(users[i]);
            dusd.approve(d.custody, type(uint256).max);
            vm.prank(users[i]);
            c.requestDeposit(TrancheController.Tranche.BALLAST, 0, 300e6, users[i], 0, vm.getBlockTimestamp() + 1 days);
        }
        c.processDepositBatch(10);
        assertEq(c.ballastNav(), 900e6);
        assertEq(c.lifetimeAdmitted(), 920e6, "reserve seed counts against the cap");

        // Governance batch 2: open the Hull series.
        address[] memory t2 = new address[](1);
        bytes[] memory p2 = new bytes[](1);
        t2[0] = d.controller;
        p2[0] = abi.encodeCall(TrancheController.openSeries, (800, keccak256("testnet series 1 terms")));
        _govern(t2, p2);
        uint256 sid = c.activeSeries();

        // Hull: 80 left under the 1,000 stage cap.
        _faucet(users[3], 1);
        vm.prank(users[3]);
        dusd.approve(d.custody, type(uint256).max);
        vm.prank(users[3]);
        c.requestDeposit(TrancheController.Tranche.HULL, sid, 80e6, users[3], 800, vm.getBlockTimestamp() + 5 days);
        vm.prank(users[4]);
        vm.expectRevert(TrancheController.CapExceeded.selector);
        c.requestDeposit(TrancheController.Tranche.HULL, sid, 1e6, users[4], 0, vm.getBlockTimestamp() + 5 days);

        vm.warp(vm.getBlockTimestamp() + 72 hours);
        c.activateSeries(sid);
        assertEq(c.hullNav(), 80e6);

        // Operator deploys to the simulated engine; 12% simulated funding accrues from the pot.
        vm.prank(op);
        c.deployToEngine(800e6);
        vm.warp(vm.getBlockTimestamp() + 28 days);
        uint256 before = c.hullNav() + c.ballastNav() + c.reserveNav() + c.treasuryLiability();
        c.matureSeries(sid);
        uint256 afterSum = c.hullNav() + c.ballastNav() + c.reserveNav() + c.treasuryLiability();
        assertGt(afterSum, before, "simulated funding income recognized");
        assertEq(c.activeAssets(), c.hullNav() + c.ballastNav() + c.reserveNav());

        vm.prank(op);
        c.recallFromEngine(800e6);
        c.fundSeries(sid);
        uint256 h1Before = dusd.balanceOf(users[3]);
        vm.prank(users[3]);
        c.claimHull(sid);
        assertGe(dusd.balanceOf(users[3]) - h1Before + 1, 80e6 + (80e6 * 800 * 28 days) / (10_000 * uint256(365 days)));

        // A Ballast holder exits after the cooldown and claims from escrow.
        uint256 units = c.ballast().balanceOf(users[0]);
        vm.prank(users[0]);
        uint256 xid = c.requestBallastRedeem(units, users[0], 0);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        c.processExitBatch(10);
        uint256 b1Before = dusd.balanceOf(users[0]);
        c.escrow().claim(c.exitKey(xid));
        assertGt(dusd.balanceOf(users[0]) - b1Before, 300e6, "junior earned the residual");
    }
}
