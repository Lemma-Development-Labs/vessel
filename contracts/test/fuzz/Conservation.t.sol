// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DemoUSD} from "../../src/DemoUSD.sol";
import {Guardian} from "../../src/guards/Guardian.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Tranches} from "../../src/Tranches.sol";

contract ConservationFuzz is Test {
    DemoUSD internal dusd;
    Guardian internal guardian;
    BlitzVault internal vault;
    Tranches internal tranches;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        dusd = new DemoUSD();
        guardian = new Guardian(address(this));
        vault = new BlitzVault(dusd, address(guardian));
        tranches = new Tranches(address(vault), address(guardian), treasury);
        vault.setEngine(address(this));
        tranches.setEngine(address(this));
        _fill(alice, 10);
        _fill(bob, 10);
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
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

    function testFuzz_conservation(int96 rawG, uint32 rawDt) public {
        uint256 dt = bound(uint256(rawDt), 1, 365 days * 2);
        vm.warp(block.timestamp + dt);

        int256 maxLoss = int256(tranches.balTvl() + tranches.reserve());
        int256 hi = int256(uint256(200e6));
        int256 G = _boundInt(int256(rawG), maxLoss == 0 ? int256(0) : -maxLoss, hi);

        uint256 h0 = tranches.hullTvl();
        uint256 b0 = tranches.balTvl();
        uint256 r0 = tranches.reserve();
        uint256 t0 = tranches.treasuryAccrued();

        if (G < 0 && uint256(-G) > balPlus(r0, b0)) {
            vm.expectRevert(Tranches.HullImpairment.selector);
            tranches.settle(G);
            return;
        }

        tranches.settle(G);

        int256 dH = int256(tranches.hullTvl()) - int256(h0);
        int256 dB = int256(tranches.balTvl()) - int256(b0);
        int256 dR = int256(tranches.reserve()) - int256(r0);
        int256 dT = int256(tranches.treasuryAccrued()) - int256(t0);
        assertEq(dH + dB + dR + dT, G, "conservation");

        if (b0 + r0 > 0) {
            assertGe(tranches.hullTvl(), h0, "hull never decreases while junior capital remains");
        }
    }

    function testFuzz_floorHoldsOnJoinsExits(uint8 action, uint256 amtRaw) public {
        uint256 amt = bound(amtRaw, 1e6, 50e6);
        uint256 h = tranches.hullTvl();
        uint256 b = tranches.balTvl();
        if (action % 4 == 0) {
            // join ballast — should never breach
            if (dusd.balanceOf(bob) < amt) return;
            vm.startPrank(bob);
            dusd.approve(address(tranches), amt);
            tranches.joinBallast(amt);
            vm.stopPrank();
        } else if (action % 4 == 1) {
            if (dusd.balanceOf(alice) < amt) return;
            vm.startPrank(alice);
            dusd.approve(address(tranches), amt);
            uint256 newH = h + amt;
            if (b * 10_000 < 2_000 * (newH + b)) {
                vm.expectRevert();
                tranches.joinHull(amt);
                vm.stopPrank();
                return;
            }
            tranches.joinHull(amt);
            vm.stopPrank();
        } else if (action % 4 == 2) {
            uint256 supply = tranches.hullToken().totalSupply();
            if (supply == 0) return;
            uint256 shares = bound(amtRaw, 1, supply);
            vm.prank(alice);
            tranches.exitHull(shares);
        } else {
            uint256 supply = tranches.ballastToken().totalSupply();
            if (supply == 0) return;
            uint256 shares = bound(amtRaw, 1, supply);
            uint256 assetsOut = (shares * b) / supply;
            uint256 newB = b - assetsOut;
            bool wouldBreach = (h + newB) > 0 && newB * 10_000 < 2_000 * (h + newB);
            vm.prank(bob);
            if (wouldBreach) {
                uint256 oldBps = (b * 10_000) / (h + b);
                uint256 newBps = (h + newB) == 0 ? 10_000 : (newB * 10_000) / (h + newB);
                if (newBps < oldBps) {
                    vm.expectRevert();
                    tranches.exitBallast(shares);
                    return;
                }
            }
            tranches.exitBallast(shares);
        }

        h = tranches.hullTvl();
        b = tranches.balTvl();
        if (h + b > 0) {
            assertGe(b * 10_000, 2_000 * (h + b), "floor");
        }
    }

    function balPlus(uint256 r, uint256 b) internal pure returns (uint256) {
        return r + b;
    }

    function _boundInt(int256 x, int256 min, int256 max) internal pure returns (int256) {
        if (min > max) (min, max) = (max, min);
        uint256 range = uint256(max - min);
        if (range == 0) return min;
        uint256 shifted = uint256(x < 0 ? -x : x) % (range + 1);
        return min + int256(shifted);
    }
}
