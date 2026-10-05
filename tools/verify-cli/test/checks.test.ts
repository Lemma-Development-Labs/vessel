import { describe, expect, it } from "vitest";
import { evaluate, overall, recomputeEngineValue, type HedgeSnapshot, type Snapshot } from "../src/checks.ts";

const healthy = (): Snapshot => ({
  chainId: 10143,
  blockNumber: 100n,
  blockHash: "0xabc",
  blockTimestamp: 1_790_000_000n,
  asset: { symbol: "dUSD", decimals: 6 },
  controller: {
    hullNav: 80_000_000n, ballastNav: 900_000_000n, reserveNav: 20_000_000n, treasuryLiability: 0n,
    lastActive: 1_000_000_000n, lifetimeAdmitted: 1_000_000_000n, pendingReserved: 0n,
    stageCap: 25_000_000_000n, impaired: false, lossCarry: 0n, epoch: 3n,
  },
  custody: { pending: 0n, activeIdle: 200_000_000n, tokenBalance: 200_000_000n },
  escrow: { totalFunded: 0n, tokenBalance: 0n },
  engine: { present: true, simulated: true, value: 800_000_000n, observedAt: 1_790_000_000n, book: 800_000_000n, pot: 200_000_000n, fundingRateBps: 1200n },
  ballastSupply: 900_000_000_000_000_000_000n,
});

const verdictOf = (s: Snapshot, id: string) => evaluate(s).find((c) => c.id === id)?.verdict;

describe("verifier checks", () => {
  it("passes a consistent book and labels the simulated engine", () => {
    const s = healthy();
    expect(overall(evaluate(s))).toBe("PASS");
    expect(verdictOf(s, "engine")).toBe("SIMULATED");
  });

  it("corrupted_projection_yields_MISMATCH: recorded A ≠ H + B + R", () => {
    const s = healthy();
    s.controller.ballastNav += 1n;
    expect(verdictOf(s, "book.identity")).toBe("MISMATCH");
    expect(overall(evaluate(s))).toBe("MISMATCH");
  });

  it("custody below its tracked compartments is a MISMATCH; a surplus is quarantined", () => {
    const short = healthy();
    short.custody.tokenBalance -= 1n;
    expect(verdictOf(short, "custody.backing")).toBe("MISMATCH");
    const donated = healthy();
    donated.custody.tokenBalance += 5n;
    const c = evaluate(donated).find((x) => x.id === "custody.backing")!;
    expect(c.verdict).toBe("PASS");
    expect(c.values.quarantined).toBe("5");
  });

  it("escrow owing more than it holds is a MISMATCH", () => {
    const s = healthy();
    s.escrow.totalFunded = 10n;
    expect(verdictOf(s, "escrow.backing")).toBe("MISMATCH");
  });

  it("caps beyond the stage cap or the V1 ceiling are a MISMATCH", () => {
    const over = healthy();
    over.controller.pendingReserved = over.controller.stageCap;
    expect(verdictOf(over, "caps.lifetime")).toBe("MISMATCH");
    const ceiling = healthy();
    ceiling.controller.stageCap = 25_000_000_001n;
    expect(verdictOf(ceiling, "caps.lifetime")).toBe("MISMATCH");
  });

  it("reports unsettled income without calling it a mismatch", () => {
    const s = healthy();
    if (s.engine.present) s.engine.value += 7n;
    const c = evaluate(s).find((x) => x.id === "book.unsettled")!;
    expect(c.verdict).toBe("INFO");
    expect(c.values.unsettledG).toBe("7");
    expect(overall(evaluate(s))).toBe("PASS");
  });

  it("units without admitted capital are a MISMATCH", () => {
    const s = healthy();
    s.controller.lifetimeAdmitted = 0n;
    s.controller.lastActive = s.controller.hullNav + s.controller.ballastNav + s.controller.reserveNav;
    expect(verdictOf(s, "units.backed")).toBe("MISMATCH");
  });
});

describe("hedged engine checks", () => {
  // 1,800 USDC engine: 600 margin (≈ 25.66 locked in an 826-lot short), 826.97 MON spot at 0.031.
  const hedge = (): HedgeSnapshot => ({
    usdcCash: 1_174_000_000n,
    ausdCash: 0n,
    monQty: 826_970_000_000_000_000_000n,
    usdcBalance: 1_174_000_000n,
    ausdBalance: 0n,
    monBalance: 826_970_000_000_000_000_000n,
    perplAccountId: 845n,
    perplFree: 574_394_000n,
    perplDeposit: 25_606_000n,
    perplPnl: -9_000n,
    shortLots: 826n,
    perpLotScale: 1n,
    px: 31_000_000_000_000_000n,
    fx: 10n ** 18n,
    priceAt: 1_790_000_000n,
    independent: false,
    sliceCap: 9_000_000n,
  });
  const hedged = (h = hedge()): Snapshot => {
    const s = healthy();
    s.asset = { symbol: "USDC", decimals: 6 };
    s.engine = { present: true, simulated: false, value: recomputeEngineValue(h), observedAt: 1_790_000_000n, hedge: h };
    return s;
  };

  it("passes a matched, backed hedge and labels the price source", () => {
    const s = hedged();
    expect(overall(evaluate(s))).toBe("PASS");
    expect(verdictOf(s, "engine")).toBe("INFO");
    expect(verdictOf(s, "engine.backing")).toBe("PASS");
    expect(verdictOf(s, "engine.value")).toBe("PASS");
    expect(verdictOf(s, "hedge.gap")).toBe("PASS");
    const v = evaluate(s).find((c) => c.id === "valuation.source")!;
    expect(v.summary).toMatch(/not an independent source/);
  });

  it("an engine ledger above its holdings is a MISMATCH", () => {
    const h = hedge();
    h.monBalance -= 1n;
    expect(verdictOf(hedged(h), "engine.backing")).toBe("MISMATCH");
  });

  it("a reported value the venue state does not support is a MISMATCH", () => {
    const s = hedged();
    if (s.engine.present) s.engine.value += 2n;
    expect(verdictOf(s, "engine.value")).toBe("MISMATCH");
  });

  it("an unhedged gap beyond one slice is a MISMATCH", () => {
    const h = hedge();
    h.shortLots = 500n; // 326 MON ≈ 10.1 USDC unhedged, slice cap 9
    const s = hedged(h);
    expect(verdictOf(s, "hedge.gap")).toBe("MISMATCH");
    expect(overall(evaluate(s))).toBe("MISMATCH");
  });

  it("negative Perpl equity values the account at zero", () => {
    const h = hedge();
    h.perplPnl = -10_000_000_000n;
    expect(recomputeEngineValue(h)).toBe(h.usdcCash + (h.monQty * h.px) / 10n ** 30n);
  });
});
