/**
 * Golden settlement vectors (spec §7 worked examples).
 *
 * The canonical data is docs/spec/ACCOUNTING_GOLDEN_VECTORS.json. This module
 * gives it a validated shape and independently re-checks the corrected
 * conservation identity  ΔH + ΔB + ΔR + FT = G  in integer arithmetic. The
 * full independent reference model (fees, L carryforward, waterfall passes)
 * is Session 2 work and must not call the implementation under test.
 */

import { parseDecimal } from "./units.js";

export interface GoldenVector {
  name: string;
  start: { H: string; B: string; R: string };
  G: string;
  coupon: string;
  end: { H: string; B: string; R: string; FT: string };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function requireDecimalString(
  obj: Record<string, unknown>,
  key: string,
  ctx: string,
): string {
  const v = obj[key];
  if (typeof v !== "string") {
    throw new TypeError(`${ctx}.${key} must be a decimal string`);
  }
  parseDecimal(v, 6); // throws on malformed or over-precise input
  return v;
}

export function assertGoldenVector(x: unknown): asserts x is GoldenVector {
  if (!isRecord(x) || typeof x.name !== "string" || x.name === "") {
    throw new TypeError("golden vector must have a non-empty name");
  }
  const ctx = `vector ${JSON.stringify(x.name)}`;
  if (!isRecord(x.start) || !isRecord(x.end)) {
    throw new TypeError(`${ctx}: start/end must be objects`);
  }
  for (const k of ["H", "B", "R"] as const) {
    requireDecimalString(x.start, k, `${ctx}.start`);
    requireDecimalString(x.end, k, `${ctx}.end`);
  }
  requireDecimalString(x.end, "FT", `${ctx}.end`);
  requireDecimalString(x, "G", ctx);
  requireDecimalString(x, "coupon", ctx);
}

export function parseGoldenVectors(json: unknown): GoldenVector[] {
  if (!Array.isArray(json)) {
    throw new TypeError("golden vectors file must be a JSON array");
  }
  for (const v of json) assertGoldenVector(v);
  return json;
}

/** ΔH + ΔB + ΔR + FT === G, computed at 6-decimal fixed point. */
export function conservationHolds(v: GoldenVector, decimals = 6): boolean {
  const p = (s: string) => parseDecimal(s, decimals);
  const dH = p(v.end.H) - p(v.start.H);
  const dB = p(v.end.B) - p(v.start.B);
  const dR = p(v.end.R) - p(v.start.R);
  return dH + dB + dR + p(v.end.FT) === p(v.G);
}
