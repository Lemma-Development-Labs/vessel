// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Waterfall
/// @notice One settlement epoch of the Vessel book (spec §7, HANDBOOK_v4 ch. 4).
/// @dev Unit-agnostic integer math; the protocol feeds USDC base units. Normative order:
///      E = max(G − L, 0); L' = max(L − G, 0); F = ⌊E/10⌋; FR = min(⌊F/2⌋, deficit to 2% of
///      pre-settlement NAV); FT = F − FR; allocate G − F − C against Hull's coupon, shortfall to
///      Ballast, then Reserve (incl. FR), then Hull; if that impairs Hull, redo the epoch fee-free.
///      Invariant: H' + B' + R' + FT == H + B + R + G. Judged against reference/vectors/*.
library Waterfall {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant FEE_BPS = 1_000;
    uint256 internal constant RESERVE_TARGET_BPS = 200;
    uint256 internal constant MAX_RESERVE_SHARE_BPS = 5_000;

    error Insolvent();
    error ConservationViolated();

    struct In {
        uint256 H;
        uint256 B;
        uint256 R;
        int256 G;
        uint256 C;
        uint256 L;
        bool feesDisabled;
    }

    struct Out {
        uint256 H;
        uint256 B;
        uint256 R;
        uint256 F;
        uint256 FR;
        uint256 FT;
        uint256 Lnext;
        bool impaired;
    }

    function settle(In memory s) internal pure returns (Out memory o) {
        uint256 base = s.H + s.B + s.R;
        uint256 gAbs = _abs(s.G);
        if (s.G < 0 && gAbs > base) revert Insolvent();

        uint256 eligible;
        if (s.G > 0) {
            eligible = gAbs > s.L ? gAbs - s.L : 0;
            o.Lnext = s.L > gAbs ? s.L - gAbs : 0;
        } else {
            o.Lnext = s.L + gAbs;
        }

        uint256 fee = s.feesDisabled ? 0 : (eligible * FEE_BPS) / BPS;
        uint256 target = (base * RESERVE_TARGET_BPS) / BPS;
        uint256 deficit = target > s.R ? target - s.R : 0;
        uint256 reserveFee = _min((fee * MAX_RESERVE_SHARE_BPS) / BPS, deficit);

        (bool ok, uint256 h, uint256 b, uint256 r) = _allocate(s, fee, reserveFee);
        if (!ok || h < s.H + s.C) {
            fee = 0;
            reserveFee = 0;
            (ok, h, b, r) = _allocate(s, 0, 0);
            // Solvency was checked above, so the fee-free pass always allocates.
            if (!ok) revert Insolvent();
        }
        o.H = h;
        o.B = b;
        o.R = r;
        o.F = fee;
        o.FR = reserveFee;
        o.FT = fee - reserveFee;
        o.impaired = h < s.H + s.C;
        if (int256(o.H + o.B + o.R + o.FT) != int256(base) + s.G) revert ConservationViolated();
    }

    /// @notice Recovery epoch for an impaired book (spec §8): fees are zero; gains first restore
    ///         Hull up to its frozen entitlement, then Reserve up to its frozen pre-impairment
    ///         entitlement, then go to Ballast. Losses still hit Ballast, Reserve, Hull.
    function settleRecovery(uint256 H, uint256 B, uint256 R, int256 G, uint256 hullCap, uint256 reserveCap)
        internal
        pure
        returns (uint256 h, uint256 b, uint256 r)
    {
        (h, b, r) = (H, B, R);
        if (G >= 0) {
            uint256 g = uint256(G);
            uint256 toH = hullCap > h ? _min(hullCap - h, g) : 0;
            h += toH;
            g -= toH;
            uint256 toR = reserveCap > r ? _min(reserveCap - r, g) : 0;
            r += toR;
            g -= toR;
            b += g;
        } else {
            uint256 loss = uint256(-G);
            if (loss > h + b + r) revert Insolvent();
            uint256 hit = _min(b, loss);
            b -= hit;
            loss -= hit;
            hit = _min(r, loss);
            r -= hit;
            loss -= hit;
            h -= loss;
        }
    }

    function _allocate(In memory s, uint256 fee, uint256 reserveFee)
        private
        pure
        returns (bool ok, uint256 h, uint256 b, uint256 r)
    {
        h = s.H + s.C;
        b = s.B;
        r = s.R + reserveFee;
        int256 residual = s.G - int256(fee) - int256(s.C);
        if (residual >= 0) return (true, h, b + uint256(residual), r);
        uint256 loss = uint256(-residual);
        uint256 hit = _min(b, loss);
        b -= hit;
        loss -= hit;
        hit = _min(r, loss);
        r -= hit;
        loss -= hit;
        if (loss > h) return (false, 0, 0, 0);
        h -= loss;
        ok = true;
    }

    function _abs(int256 x) private pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
