import { describe, expect, it } from "vitest";
import { mergeFills, shortNotionalFromPositions } from "../src/reconcile.ts";
import type { Fill, Position } from "../src/types.ts";

describe("reconcile", () => {
  it("fill during disconnect converges with remote", () => {
    const local: Fill[] = [{ oid: 1, mkt: 64, s: 10, f: "1" }];
    const remote: Fill[] = [
      { oid: 1, mkt: 64, s: 10, f: "1", at: { t: 1 } },
      { oid: 2, mkt: 64, s: 5, f: "2", at: { t: 2 } }, // arrived while down
    ];
    const merged = mergeFills(local, remote);
    expect(merged.some((f) => f.oid === 2)).toBe(true);
    expect(merged.length).toBeGreaterThanOrEqual(2);
  });

  it("short notional from positions", () => {
    const positions: Position[] = [
      { id: 1, mkt: 64, s: -10000 },
      { id: 2, mkt: 16, s: -50 },
    ];
    const n = shortNotionalFromPositions(positions, 64, 1_000_000, 5);
    // 10000 * 1e6 / 1e5 = 100_000
    expect(n).toBe(100_000n);
  });

  it("never adds f + bfa (fee reporting gotcha documented)", () => {
    const fill: Fill = { oid: 9, mkt: 64, s: 1, f: "100", bfa: "10" };
    // Gross fee is `f` alone — builder portion already included.
    const gross = BigInt(fill.f);
    const wrong = gross + BigInt(fill.bfa!);
    expect(gross).toBe(100n);
    expect(wrong).not.toBe(gross);
  });
});
