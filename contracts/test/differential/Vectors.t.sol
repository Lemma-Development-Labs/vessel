// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Waterfall} from "../../src/core/libraries/Waterfall.sol";
import {Coupon} from "../../src/core/libraries/Coupon.sol";
import {Coverage} from "../../src/core/libraries/Coverage.sol";

contract WaterfallHarness {
    function settle(Waterfall.In memory s) external pure returns (Waterfall.Out memory) {
        return Waterfall.settle(s);
    }
}

/// @notice Solidity vs the independent reference model (reference/vectors, exported by
///         reference/export_vectors.py from the unchanged reference_model.py).
contract VectorsTest is Test {
    WaterfallHarness h = new WaterfallHarness();
    string constant DIR = "../reference/vectors/";

    function _u(string memory json, string memory key) private pure returns (uint256) {
        return vm.parseUint(vm.parseJsonString(json, key));
    }

    function _i(string memory json, string memory key) private pure returns (int256) {
        return vm.parseInt(vm.parseJsonString(json, key));
    }

    function test_golden_vectors_match_reference() public view {
        string memory json = vm.readFile(string.concat(DIR, "settlement.json"));
        for (uint256 k = 0; k < 8; k++) {
            string memory p = string.concat(".cases[", vm.toString(k), "]");
            Waterfall.Out memory o = h.settle(
                Waterfall.In({
                    H: _u(json, string.concat(p, ".in.H")),
                    B: _u(json, string.concat(p, ".in.B")),
                    R: _u(json, string.concat(p, ".in.R")),
                    G: _i(json, string.concat(p, ".in.G")),
                    C: _u(json, string.concat(p, ".in.C")),
                    L: _u(json, string.concat(p, ".in.L")),
                    feesDisabled: vm.parseJsonBool(json, string.concat(p, ".in.feesDisabled"))
                })
            );
            string memory name = vm.parseJsonString(json, string.concat(p, ".name"));
            assertEq(o.H, _u(json, string.concat(p, ".out.H")), string.concat(name, " H"));
            assertEq(o.B, _u(json, string.concat(p, ".out.B")), string.concat(name, " B"));
            assertEq(o.R, _u(json, string.concat(p, ".out.R")), string.concat(name, " R"));
            assertEq(o.F, _u(json, string.concat(p, ".out.F")), string.concat(name, " F"));
            assertEq(o.FR, _u(json, string.concat(p, ".out.FR")), string.concat(name, " FR"));
            assertEq(o.FT, _u(json, string.concat(p, ".out.FT")), string.concat(name, " FT"));
            assertEq(o.Lnext, _u(json, string.concat(p, ".out.Lnext")), string.concat(name, " Lnext"));
            assertEq(
                o.impaired, vm.parseJsonBool(json, string.concat(p, ".out.impaired")), string.concat(name, " impaired")
            );
        }
    }

    /// @dev 5,000 seeded cases + fee-disabled variants (16 words per case), checked in ten
    ///      slices of 1,000 so no single call frame hits the EVM memory-gas ceiling.
    function _seeded(uint256 from, uint256 to) private view {
        bytes memory blob = vm.readFileBinary(string.concat(DIR, "settlement_seeded.bin"));
        assertEq(blob.length / (16 * 32), 10_000);
        for (uint256 k = from; k < to; k++) {
            uint256[16] memory w;
            uint256 off = k * 16 * 32;
            for (uint256 j = 0; j < 16; j++) {
                uint256 v;
                assembly {
                    v := mload(add(add(blob, 0x20), add(off, mul(j, 0x20))))
                }
                w[j] = v;
            }
            Waterfall.Out memory o = h.settle(
                Waterfall.In({H: w[0], B: w[1], R: w[2], G: int256(w[3]), C: w[4], L: w[5], feesDisabled: w[6] == 1})
            );
            if (
                o.H != w[7] || o.B != w[8] || o.R != w[9] || o.F != w[10] || o.FR != w[11] || o.FT != w[12]
                    || o.Lnext != w[13] || o.impaired != (w[14] == 1)
            ) {
                revert(string.concat("seeded case mismatch at index ", vm.toString(k)));
            }
        }
    }

    function test_seeded_settlement_matches_reference_0() public view {
        _seeded(0, 1000);
    }

    function test_seeded_settlement_matches_reference_1() public view {
        _seeded(1000, 2000);
    }

    function test_seeded_settlement_matches_reference_2() public view {
        _seeded(2000, 3000);
    }

    function test_seeded_settlement_matches_reference_3() public view {
        _seeded(3000, 4000);
    }

    function test_seeded_settlement_matches_reference_4() public view {
        _seeded(4000, 5000);
    }

    function test_seeded_settlement_matches_reference_5() public view {
        _seeded(5000, 6000);
    }

    function test_seeded_settlement_matches_reference_6() public view {
        _seeded(6000, 7000);
    }

    function test_seeded_settlement_matches_reference_7() public view {
        _seeded(7000, 8000);
    }

    function test_seeded_settlement_matches_reference_8() public view {
        _seeded(8000, 9000);
    }

    function test_seeded_settlement_matches_reference_9() public view {
        _seeded(9000, 10000);
    }

    function test_coupon_vector() public view {
        string memory json = vm.readFile(string.concat(DIR, "coupon.json"));
        uint256 secs = _u(json, ".cases[0].seconds");
        assertEq(
            Coupon.accrued(_u(json, ".cases[0].principal"), _u(json, ".cases[0].rateBps"), 0, secs, secs, 0),
            _u(json, ".cases[0].expected")
        );
    }

    function test_coverage_payout_bound_vector() public view {
        string memory json = vm.readFile(string.concat(DIR, "coverage.json"));
        uint256 H = _u(json, ".cases[0].H");
        uint256 B = _u(json, ".cases[0].B");
        assertEq(
            Coverage.payoutBound(H, B, _u(json, ".cases[0].Cfuture"), _u(json, ".cases[0].K")),
            _u(json, ".cases[0].payoutBound")
        );
        assertEq(Coverage.payoutBound(H, B, 0, 0), _u(json, ".cases[0].currentOnlyBound"));
    }

    function test_conservation_uses_FT_not_F() public view {
        Waterfall.Out memory o = h.settle(Waterfall.In(7000e6, 3000e6, 200e6, 100e6, 20e6, 0, false));
        assertEq(o.H + o.B + o.R + o.FT, 10_300e6);
        assertTrue(o.H + o.B + o.R + o.F != 10_300e6);
    }

    function test_insolvency_reverts_not_floors() public {
        vm.expectRevert(Waterfall.Insolvent.selector);
        h.settle(Waterfall.In(1, 0, 0, -2, 0, 0, false));
    }

    function test_fee_waiver_preserves_L() public view {
        Waterfall.Out memory o = h.settle(Waterfall.In(100, 0, 0, 10, 20, 50, true));
        assertEq(o.F, 0);
        assertEq(o.Lnext, 40);
    }

    function testFuzz_conservation_and_loss_order(uint64 H, uint64 B, uint64 R, int72 G, uint32 C, uint64 L)
        public
        view
    {
        int256 g = int256(G);
        vm.assume(int256(uint256(H) + B + R) + g >= 0);
        Waterfall.Out memory o = h.settle(Waterfall.In(H, B, R, g, C, L, false));
        assertEq(int256(o.H + o.B + o.R + o.FT), int256(uint256(H) + B + R) + g, "conservation");
        // Hull is only reduced below H + C once Ballast and Reserve are exhausted.
        if (o.H < uint256(H) + C) {
            assertEq(o.B, 0);
            assertEq(o.R, 0);
            assertEq(o.F, 0, "no fee that impairs Hull");
        }
        // Ballast is only reduced if the result did not cover the coupon.
        if (o.B < B) assertLt(g, int256(uint256(C)) + int256(o.F));
    }

    function test_recovery_restores_hull_then_reserve_then_ballast() public pure {
        (uint256 hh, uint256 b, uint256 r) = Waterfall.settleRecovery(900, 0, 0, 150, 1000, 40);
        assertEq(hh, 1000);
        assertEq(r, 40);
        assertEq(b, 10);
    }
}
