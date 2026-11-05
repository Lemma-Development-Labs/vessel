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
  engine: { present: true, simulated: true, manifestKind: "SimulatedEngine", value: 800_000_000n, observedAt: 1_790_000_000n, book: 800_000_000n, pot: 200_000_000n, fundingRateBps: 1200n },
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
    s.engine = { present: true, simulated: false, manifestKind: "HedgedEngine", value: recomputeEngineValue(h), observedAt: 1_790_000_000n, hedge: h };
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

describe("hedged engine with a vMON spot leg (ADR-010)", () => {
  it("still checks backing, value and gap, and labels the engine SIMULATED", () => {
    const s: Snapshot = {
      chainId: 10143, blockNumber: 1n, blockHash: "0xabc", blockTimestamp: 1n,
      asset: { symbol: "USDC", decimals: 6 },
      controller: {
        hullNav: 0n, ballastNav: 980_000_000n, reserveNav: 20_000_000n, treasuryLiability: 0n,
        lastActive: 1_000_000_000n, lifetimeAdmitted: 1_000_000_000n, pendingReserved: 0n,
        stageCap: 25_000_000_000n, impaired: false, lossCarry: 0n, epoch: 1n,
      },
      custody: { pending: 0n, activeIdle: 150_000_000n, tokenBalance: 150_000_000n },
      escrow: { totalFunded: 0n, tokenBalance: 0n },
      engine: { present: false },
      ballastSupply: 1n,
    };
    const h: HedgeSnapshot = {
      usdcCash: 400_000_000n, ausdCash: 0n, monQty: 650n * 10n ** 18n,
      usdcBalance: 400_000_000n, ausdBalance: 0n, monBalance: 650n * 10n ** 18n,
      perplAccountId: 9n, perplFree: 420_000_000n, perplDeposit: 18_000_000n, perplPnl: 0n,
      shortLots: 650n, perpLotScale: 1n, px: 26_000_000_000_000_000n, fx: 10n ** 18n,
      priceAt: 1n, independent: false, sliceCap: 4_000_000n, testSpot: true,
    };
    s.engine = { present: true, simulated: false, manifestKind: "HedgedEngine", value: recomputeEngineValue(h), observedAt: 1n, hedge: h };
    const out = evaluate(s);
    const engine = out.find((c) => c.id === "engine")!;
    expect(engine.verdict).toBe("SIMULATED");
    expect(engine.summary).toMatch(/vMON/);
    expect(out.find((c) => c.id === "engine.backing")?.verdict).toBe("PASS");
    expect(out.find((c) => c.id === "hedge.gap")?.verdict).toBe("PASS");
  });
});

import { absentOk, isAbsentFunction } from "../src/read.ts";

describe("review VER-1 / VER-2: no stronger claim from a failed read or an unlisted engine", () => {
  it("an engine the manifest doesn't name is a MISMATCH, not INFO", () => {
    const s = healthy();
    s.engine = { ...(s.engine as Extract<Snapshot["engine"], { present: true }>), manifestKind: null };
    expect(verdictOf(s, "engine.manifest")).toBe("MISMATCH");
    expect(overall(evaluate(s))).toBe("MISMATCH");
  });

  it("an engine that isn't the kind the manifest names is a MISMATCH", () => {
    const s = healthy(); // a SimulatedEngine in the manifest…
    s.engine = { ...(s.engine as Extract<Snapshot["engine"], { present: true }>), simulated: false }; // …that says it isn't
    expect(verdictOf(s, "engine.manifest")).toBe("MISMATCH");
  });

  it("a missing function falls back; any other read failure propagates (the CLI then exits 2)", async () => {
    // the shapes viem throws: a call to a function the contract lacks reverts with no reason and no data
    const absent = Object.assign(new Error("reverted"), { name: "ContractFunctionExecutionError", cause: { name: "ContractFunctionRevertedError", raw: "0x" } });
    const zero = Object.assign(new Error("no data"), { name: "ContractFunctionExecutionError", cause: { name: "ContractFunctionZeroDataError" } });
    const timeout = Object.assign(new Error("took too long"), { name: "TimeoutError" });
    const http = Object.assign(new Error("502"), { name: "ContractFunctionExecutionError", cause: { name: "HttpRequestError" } });
    const realRevert = Object.assign(new Error("reverted"), { name: "ContractFunctionExecutionError", cause: { name: "ContractFunctionRevertedError", reason: "Paused" } });
    // exactly what viem threw for HedgedEngine.isSimulated() on Monad testnet, 2026-11-05: the verifier
    // printed "could not verify" for a healthy hedged book because this shape wasn't recognised
    const monadAbsent = Object.assign(new Error("reverted"), {
      name: "ContractFunctionExecutionError",
      cause: { name: "ContractFunctionRevertedError", data: "0x", reason: "execution reverted", cause: { name: "CallExecutionError" } },
    });
    const customError = Object.assign(new Error("reverted"), { name: "ContractFunctionExecutionError", cause: { name: "ContractFunctionRevertedError", raw: "0x3ee5aeb5" } });
    expect(isAbsentFunction(absent)).toBe(true);
    expect(isAbsentFunction(zero)).toBe(true);
    expect(isAbsentFunction(monadAbsent)).toBe(true);
    for (const e of [timeout, http, realRevert, customError]) expect(isAbsentFunction(e)).toBe(false);
    await expect(absentOk(Promise.reject(absent), false)).resolves.toBe(false);
    await expect(absentOk(Promise.reject(timeout), false)).rejects.toThrow("took too long");
  });
});
