import { describe, expect, it } from "vitest";
import { decide } from "../src/policy.ts";
import type { KeeperState } from "../src/types.ts";

function base(over: Partial<KeeperState> = {}): KeeperState {
  return {
    spotInventoryWei: 1n * 10n ** 18n,
    spotValueQuote: 100_000_000n,
    perplShortNotional: 100_000_000n,
    fundingRateMicros: 100,
    prevFundingRateMicros: 100,
    exitDepthQuote: 1_000_000_000n,
    deviationBandBps: 100,
    netDeltaBps: 0,
    capUtilisationBps: 0,
    lastCrankBlock: 1000n,
    headBlock: 1100n,
    crankIntervalBlocks: 1500n,
    gasBudgetWei: 10n ** 18n,
    minGasBudgetWei: 10n ** 15n,
    marketDataAgeMs: 100,
    maxMarketDataAgeMs: 60_000,
    killSwitch: false,
    maxNotionalPerAction: 50_000_000n,
    ...over,
  };
}

describe("policy decide fixtures", () => {
  it("noop when balanced and crank not due", () => {
    expect(decide(base()).kind).toBe("noop");
  });

  it("crank when interval elapsed", () => {
    const d = decide(base({ headBlock: 3000n, lastCrankBlock: 1000n }));
    expect(d.kind).toBe("crank");
    if (d.kind === "crank") expect(d.reason).toMatch(/crank due/);
  });

  it("halt on kill switch", () => {
    expect(decide(base({ killSwitch: true })).kind).toBe("halt");
  });

  it("halt on gas runway", () => {
    expect(decide(base({ gasBudgetWei: 1n, minGasBudgetWei: 100n })).kind).toBe("halt");
  });

  it("halt on stale market data", () => {
    expect(decide(base({ marketDataAgeMs: 120_000 })).kind).toBe("halt");
  });

  it("halt on cap breach", () => {
    expect(decide(base({ capUtilisationBps: 12_000 })).kind).toBe("halt");
  });

  it("halt on funding sign flip", () => {
    const d = decide(
      base({
        fundingRateMicros: -6000,
        prevFundingRateMicros: 1000,
        headBlock: 1100n,
      }),
    );
    expect(d.kind).toBe("halt");
    expect(d.reason).toMatch(/funding sign flip/);
  });

  it("reduce when deviation outside band with depth", () => {
    const d = decide(
      base({
        netDeltaBps: 250,
        spotValueQuote: 150_000_000n,
        perplShortNotional: 100_000_000n,
        exitDepthQuote: 100_000_000n,
      }),
    );
    expect(d.kind).toBe("reduce");
    if (d.kind === "reduce") expect(d.targetNotional).toBe(50_000_000n); // capped by max
  });

  it("halt when deviation and insufficient exit depth", () => {
    const d = decide(
      base({
        netDeltaBps: 250,
        spotValueQuote: 150_000_000n,
        perplShortNotional: 100_000_000n,
        exitDepthQuote: 1n,
      }),
    );
    expect(d.kind).toBe("halt");
    expect(d.reason).toMatch(/exit depth/);
  });
});
