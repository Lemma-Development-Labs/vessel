/**
 * Forced-negative funding sandbox.
 *
 * Pure projection of how a settle would hit Hull vs Ballast under a negative
 * funding print. Mirrors Tranches waterfall priority: losses hit Ballast (then
 * reserve), never Hull coupon principal — that is the product claim the demo
 * must make visible.
 *
 * This is NOT a chain write. SimVenue.setFundingRateBps is owner-only; the UI
 * cannot flip the live book. The sandbox labels itself accordingly.
 */

export type SandboxInput = {
  hullTvl: bigint;
  balTvl: bigint;
  reserve: bigint;
  /** Absolute loss to apply (positive number). */
  loss: bigint;
};

export type SandboxResult = {
  hullTvl: bigint;
  balTvl: bigint;
  reserve: bigint;
  fromBallast: bigint;
  fromReserve: bigint;
  residual: bigint;
};

export function projectNegativeFunding(input: SandboxInput): SandboxResult {
  let remaining = input.loss < 0n ? -input.loss : input.loss;
  let bal = input.balTvl;
  let reserve = input.reserve;

  const fromBallast = remaining < bal ? remaining : bal;
  bal -= fromBallast;
  remaining -= fromBallast;

  const fromReserve = remaining < reserve ? remaining : reserve;
  reserve -= fromReserve;
  remaining -= fromReserve;

  return {
    hullTvl: input.hullTvl, // Hull principal untouched by funding shortfall
    balTvl: bal,
    reserve,
    fromBallast,
    fromReserve,
    residual: remaining,
  };
}

/** Default demo loss: 1% of Ballast TVL, floored at 1 dUSD unit when Ballast > 0. */
export function defaultSandboxLoss(balTvl: bigint): bigint {
  if (balTvl <= 0n) return 0n;
  const pct = balTvl / 100n;
  return pct > 0n ? pct : 1n;
}
