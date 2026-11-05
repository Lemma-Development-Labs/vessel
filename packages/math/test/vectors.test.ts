import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { InsolventError, accruedCoupon, coverBps, juniorPayoutBound, newHullCoverOk, settle } from "../src/index.js";

type Case = {
  name: string;
  in: Record<"H" | "B" | "R" | "G" | "C" | "L", string> & { feesDisabled: boolean };
  out: Record<"H" | "B" | "R" | "F" | "FR" | "FT" | "Lnext", string> & { impaired: boolean };
};
const load = <T>(f: string): T => JSON.parse(readFileSync(new URL(`../../../reference/vectors/${f}`, import.meta.url), "utf8")) as T;
const run = (c: Case) =>
  settle({
    H: BigInt(c.in.H), B: BigInt(c.in.B), R: BigInt(c.in.R), G: BigInt(c.in.G),
    C: BigInt(c.in.C), L: BigInt(c.in.L), feesDisabled: c.in.feesDisabled,
  });
const expectCase = (c: Case) => {
  const o = run(c);
  expect(
    { H: o.H, B: o.B, R: o.R, F: o.F, FR: o.FR, FT: o.FT, Lnext: o.Lnext, impaired: o.impaired },
    c.name,
  ).toEqual({
    H: BigInt(c.out.H), B: BigInt(c.out.B), R: BigInt(c.out.R), F: BigInt(c.out.F),
    FR: BigInt(c.out.FR), FT: BigInt(c.out.FT), Lnext: BigInt(c.out.Lnext), impaired: c.out.impaired,
  });
};

describe("settlement vs reference model", () => {
  const golden = load<{ cases: Case[] }>("settlement.json").cases;
  it.each(golden.map((c) => [c.name, c] as const))("golden %s", (_n, c) => expectCase(c));

  it("5,000 seeded cases + fee-disabled variants", () => {
    const seeded = load<{ cases: Case[] }>("settlement_seeded.json").cases;
    expect(seeded.length).toBe(10_000);
    for (const c of seeded) expectCase(c);
  });

  it("conservation uses FT, not F", () => {
    const o = settle({ H: 7000n, B: 3000n, R: 200n, G: 100n, C: 20n, L: 0n });
    expect(o.H + o.B + o.R + o.FT).toBe(7000n + 3000n + 200n + 100n);
    expect(o.H + o.B + o.R + o.F).not.toBe(7000n + 3000n + 200n + 100n);
  });

  it("insolvency throws instead of flooring", () => {
    expect(() => settle({ H: 1n, B: 0n, R: 0n, G: -2n, C: 0n, L: 0n })).toThrow(InsolventError);
  });

  it("fee waiver never erases the loss carryforward", () => {
    const o = settle({ H: 100n, B: 0n, R: 0n, G: 10n, C: 20n, L: 50n, feesDisabled: true });
    expect(o.F).toBe(0n);
    expect(o.Lnext).toBe(40n);
  });
});

describe("coupon and coverage", () => {
  it("coupon vector: 1,000 USDC x 8% x 28 d", () => {
    const [c] = load<{ cases: { principal: string; rateBps: string; seconds: string; expected: string }[] }>("coupon.json").cases;
    expect(accruedCoupon({ principal: BigInt(c!.principal), rateBps: BigInt(c!.rateBps), activation: 0n, now: BigInt(c!.seconds), maturity: BigInt(c!.seconds) })).toBe(BigInt(c!.expected));
  });

  it("coupon stops at maturity and at termination", () => {
    const base = { principal: 1_000_000_000n, rateBps: 800n, activation: 0n, maturity: 2_419_200n };
    expect(accruedCoupon({ ...base, now: 10_000_000n })).toBe(accruedCoupon({ ...base, now: base.maturity }));
    expect(accruedCoupon({ ...base, now: 10_000_000n, termination: 86_400n })).toBe(accruedCoupon({ ...base, now: 86_400n }));
  });

  it("cumulative accrual never loses more than 1 unit to repeated truncation", () => {
    const base = { principal: 1_234_567_891n, rateBps: 777n, activation: 0n, maturity: 2_419_200n };
    let recognized = 0n;
    for (let t = 3_601n; t <= base.maturity; t += 3_601n) recognized += accruedCoupon({ ...base, now: t }) - recognized;
    recognized += accruedCoupon({ ...base, now: base.maturity }) - recognized;
    expect(recognized).toBe(accruedCoupon({ ...base, now: base.maturity }));
  });

  it("coverage payout bound vector (8650/7) and reserve never in the numerator", () => {
    const [c] = load<{ cases: Record<string, string>[] }>("coverage.json").cases;
    const args = { H: BigInt(c!.H!), B: BigInt(c!.B!), Cfuture: BigInt(c!.Cfuture!), K: BigInt(c!.K!) };
    expect(juniorPayoutBound(args)).toBe(BigInt(c!.payoutBound!));
    expect(juniorPayoutBound({ ...args, Cfuture: 0n, K: 0n })).toBe(BigInt(c!.currentOnlyBound!));
    expect(coverBps(6000n, 4000n)).toBe(4000n);
  });

  it("new Hull issuance respects projected 30% cover", () => {
    const p = { H: 0n, B: 3_000_000_000n, rateBps: 800n, termSeconds: 2_419_200n, K: 0n };
    // 6,800: projected cover 30.19% (coupon 41.73 comes out of B); 6,900 would be 29.87%.
    expect(newHullCoverOk({ ...p, y: 6_800_000_000n })).toBe(true);
    expect(newHullCoverOk({ ...p, y: 6_900_000_000n })).toBe(false);
    expect(newHullCoverOk({ ...p, y: 7_100_000_000n })).toBe(false);
  });
});
