import { decodeFunctionData, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { decideHedge, defaultHedgeConfig, engineAllowlist, engineWriteAbi, floors, type HedgeConfig, type HedgeObserved } from "../src/v2/hedge.ts";
import { decide, engineCashNeed, type Observed, type PolicyConfig } from "../src/v2/policy.ts";

const E = "0x00000000000000000000000000000000000000e1" as const;
const C = "0x00000000000000000000000000000000000000c1" as const;
const cfg = defaultHedgeConfig;
const PX = 31_000_000_000_000_000n; // 0.031 USDC per MON
const E18 = 10n ** 18n;

const base = (): HedgeObserved => ({
  now: 1_800_000_000n,
  px: PX,
  fx: E18,
  priceAt: 1_800_000_000n,
  riskPaused: false,
  value: 1_800_000_000n,
  sliceCap: 9_000_000n, // 0.5% of 1,800
  usdcCash: 1_800_000_000n,
  ausdCash: 0n,
  monQty: 0n,
  shortLots: 0n,
  perplAccountId: 0n,
  perplFree: 0n,
  perplEquity: 0n,
  minAccountOpen: 100_000_000n,
  spotSizePrecision: 10_000_000_000n,
  perpPriceScale: 100_000n,
  perpLotScale: 1n,
  leverageHdths: 100n,
  cashShortfall: 0n,
});

const call = (o: HedgeObserved) => {
  const p = decideHedge(o, cfg, E);
  return p ? decodeFunctionData({ abi: engineWriteAbi, data: p.calldata as `0x${string}` }) : null;
};

describe("v2 hedge policy — single decisions", () => {
  it("does nothing on stale prices (the engine would refuse)", () => {
    expect(decideHedge({ ...base(), priceAt: 1_799_999_900n }, cfg, E)).toBeNull();
  });

  it("first converts enough USDC to open the Perpl account, then opens it", () => {
    const r = call(base());
    expect(r?.functionName).toBe("convertToMargin");
    const usdcIn = r!.args![0] as bigint;
    expect(usdcIn).toBeGreaterThanOrEqual(100_000_000n);
    expect(r!.args![1]).toBe(floors.toMargin(usdcIn, E18));
    expect(call({ ...base(), ausdCash: 900_000_000n })?.functionName).toBe("depositMargin");
    // Below the venue minimum, convert more rather than try to open.
    expect(call({ ...base(), ausdCash: 50_000_000n })?.functionName).toBe("convertToMargin");
  });

  it("buys a spot slice at the exact on-chain floor once margin is in place", () => {
    const o = { ...base(), usdcCash: 880_000_000n, perplAccountId: 7n, perplFree: 920_000_000n, perplEquity: 920_000_000n };
    const r = call(o);
    expect(r?.functionName).toBe("buySpot");
    const usdcIn = r!.args![0] as bigint;
    expect(usdcIn).toBe((9_000_000n * 9_500n) / 10_000n);
    expect(r!.args![1]).toBe(floors.buySpot(usdcIn, PX));
  });

  it("shorts new spot, and sells it instead while new risk is paused", () => {
    const o = {
      ...base(),
      usdcCash: 891_000_000n,
      perplAccountId: 7n,
      perplFree: 900_000_000n,
      perplEquity: 900_000_000n,
      monQty: 275n * E18 + 10n ** 17n,
    };
    const r = call(o);
    expect(r?.functionName).toBe("openShort");
    expect(r!.args![0]).toBe(275n);
    expect(r!.args![1]).toBe(floors.openShort(PX, 100_000n));
    expect(call({ ...o, riskPaused: true })?.functionName).toBe("sellSpot");
  });

  it("tops up margin before shorting when free margin is short", () => {
    const o = { ...base(), usdcCash: 891_000_000n, perplAccountId: 7n, perplFree: 1_000_000n, perplEquity: 1_000_000n, monQty: 275n * E18 };
    expect(call(o)?.functionName).toBe("convertToMargin");
  });

  it("closes a short that is larger than spot", () => {
    const o = { ...base(), perplAccountId: 7n, perplFree: 0n, perplEquity: 900_000_000n, monQty: 100n * E18, shortLots: 300n };
    const r = call(o);
    expect(r?.functionName).toBe("closeShort");
    expect(r!.args![0]).toBe(200n);
    expect(r!.args![1]).toBe(floors.closeShort(PX, 100_000n));
  });

  it("unwinds for the book in order: AUSD, unhedged spot, short slices, spot, margin", () => {
    const u = { ...base(), cashShortfall: 50_000_000n, perplAccountId: 7n };
    expect(call({ ...u, ausdCash: 10_000_000n })?.functionName).toBe("convertToCash");
    expect(call({ ...u, monQty: 500n * E18, shortLots: 200n })?.functionName).toBe("sellSpot");
    expect(call({ ...u, monQty: 200n * E18, shortLots: 200n })?.functionName).toBe("closeShort");
    expect(call({ ...u, monQty: 200n * E18, shortLots: 0n })?.functionName).toBe("sellSpot");
    expect(call({ ...u, perplFree: 400_000_000n })?.functionName).toBe("withdrawMargin");
    expect(call({ ...u, usdcCash: 0n })).toBeNull();
  });

  it("every action targets the engine with an allowlisted selector", () => {
    const allowed = new Set(engineAllowlist(E).map((a) => a.selector));
    for (const fn of engineWriteAbi) {
      const sig = `${fn.name}(${fn.inputs.map((i) => i.type).join(",")})`;
      expect(allowed.has(toFunctionSelector(sig))).toBe(true);
    }
    expect(engineAllowlist(E).every((a) => a.target === E)).toBe(true);
  });
});

/**
 * A minimal engine model: fills at the valuation price, Perpl at 1× (the whole notional posted).
 * Enough to show the policy converges and never asks for what the contract would refuse.
 */
function simulate(start: HedgeObserved, ticks: number, onTick?: (o: HedgeObserved) => void, c: HedgeConfig = cfg) {
  let o = { ...start };
  const usdcOf = (mon: bigint) => (mon * o.px) / 10n ** 30n;
  for (let i = 0; i < ticks; i++) {
    o.now += 30n;
    o.priceAt = o.now;
    o.value = o.usdcCash + o.ausdCash + o.perplEquity + usdcOf(o.monQty);
    o.sliceCap = (o.value * 50n) / 10_000n > 100_000_000n ? 100_000_000n : (o.value * 50n) / 10_000n;
    const p = decideHedge(o, c, E);
    if (!p) break;
    const d = decodeFunctionData({ abi: engineWriteAbi, data: p.calldata as `0x${string}` });
    const args = d.args as readonly bigint[];
    const a = args[0]!;
    const b = args[1] ?? 0n;
    switch (d.functionName) {
      case "convertToMargin": {
        expect(a).toBeLessThanOrEqual(o.usdcCash);
        o.usdcCash -= a;
        o.ausdCash += (a * 9_994n) / 10_000n; // ~6 bps route cost
        expect((a * 9_994n) / 10_000n).toBeGreaterThanOrEqual(b);
        break;
      }
      case "convertToCash":
        o.ausdCash -= a;
        o.usdcCash += (a * 9_994n) / 10_000n;
        break;
      case "depositMargin":
        if (o.perplAccountId === 0n) expect(a).toBeGreaterThanOrEqual(o.minAccountOpen);
        o.perplAccountId = 7n;
        o.ausdCash -= a;
        o.perplFree += a;
        o.perplEquity += a;
        break;
      case "withdrawMargin":
        expect(a).toBeLessThanOrEqual(o.perplFree);
        o.perplFree -= a;
        o.perplEquity -= a;
        o.ausdCash += a;
        break;
      case "buySpot":
        expect(a).toBeLessThanOrEqual(o.sliceCap);
        o.usdcCash -= a;
        o.monQty += (a * 10n ** 30n) / o.px;
        break;
      case "sellSpot":
        expect(usdcOf(a)).toBeLessThanOrEqual(o.sliceCap);
        o.monQty -= a;
        o.usdcCash += usdcOf(a);
        break;
      case "openShort": {
        const n = usdcOf(a * E18);
        expect(n).toBeLessThanOrEqual(o.sliceCap);
        expect(o.perplFree).toBeGreaterThanOrEqual(n);
        o.perplFree -= n; // posted into the position: equity unchanged
        o.shortLots += a;
        break;
      }
      case "closeShort": {
        const locked = o.perplEquity - o.perplFree; // position deposit
        const n = (locked * a) / o.shortLots;
        o.shortLots -= a;
        o.perplFree += n;
        break;
      }
    }
    // The contract's gap rule: spot and short never more than one slice apart (plus a lot's rounding).
    const gap = o.monQty > o.shortLots * E18 ? o.monQty - o.shortLots * E18 : o.shortLots * E18 - o.monQty;
    expect(usdcOf(gap)).toBeLessThanOrEqual(o.sliceCap + usdcOf(E18));
    onTick?.(o);
  }
  return o;
}

describe("v2 hedge policy — simulated engine", () => {
  it("builds a matched hedge at the target split from cash, within one slice at every step", () => {
    const end = simulate(base(), 2_000);
    const spot = (end.monQty * end.px) / 10n ** 30n;
    const value = end.usdcCash + end.ausdCash + end.perplEquity + spot;
    const spotTarget = (value * 10_000n) / 20_300n;
    expect(Number(spot)).toBeGreaterThan(Number(spotTarget) * 0.97);
    expect(end.monQty / E18 - end.shortLots).toBeLessThanOrEqual(1n);
    expect(end.usdcCash).toBeLessThan(cfg.minMove * 2n + end.sliceCap);
  });

  it("unwinds to cash when the book asks for it, then stops", () => {
    const hedged = simulate(base(), 2_000);
    const end = simulate({ ...hedged, cashShortfall: 10n ** 15n }, 3_000);
    expect(end.shortLots).toBe(0n);
    expect(end.monQty).toBeLessThan(E18);
    expect(end.perplFree).toBeLessThan(cfg.minMove);
    expect(end.ausdCash).toBeLessThan(cfg.minMove);
    expect(end.usdcCash).toBeGreaterThan(1_790_000_000n); // ~0.5% total round-trip cost in the model
  });
});

describe("v2 controller policy with a hedged engine", () => {
  const pcfg: PolicyConfig = { settleEverySec: 3600n, batchSize: 10n, idleTargetBps: 1_500n, minMove: 1_000_000n };
  const o = (): Observed => ({
    now: 1_800_000_000n,
    pendingBallastDeposits: 0n,
    pendingExits: 0n,
    headExitReadyAt: 0n,
    activeSeries: 1n,
    seriesState: 4,
    subscriptionEnd: 0n,
    maturity: 0n,
    hullNav: 500_000_000n,
    impaired: false,
    activeIdle: 150_000_000n,
    engineValue: 850_000_000n,
    engineCash: 100_000_000n,
    treasuryLiability: 0n,
    engineWired: true,
    lastSettleAt: 1_800_000_000n,
  });

  it("recalls only the engine's cash for a maturing series and reports the rest as shortfall", () => {
    const p = decide(o(), pcfg, C);
    expect(p?.action).toBe("recallFromEngine");
    expect(p?.inputs).toMatchObject({ amount: "100000000" });
    expect(engineCashNeed(o(), pcfg)).toEqual({ need: 350_000_000n, available: 100_000_000n });
    expect(decide({ ...o(), engineCash: 0n }, pcfg, C)).toBeNull(); // nothing to recall: the hedge unwinds
  });

  it("refills the idle buffer from engine cash after exits drain it", () => {
    const drained = { ...o(), activeSeries: 0n, seriesState: 0, hullNav: 0n, activeIdle: 50_000_000n };
    const p = decide(drained, pcfg, C);
    expect(p?.action).toBe("recallFromEngine");
    expect(p?.inputs).toMatchObject({ amount: "85000000" }); // target 15% of 900 = 135; holds 50
  });
});

describe("v2 hedge policy — small testnet book (Perpl's 100 AUSD account minimum)", () => {
  const small: HedgeConfig = { ...defaultHedgeConfig, minMove: 100_000n }; // 0.10 USDC
  const smallBook = (usdc: bigint): HedgeObserved => ({
    ...base(),
    value: usdc,
    usdcCash: usdc,
    sliceCap: (usdc * 50n) / 10_000n,
  });

  it("never withdraws margin below the account minimum", () => {
    // 102 USDC engine: account open with 101 AUSD; the 50/50 split would want ~50 back.
    const o = { ...smallBook(102_000_000n), usdcCash: 1_000_000n, perplAccountId: 7n, perplFree: 101_000_000n, perplEquity: 101_000_000n };
    const p = decideHedge(o, small, E);
    if (p?.action === "withdrawMargin") {
      const amt = decodeFunctionData({ abi: engineWriteAbi, data: p.calldata as `0x${string}` }).args![0] as bigint;
      expect(101_000_000n - amt).toBeGreaterThanOrEqual(100_000_000n);
    } else {
      expect(p?.action).not.toBe("withdrawMargin");
    }
  });

  it("a ~120 USDC engine opens the account and hedges a small spot leg, matched, never below the minimum", () => {
    let minEquityAfterOpen: bigint | null = null;
    const end = simulate(
      smallBook(120_000_000n),
      3_000,
      (o) => {
        if (o.perplAccountId > 0n) minEquityAfterOpen = minEquityAfterOpen === null || o.perplEquity < minEquityAfterOpen ? o.perplEquity : minEquityAfterOpen;
      },
      small,
    );
    expect(end.perplAccountId).toBeGreaterThan(0n);
    expect(end.monQty).toBeGreaterThan(0n);
    expect(end.shortLots).toBeGreaterThan(0n);
    expect(end.monQty / E18 - end.shortLots).toBeLessThanOrEqual(1n);
    expect(minEquityAfterOpen! >= 100_000_000n).toBe(true);
    // Spot gets what is left after the minimum margin: about 120 − 100.4 − conversion costs.
    const spot = (end.monQty * end.px) / 10n ** 30n;
    expect(spot).toBeGreaterThan(15_000_000n);
  });
});
