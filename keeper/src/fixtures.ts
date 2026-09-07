/**
 * Shared policy fixtures — used by keeper/test/policy.test.ts and
 * cre/test/policy-equivalence.test.ts. Identical inputs must yield identical
 * decisions in both runtimes (CRE imports decide(); it does not reimplement it).
 */
import type { KeeperState } from "./types.ts";

export function baseState(over: Partial<KeeperState> = {}): KeeperState {
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

export type PolicyFixture = {
  name: string;
  state: KeeperState;
  expectKind: "noop" | "crank" | "reduce" | "halt";
  reasonMatch?: RegExp;
};

export const POLICY_FIXTURES: PolicyFixture[] = [
  {
    name: "noop when balanced and crank not due",
    state: baseState(),
    expectKind: "noop",
  },
  {
    name: "crank when interval elapsed",
    state: baseState({ headBlock: 3000n, lastCrankBlock: 1000n }),
    expectKind: "crank",
    reasonMatch: /crank due/,
  },
  {
    name: "halt on kill switch",
    state: baseState({ killSwitch: true }),
    expectKind: "halt",
  },
  {
    name: "halt on gas runway",
    state: baseState({ gasBudgetWei: 1n, minGasBudgetWei: 100n }),
    expectKind: "halt",
  },
  {
    name: "halt on stale market data",
    state: baseState({ marketDataAgeMs: 120_000 }),
    expectKind: "halt",
  },
  {
    name: "halt on cap breach",
    state: baseState({ capUtilisationBps: 12_000 }),
    expectKind: "halt",
  },
  {
    name: "halt on funding sign flip",
    state: baseState({
      fundingRateMicros: -6000,
      prevFundingRateMicros: 1000,
      headBlock: 1100n,
    }),
    expectKind: "halt",
    reasonMatch: /funding sign flip/,
  },
  {
    name: "reduce when deviation outside band with depth",
    state: baseState({
      netDeltaBps: 250,
      spotValueQuote: 150_000_000n,
      perplShortNotional: 100_000_000n,
      exitDepthQuote: 100_000_000n,
    }),
    expectKind: "reduce",
  },
  {
    name: "halt when deviation and insufficient exit depth",
    state: baseState({
      netDeltaBps: 250,
      spotValueQuote: 150_000_000n,
      perplShortNotional: 100_000_000n,
      exitDepthQuote: 1n,
    }),
    expectKind: "halt",
    reasonMatch: /exit depth/,
  },
];
