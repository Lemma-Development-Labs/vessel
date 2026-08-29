// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "../helpers/Fixture.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Tranches} from "../../src/Tranches.sol";

/// @dev Randomised traffic: tranche joins and exits interleaved with attempted raw
///      ERC-4626 calls from outsiders. Three properties must survive every sequence:
///
///        1. the 20% subordination floor,
///        2. NO OUTSIDE SHARES — vBLITZ is only ever held by Tranches and the dead seed,
///           which is the sharp thing the share-issuance gate buys, and
///        3. SOLVENCY of the vault against the tranche book, counting the dead position.
///
///      Property 3 is deliberately NOT `redeemable(tranches) >= book`. That statement is
///      false, and not because of anything an outsider does — see
///      `test_deadShareSeedDilutesEveryYieldCredit`, which pins the reason exactly.
contract SolvencyFuzz is Fixture {
    address internal attacker = makeAddr("attacker");
    address internal attacker2 = makeAddr("attacker2");

    /// @dev Worst-case rounding drift of `book - redeemable`, in asset wei per operation.
    ///      Two independent floors run per op, both favouring the vault over Tranches:
    ///        - join:  `vault.deposit` floors assets -> shares, so Tranches banks the full
    ///                 `assets` in its book but receives shares worth up to 1 wei less.
    ///        - exit:  `vault.withdraw` ceils shares burned, so Tranches gives up shares
    ///                 worth up to 1 wei more than the assets it removes from its book.
    ///      Each is strictly < 1 wei, so 2 wei per op is a sound bound.
    uint256 internal constant DUST_PER_OP = 2;

    function setUp() public {
        _deploy();
        deal(address(dusd), alice, 1_000_000e6, true);
        deal(address(dusd), bob, 1_000_000e6, true);
        deal(address(dusd), attacker, 1_000_000e6, true);
        deal(address(dusd), attacker2, 1_000_000e6, true);
        deal(address(dusd), address(engine), 1_000_000e6, true);

        vm.prank(alice);
        dusd.approve(address(tranches), type(uint256).max);
        vm.prank(bob);
        dusd.approve(address(tranches), type(uint256).max);
        vm.prank(attacker);
        dusd.approve(address(vault), type(uint256).max);
        vm.prank(attacker2);
        dusd.approve(address(vault), type(uint256).max);
        vm.prank(address(engine));
        dusd.approve(address(vault), type(uint256).max);
    }

    function _book() internal view returns (uint256) {
        return tranches.hullTvl() + tranches.balTvl() + tranches.reserve() + tranches.treasuryAccrued();
    }

    function _redeemable() internal view returns (uint256) {
        return vault.previewRedeem(vault.balanceOf(address(tranches)));
    }

    /// @dev Property 1: the subordination floor.
    function _assertFloor() internal view {
        uint256 h = tranches.hullTvl();
        uint256 b = tranches.balTvl();
        if (h + b == 0) return;
        assertGe(b * 10_000, tranches.THETA_MIN_BPS() * (h + b), "subordination floor breached");
    }

    /// @dev Property 2: SOLVENCY, in its strong form.
    ///
    ///      Tranches' asset-denominated book must be redeemable from the vBLITZ it actually
    ///      holds. This is the statement the protocol is supposed to satisfy, and it now does:
    ///      dead shares no longer earn, so no slice of a yield credit is diverted into a
    ///      position nobody can redeem. Only rounding dust separates the two.
    ///
    ///      This assertion was previously weakened to count the dead position as backing,
    ///      because the protocol could not meet the strong form. The protocol was fixed
    ///      instead — see BlitzVault._convertToShares / liveAssets / liveSupply.
    function _assertSolvent(uint256 opCount) internal view {
        uint256 book = _book();
        uint256 redeemable = _redeemable();
        if (redeemable >= book) return;
        assertLe(book - redeemable, DUST_PER_OP * (opCount + 1), "book exceeds what Tranches' shares can redeem");
    }

    /// @dev Property 3: the share-issuance gate. This is the sharp version of what the
    ///      gate buys — vBLITZ is only ever held by Tranches and the dead seed, so no
    ///      third party can ever dilute a yield credit.
    function _assertNoOutsideShares() internal view {
        assertEq(
            vault.totalSupply(),
            vault.balanceOf(address(tranches)) + vault.balanceOf(DEAD),
            "a third party holds vBLITZ"
        );
    }

    /// @dev Attempt every raw 4626 mint path. All must bounce off the gate.
    function _attemptBypass(address who, uint256 amount) internal {
        vm.startPrank(who);
        vm.expectRevert(BlitzVault.NotTranches.selector);
        vault.deposit(amount, who);
        vm.expectRevert(BlitzVault.NotTranches.selector);
        vault.mint(amount * 1e6, who);
        vm.stopPrank();
        assertEq(vault.balanceOf(who), 0, "outsider must never hold vBLITZ");
    }

    function testFuzz_solvencyUnderMixedTraffic(uint256 seed, uint8 rawOps) public {
        uint256 ops = bound(uint256(rawOps), 1, 24);

        // Ballast must lead, or the very first join breaches the floor.
        vm.prank(bob);
        tranches.joinBallast(100e6);

        for (uint256 i; i < ops; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 action = seed % 8;
            uint256 amount = bound(uint256(uint128(seed >> 8)), tranches.MIN_JOIN(), 50_000e6);

            if (action == 0) {
                vm.prank(alice);
                try tranches.joinHull(amount) {} catch {}
            } else if (action == 1) {
                vm.prank(bob);
                try tranches.joinBallast(amount) {} catch {}
            } else if (action == 2) {
                uint256 sh = tranches.hullToken().balanceOf(alice);
                if (sh > 0) {
                    uint256 burn = bound(uint256(uint128(seed >> 136)), 1, sh);
                    vm.prank(alice);
                    try tranches.exitHull(burn) {} catch {}
                }
            } else if (action == 3) {
                uint256 sh = tranches.ballastToken().balanceOf(bob);
                if (sh > 0) {
                    uint256 burn = bound(uint256(uint128(seed >> 136)), 1, sh);
                    vm.prank(bob);
                    try tranches.exitBallast(burn) {} catch {}
                }
            } else if (action == 4) {
                _attemptBypass(attacker, amount);
            } else if (action == 5) {
                _attemptBypass(attacker2, amount);
            } else if (action == 6) {
                // A donation to the vault must not let the book outrun the shares.
                vm.prank(attacker);
                dusd.transfer(address(vault), amount);
            } else {
                // A funded settle, mirroring EngineLite: cash is credited, then booked.
                uint256 tvl = tranches.hullTvl() + tranches.balTvl() + tranches.reserve();
                if (tvl == 0) continue;
                uint256 g = bound(uint256(uint128(seed >> 136)), 1, (tvl * 5_000) / 10_000);
                vm.warp(block.timestamp + 1 days);
                vm.startPrank(address(engine));
                vault.creditYield(g);
                tranches.settle(int256(g));
                vm.stopPrank();
            }

            _assertFloor();
            _assertSolvent(i + 1);
            _assertNoOutsideShares();
        }

        // Everyone can actually get out. Before the dead-share fix this reverted with
        // ERC4626ExceededMaxWithdraw once enough yield had been credited, because the book
        // had run ahead of what Tranches' shares could withdraw.
        uint256 hullShares = tranches.hullToken().balanceOf(alice);
        if (hullShares > 0) {
            vm.prank(alice);
            tranches.exitHull(hullShares);
        }
        uint256 balShares = tranches.ballastToken().balanceOf(bob);
        if (balShares > 0) {
            vm.prank(bob);
            tranches.exitBallast(balShares);
        }
        _assertFloor();
        _assertSolvent(ops + 1);
    }

    /// @dev Same shape, but pins the exact worst-case drift rather than a bound, so a
    ///      regression that widens rounding shows up as a failure rather than slack.
    function testFuzz_driftStaysWithinOneWeiPerOperation(uint256 seed, uint8 rawOps) public {
        uint256 ops = bound(uint256(rawOps), 1, 24);
        vm.prank(bob);
        tranches.joinBallast(100e6);

        uint256 performed;
        for (uint256 i; i < ops; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 amount = bound(uint256(uint128(seed >> 8)), tranches.MIN_JOIN(), 10_000e6);
            if (seed % 2 == 0) {
                vm.prank(alice);
                try tranches.joinHull(amount) {
                    performed++;
                } catch {}
            } else {
                vm.prank(bob);
                try tranches.joinBallast(amount) {
                    performed++;
                } catch {}
            }
        }
        uint256 book = _book();
        uint256 redeemable = _redeemable();
        if (book > redeemable) {
            assertLe(book - redeemable, performed + 1, "join drift exceeds 1 wei per join");
        }
    }

    /// @dev REGRESSION: dead shares must not earn.
    ///
    ///      Before the fix, `Tranches.settle(g)` credited its book the full `g` while
    ///      `creditYield(g)` delivered that value through the vault share price — lifting the
    ///      protocol's own 100 dUSD dead seed along with everyone else. The slice that landed
    ///      there was stranded forever (nobody holds the 0x…dEaD key), so the book outran the
    ///      shares by `g * deadShares / totalShares`: 11.1% of every credit at 800 dUSD of deck
    ///      TVL, and ~65% against the 54 dUSD that was live on testnet. It compounded per crank
    ///      and terminated in a final exit that reverted.
    ///
    ///      Conversions now run over the live pool only, so the seed's entitlement is pinned at
    ///      `deadPrincipal` and every credited dollar reaches Tranches.
    function test_deadShareSeedDoesNotEarn() public {
        vm.prank(bob);
        tranches.joinBallast(400e6);
        vm.prank(alice);
        tranches.joinHull(400e6);

        uint256 deadShares = vault.balanceOf(DEAD);
        assertGt(deadShares, 0, "dead seed must still exist for inflation protection");
        assertEq(vault.deadShares(), deadShares, "vault tracks the seed");
        uint256 principalBefore = vault.deadPrincipal();

        uint256 bookBefore = _book();
        assertApproxEqAbs(_redeemable(), bookBefore, 2, "book and shares start in step");

        uint256 g = 100e6;
        vm.warp(block.timestamp + 1 days);
        vm.startPrank(address(engine));
        vault.creditYield(g);
        tranches.settle(int256(g));
        vm.stopPrank();

        assertEq(_book(), bookBefore + g, "book takes the full gross");

        // The whole credit reaches Tranches. Previously 11,111,111 wei of it did not.
        assertApproxEqAbs(_redeemable(), bookBefore + g, 2, "the full yield credit reaches Tranches");
        assertEq(vault.deadPrincipal(), principalBefore, "the seed's entitlement never moves");
    }

    /// @dev R1.1 exit condition: a full exit of every position must leave nothing stranded and
    ///      must not revert with ERC4626ExceededMaxWithdraw.
    function test_fullExitAfterYieldStrandsNothing() public {
        vm.prank(bob);
        tranches.joinBallast(400e6);
        vm.prank(alice);
        tranches.joinHull(400e6);

        // Several epochs of real, funded yield — the case that used to compound the leak.
        // Absolute, monotonically increasing timestamps: settle() reverts DtZero when two
        // settles land in the same second.
        uint256 t = block.timestamp;
        for (uint256 i; i < 8; i++) {
            t += 1 days;
            vm.warp(t);
            vm.startPrank(address(engine));
            vault.creditYield(25e6);
            tranches.settle(int256(uint256(25e6)));
            vm.stopPrank();
        }

        uint256 hullShares = tranches.hullToken().balanceOf(alice);
        uint256 balShares = tranches.ballastToken().balanceOf(bob);

        vm.prank(alice);
        uint256 hullOut = tranches.exitHull(hullShares);
        vm.prank(bob);
        uint256 balOut = tranches.exitBallast(balShares);

        assertGt(hullOut, 0, "hull exits with value");
        assertGt(balOut, 0, "ballast exits with value");
        assertLe(tranches.hullTvl(), 2, "hull deck drained");
        assertLe(tranches.balTvl(), 2, "ballast deck drained");

        // What remains in Tranches' shares is exactly the protocol's own book — reserve plus
        // unclaimed treasury — and nothing else is stranded on its side of the vault.
        uint256 remainingBook = tranches.reserve() + tranches.treasuryAccrued();
        assertApproxEqAbs(_redeemable(), remainingBook, 4, "nothing stranded beyond reserve + treasury");

        // The seed still holds exactly its principal, never more.
        assertEq(vault.deadPrincipal(), 100e6, "seed entitlement unchanged");
    }
}
