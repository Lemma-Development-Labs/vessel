// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Coupon} from "./Coupon.sol";

/// @title Coverage
/// @notice Junior cover B / (H + B) — reserve is never in the numerator (spec §9).
/// @dev New Hull issuance and voluntary Ballast payouts require ≥ 30% both now and after the
///      remaining Hull coupon and a stressed close cost are charged to Ballast. The 20% floor is
///      an intervention trigger, not an invariant markets cannot break.
library Coverage {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant COVER_BPS = 3_000;
    uint256 internal constant FLOOR_BPS = 2_000;

    function coverBps(uint256 H, uint256 B) internal pure returns (uint256) {
        uint256 total = H + B;
        return total == 0 ? BPS : (B * BPS) / total;
    }

    /// @notice Largest voluntary junior payout x with (B − Cf − K − x) / (H + Cf + B − Cf − K − x) ≥ 30%:
    ///         x ≤ [B − Cf − K − 0.30 (H + B − K)] / 0.70, floored, never negative.
    function payoutBound(uint256 H, uint256 B, uint256 cFuture, uint256 closeCost) internal pure returns (uint256) {
        if (B <= cFuture + closeCost) return 0;
        uint256 lhs = (B - cFuture - closeCost) * BPS;
        uint256 total = H + B;
        uint256 rhs = COVER_BPS * (total > closeCost ? total - closeCost : 0);
        if (lhs <= rhs) return 0;
        return (lhs - rhs) / (BPS - COVER_BPS);
    }

    /// @notice Whether new Hull principal y keeps projected cover ≥ 30% after its full-term coupon
    ///         and the stressed close cost come out of Ballast.
    function newHullOk(uint256 H, uint256 B, uint256 y, uint256 rateBps, uint256 termSeconds, uint256 closeCost)
        internal
        pure
        returns (bool)
    {
        uint256 coupon = Coupon.termCoupon(y, rateBps, termSeconds);
        if (B < coupon + closeCost) return false;
        uint256 hp = H + y + coupon;
        uint256 bp = B - coupon - closeCost;
        return bp * BPS >= COVER_BPS * (hp + bp);
    }
}
