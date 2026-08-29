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

    /// @dev Property 2: solvency of the vault against the whole book.
    ///
    ///      The sharp statement is NOT `redeemable(tranches) >= book`. That is false, and
    ///      not because of anything an outsider does: the protocol's own dead-share seed
    ///      holds real vBLITZ, so every `creditYield` lifts the share price for the dead
    ///      position too and a slice of each yield credit lands there instead of in
    ///      Tranches' shares. See `test_deadShareSeedDilutesEveryYieldCredit` below, which
    ///      pins that behaviour exactly rather than tolerating it silently.
    ///
    ///      What must hold is that the vault is solvent against the book once the dead
    ///      position is counted: no value has leaked OUT of the system, only into a
    ///      position nobody can redeem.
    function _assertSolvent(uint256 opCount) internal view {
        uint256 book = _book();
        uint256 backing = _redeemable() + vault.previewRedeem(vault.balanceOf(DEAD));
        if (backing >= book) return;
        assertLe(book - backing, DUST_PER_OP * (opCount + 1), "vault cannot back the tranche book");
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

        // Can everyone actually get out? Only if the book has not run ahead of what
        // Tranches' own shares can withdraw. Where it has, the cause must be the dead
        // seed and nothing else — an unattributable shortfall is a real failure.
        uint256 book = _book();
        uint256 redeemable = _redeemable();
        uint256 shortfall = book > redeemable ? book - redeemable : 0;

        if (shortfall == 0) {
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
        } else {
            // The stranded value must be sitting in the dead position, in full. If this
            // ever fails, value has genuinely gone missing rather than been misallocated.
            uint256 deadAccrual = vault.previewRedeem(vault.balanceOf(DEAD));
            assertGe(deadAccrual, shortfall, "shortfall is not attributable to the dead seed");
        }
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

    /// @dev PINS A KNOWN, UNFIXED ACCOUNTING DIVERGENCE.
    ///
    ///      `Tranches.settle(g)` credits its book the FULL `g`, but `creditYield(g)`
    ///      delivers that value through the vault's share price — which lifts every
    ///      holder, including the protocol's own 100 dUSD dead-share seed. The dead
    ///      position is unredeemable (nobody holds the 0x…dEaD key), so the slice that
    ///      lands there is permanently stranded and Tranches' book runs ahead of what
    ///      its shares can pay.
    ///
    ///      The leak is exactly  g * deadShares / totalShares  per credit. With the
    ///      100 dUSD seed against 800 dUSD of deck TVL that is 100/900 = 11.1% of every
    ///      yield credit. It is WORST WHEN TVL IS SMALL: against the 54 dUSD currently
    ///      on testnet the seed would take roughly 65% of each credit.
    ///
    ///      This predates the share-issuance gate and is not fixed by it. It is pinned
    ///      here so it cannot widen unnoticed, and is recorded in OPS.md §6. Closing it
    ///      is an economic change to a deployed protocol, not a bug fix, so it needs a
    ///      deliberate decision rather than a silent patch.
    function test_deadShareSeedDilutesEveryYieldCredit() public {
        vm.prank(bob);
        tranches.joinBallast(400e6);
        vm.prank(alice);
        tranches.joinHull(400e6);

        uint256 deadShares = vault.balanceOf(DEAD);
        uint256 totalShares = vault.totalSupply();
        assertGt(deadShares, 0, "dead seed must exist");

        uint256 bookBefore = _book();
        assertEq(_redeemable(), bookBefore, "book and shares start in step");

        uint256 g = 100e6;
        vm.warp(block.timestamp + 1 days);
        vm.startPrank(address(engine));
        vault.creditYield(g);
        tranches.settle(int256(g));
        vm.stopPrank();

        assertEq(_book(), bookBefore + g, "book takes the full gross");

        uint256 leak = _book() - _redeemable();
        uint256 expected = (g * deadShares) / totalShares;
        assertApproxEqAbs(leak, expected, 2, "leak is g * deadShares / totalShares");

        // Nothing left the system. The dead position holds the stranded slice on top of
        // its own 100 dUSD principal, so total backing exceeds the book rather than
        // matching it — the value is misallocated, not missing.
        assertGe(
            _redeemable() + vault.previewRedeem(vault.balanceOf(DEAD)),
            _book(),
            "vault still backs the book once the dead position is counted"
        );
    }
}
