// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Coupon
/// @notice Simple (non-compounding) Hull coupon, cumulative from activation (spec §8).
/// @dev accrued(t) = principal × rateBps × (min(t, maturity, termination) − activation) / (10_000 × 365 d),
///      floored. Settlements recognize accrued(now) − previouslyRecognized, so truncation never
///      compounds across epochs. Coupon stops at maturity or earlier termination.
library Coupon {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant YEAR = 365 days;

    function accrued(
        uint256 principal,
        uint256 rateBps,
        uint256 activation,
        uint256 nowTs,
        uint256 maturity,
        uint256 termination
    ) internal pure returns (uint256) {
        uint256 end = nowTs < maturity ? nowTs : maturity;
        if (termination != 0 && termination < end) end = termination;
        if (end <= activation) return 0;
        return (principal * rateBps * (end - activation)) / (BPS * YEAR);
    }

    /// @notice Coupon for a full term, used when sizing new issuance.
    function termCoupon(uint256 principal, uint256 rateBps, uint256 termSeconds) internal pure returns (uint256) {
        return (principal * rateBps * termSeconds) / (BPS * YEAR);
    }
}
