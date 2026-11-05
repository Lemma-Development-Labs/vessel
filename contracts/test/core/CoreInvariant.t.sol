// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {TrancheController} from "../../src/core/TrancheController.sol";
import {AssetCustody} from "../../src/core/AssetCustody.sol";
import {ClaimEscrow} from "../../src/core/ClaimEscrow.sol";
import {BallastToken} from "../../src/core/BallastToken.sol";
import {PauseGuardian} from "../../src/core/governance/PauseGuardian.sol";
import {IPauseGuardian, IStrategyEngine} from "../../src/core/interfaces/ICore.sol";
import {TestEngine, TestUSDC} from "../fixtures/CoreFixtures.sol";

/// @notice Random deposit / admission / exit / PnL / settlement / time sequences.
contract CoreHandler is Test {
    TrancheController public c;
    TestUSDC public usdc;
    TestEngine public engine;
    address public op;
    address[3] internal users;
    uint256[] internal exitIds;
    // Ghost counters: prove the campaign exercises real state, not swallowed reverts.
    uint256 public okDeposits;
    uint256 public okAdmitBatches;
    uint256 public okExitBatches;
    uint256 public okClaims;
    uint256 public okSettles;

    constructor(TrancheController c_, TestUSDC usdc_, TestEngine engine_, address op_, address[3] memory users_) {
        c = c_;
        usdc = usdc_;
        engine = engine_;
        op = op_;
        users = users_;
    }

    function deposit(uint256 who, uint256 amount) external {
        address u = users[who % 3];
        amount = bound(amount, 1e6, 2_000e6);
        vm.prank(u);
        try c.requestDeposit(TrancheController.Tranche.BALLAST, 0, amount, u, 0, vm.getBlockTimestamp() + 3 days) {
            okDeposits++;
        } catch {}
    }

    function admit() external {
        try c.processDepositBatch(5) returns (uint256 n) {
            if (n > 0) okAdmitBatches++;
        } catch {}
    }

    function requestExit(uint256 who, uint256 frac) external {
        address u = users[who % 3];
        BallastToken b = c.ballast();
        uint256 free = b.balanceOf(u) - b.lockedOf(u);
        if (free == 0) return;
        uint256 units = bound(frac, 1, free);
        vm.prank(u);
        exitIds.push(c.requestBallastRedeem(units, u, 0));
    }

    function processExits() external {
        try c.processExitBatch(5) returns (uint256 n) {
            if (n > 0) okExitBatches++;
        } catch {}
    }

    function claim(uint256 i) external {
        if (exitIds.length == 0) return;
        bytes32 key = c.exitKey(exitIds[i % exitIds.length]);
        try c.escrow().claim(key) {
            okClaims++;
        } catch {}
    }

    function deploy(uint256 amount) external {
        amount = bound(amount, 0, c.custody().activeIdle());
        vm.prank(op);
        try c.deployToEngine(amount) {} catch {}
    }

    function recall(uint256 amount) external {
        amount = bound(amount, 0, usdc.balanceOf(address(engine)));
        vm.prank(op);
        c.recallFromEngine(amount);
    }

    function pnl(int256 x) external {
        uint256 held = usdc.balanceOf(address(engine));
        x = bound(x, -int256(held), int256(held / 10) + 1);
        engine.applyPnl(x);
    }

    function settle() external {
        try c.settle() {
            okSettles++;
        } catch {}
    }

    function warp(uint256 dt) external {
        vm.warp(vm.getBlockTimestamp() + bound(dt, 1, 3 days));
    }
}

/// forge-config: default.invariant.runs = 64
/// forge-config: default.invariant.depth = 64
/// forge-config: ci.invariant.runs = 256
/// forge-config: ci.invariant.depth = 128
contract CoreInvariantTest is Test {
    TrancheController c;
    TestUSDC usdc;
    TestEngine engine;
    CoreHandler handler;
    address gov = makeAddr("gov");
    address op = makeAddr("op");

    function setUp() public {
        vm.warp(1_790_000_000);
        usdc = new TestUSDC();
        PauseGuardian pauses = new PauseGuardian(makeAddr("guardian"), gov);
        c = new TrancheController(usdc, IPauseGuardian(address(pauses)), gov, op, makeAddr("treasury"), 1e12, 1);
        engine = new TestEngine(usdc);
        engine.setCustody(address(c.custody()));
        address[3] memory users = [makeAddr("u0"), makeAddr("u1"), makeAddr("u2")];
        vm.startPrank(gov);
        c.setEngine(IStrategyEngine(address(engine)));
        c.setStageCap(25_000e6);
        for (uint256 i = 0; i < 3; i++) {
            c.setAllowance(users[i], 25_000e6);
        }
        vm.stopPrank();
        address custodyAddr = address(c.custody()); // never inside a pranked call's arguments
        for (uint256 i = 0; i < 3; i++) {
            usdc.mint(users[i], 50_000e6);
            vm.prank(users[i]);
            usdc.approve(custodyAddr, type(uint256).max);
        }
        handler = new CoreHandler(c, usdc, engine, op, users);
        targetContract(address(handler));
    }

    /// @dev After any settlement the book satisfies A = H + B + R (checked by settling here).
    function invariant_active_identity() public {
        try c.settle() {
            assertEq(c.activeAssets(), c.hullNav() + c.ballastNav() + c.reserveNav());
        } catch {}
    }

    /// @dev Physical backing: custody holds at least pending + active idle; escrow backs every pool.
    function invariant_custody_and_escrow_backed() public view {
        AssetCustody cu = c.custody();
        ClaimEscrow es = c.escrow();
        assertGe(usdc.balanceOf(address(cu)), cu.pending() + cu.activeIdle());
        assertGe(usdc.balanceOf(address(es)), es.totalFunded());
    }

    /// @dev Caps: admitted + reserved never exceed the stage cap or the V1 ceiling.
    function invariant_caps_hold() public view {
        assertLe(c.lifetimeAdmitted() + c.pendingReserved(), c.stageCap());
        assertLe(c.stageCap(), c.ABSOLUTE_LIFETIME_CAP());
    }

    /// @dev No unsupported mint: units exist only if junior capital was admitted.
    function invariant_no_unbacked_units() public view {
        if (c.ballast().totalSupply() > 0) assertGt(c.lifetimeAdmitted(), 0);
        assertEq(c.custody().pending() >= c.pendingReserved() ? 1 : 0, 1, "pending escrow backs reservations");
    }

    function afterInvariant() public view {
        console2.log("deposits", handler.okDeposits(), "admit batches", handler.okAdmitBatches());
        console2.log("exit batches", handler.okExitBatches(), "claims", handler.okClaims());
        console2.log("settles", handler.okSettles(), "ballast supply", c.ballast().totalSupply());
    }
}
