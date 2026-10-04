/**
 * Vessel canonical accounting in exact integer arithmetic (spec §7,
 * HANDBOOK_v4 ch. 4). Derived from the specification text, independently of
 * the Solidity implementation, and judged against the reference model's
 * exported vectors (reference/vectors/*.json).
 *
 * All values are bigint in one integer unit (the waterfall is unit-agnostic;
 * the protocol feeds it USDC base units). Nothing here touches Number.
 */

const BPS = 10_000n;
const YEAR_SECONDS = 31_536_000n; // 365 days
export const FEE_BPS = 1_000n; // 10% of eligible gain
export const RESERVE_TARGET_BPS = 200n; // 2% of pre-settlement active NAV
export const MAX_RESERVE_SHARE_BPS = 5_000n; // at most half the fee
export const COVER_BPS = 3_000n; // 30% admission / voluntary-payout buffer

export class InsolventError extends Error {
  override name = "InsolventError";
}

export interface SettleIn {
  /** recognized Hull NAV before this epoch */
  H: bigint;
  /** Ballast NAV before this epoch */
  B: bigint;
  /** reserve NAV before this epoch */
  R: bigint;
  /** cash-flow-adjusted strategy result, net of venue costs, before fees */
  G: bigint;
  /** Hull coupon accrued this epoch */
  C: bigint;
  /** prior gross loss carryforward */
  L: bigint;
  /** impaired or emergency wind-down: all fees forced to zero */
  feesDisabled?: boolean;
}

export interface SettleOut {
  H: bigint;
  B: bigint;
  R: bigint;
  /** total performance fee */
  F: bigint;
  /** part of F retained in reserve */
  FR: bigint;
  /** treasury liability recognized this epoch (F − FR) */
  FT: bigint;
  Lnext: bigint;
  /** Hull ended below H + C */
  impaired: boolean;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

function allocate(s: SettleIn, fee: bigint, reserveFee: bigint): { H: bigint; B: bigint; R: bigint } {
  let h = s.H + s.C;
  let b = s.B;
  let r = s.R + reserveFee;
  const residual = s.G - fee - s.C;
  if (residual >= 0n) return { H: h, B: b + residual, R: r };
  let shortfall = -residual;
  const fromB = min(b, shortfall);
  b -= fromB;
  shortfall -= fromB;
  const fromR = min(r, shortfall);
  r -= fromR;
  shortfall -= fromR;
  h -= shortfall; // never negative: solvency was checked by the caller
  return { H: h, B: b, R: r };
}

/**
 * One settlement epoch. Order (normative, HANDBOOK_v4 ch. 4):
 * E = max(G − L, 0); L' = max(L − G, 0); F = 10% E; FR = min(F/2, 2% NAV − R);
 * FT = F − FR; allocate G − F − C against Hull's coupon, shortfall to B then R
 * (incl. FR) then H; if that impairs Hull, redo the whole epoch fee-free.
 * Invariant: H' + B' + R' + FT = H + B + R + G.
 */
export function settle(s: SettleIn): SettleOut {
  for (const [k, v] of [["H", s.H], ["B", s.B], ["R", s.R], ["C", s.C], ["L", s.L]] as const) {
    if (v < 0n) throw new RangeError(`${k} must be non-negative`);
  }
  if (s.H + s.B + s.R + s.G < 0n) throw new InsolventError("obligations exceed recoverable assets");

  const eligible = max(s.G - s.L, 0n);
  const Lnext = max(s.L - s.G, 0n);
  let F = s.feesDisabled ? 0n : (eligible * FEE_BPS) / BPS;
  const deficit = max(((s.H + s.B + s.R) * RESERVE_TARGET_BPS) / BPS - s.R, 0n);
  let FR = min((F * MAX_RESERVE_SHARE_BPS) / BPS, deficit);

  let out = allocate(s, F, FR);
  if (out.H < s.H + s.C) {
    F = 0n;
    FR = 0n;
    out = allocate(s, 0n, 0n);
  }
  const FT = F - FR;
  if (out.H + out.B + out.R + FT !== s.H + s.B + s.R + s.G) {
    throw new Error("conservation violated"); // unreachable by construction
  }
  return { ...out, F, FR, FT, Lnext, impaired: out.H < s.H + s.C };
}

/**
 * Cumulative simple coupon from activation to min(now, maturity, termination),
 * floored. Callers take epochCoupon = accrued(now) − previouslyRecognized so
 * truncation never compounds across settlements.
 */
export function accruedCoupon(p: {
  principal: bigint;
  rateBps: bigint;
  activation: bigint;
  now: bigint;
  maturity: bigint;
  termination?: bigint;
}): bigint {
  let end = min(p.now, p.maturity);
  if (p.termination !== undefined) end = min(end, p.termination);
  if (end <= p.activation) return 0n;
  return (p.principal * p.rateBps * (end - p.activation)) / (BPS * YEAR_SECONDS);
}

/** Current junior cover B / (H + B) in bps; reserve never counts. 10,000 when both are zero. */
export function coverBps(H: bigint, B: bigint): bigint {
  const total = H + B;
  return total === 0n ? BPS : (B * BPS) / total;
}

/**
 * Largest voluntary junior payout x keeping projected cover ≥ 30% after the
 * remaining Hull coupon Cf and stressed closing cost K charged to Ballast:
 * x ≤ [B − Cf − K − 0.30 (H + B − K)] / 0.70, floored, never negative.
 */
export function juniorPayoutBound(p: { H: bigint; B: bigint; Cfuture: bigint; K: bigint }): bigint {
  const num = (p.B - p.Cfuture - p.K) * BPS - COVER_BPS * (p.H + p.B - p.K);
  if (num <= 0n) return 0n;
  return num / (BPS - COVER_BPS);
}

/**
 * Whether new Hull principal y keeps projected cover ≥ 30%:
 * Hp = H + y + termCoupon(y), Bp = B − termCoupon(y) − K.
 */
export function newHullCoverOk(p: { H: bigint; B: bigint; y: bigint; rateBps: bigint; termSeconds: bigint; K: bigint }): boolean {
  const coupon = (p.y * p.rateBps * p.termSeconds) / (BPS * YEAR_SECONDS);
  const Hp = p.H + p.y + coupon;
  const Bp = p.B - coupon - p.K;
  if (Bp < 0n) return false;
  return Bp * BPS >= COVER_BPS * (Hp + Bp);
}
