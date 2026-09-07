import type { Decision, KeeperState } from "./types.ts";

export type SnapshotJson = {
  spotInventoryWei: string;
  spotValueQuote: string;
  perplShortNotional: string;
  fundingRateMicros: number;
  prevFundingRateMicros: number;
  exitDepthQuote: string;
  deviationBandBps: number;
  netDeltaBps: number;
  capUtilisationBps: number;
  lastCrankBlock: string;
  headBlock: string;
  crankIntervalBlocks: number;
  gasBudgetWei: string;
  minGasBudgetWei: string;
  marketDataAgeMs: number;
  maxMarketDataAgeMs: number;
  killSwitch: boolean;
  maxNotionalPerAction: string;
};

export function snapshotToState(s: SnapshotJson): KeeperState {
  return {
    spotInventoryWei: BigInt(s.spotInventoryWei),
    spotValueQuote: BigInt(s.spotValueQuote),
    perplShortNotional: BigInt(s.perplShortNotional),
    fundingRateMicros: s.fundingRateMicros,
    prevFundingRateMicros: s.prevFundingRateMicros,
    exitDepthQuote: BigInt(s.exitDepthQuote),
    deviationBandBps: s.deviationBandBps,
    netDeltaBps: s.netDeltaBps,
    capUtilisationBps: s.capUtilisationBps,
    lastCrankBlock: BigInt(s.lastCrankBlock),
    headBlock: BigInt(s.headBlock),
    crankIntervalBlocks: BigInt(s.crankIntervalBlocks),
    gasBudgetWei: BigInt(s.gasBudgetWei),
    minGasBudgetWei: BigInt(s.minGasBudgetWei),
    marketDataAgeMs: s.marketDataAgeMs,
    maxMarketDataAgeMs: s.maxMarketDataAgeMs,
    killSwitch: s.killSwitch,
    maxNotionalPerAction: BigInt(s.maxNotionalPerAction),
  };
}

export function stateToSnapshot(s: KeeperState): SnapshotJson {
  return {
    spotInventoryWei: s.spotInventoryWei.toString(),
    spotValueQuote: s.spotValueQuote.toString(),
    perplShortNotional: s.perplShortNotional.toString(),
    fundingRateMicros: s.fundingRateMicros,
    prevFundingRateMicros: s.prevFundingRateMicros,
    exitDepthQuote: s.exitDepthQuote.toString(),
    deviationBandBps: s.deviationBandBps,
    netDeltaBps: s.netDeltaBps,
    capUtilisationBps: s.capUtilisationBps,
    lastCrankBlock: s.lastCrankBlock.toString(),
    headBlock: s.headBlock.toString(),
    crankIntervalBlocks: Number(s.crankIntervalBlocks),
    gasBudgetWei: s.gasBudgetWei.toString(),
    minGasBudgetWei: s.minGasBudgetWei.toString(),
    marketDataAgeMs: s.marketDataAgeMs,
    maxMarketDataAgeMs: s.maxMarketDataAgeMs,
    killSwitch: s.killSwitch,
    maxNotionalPerAction: s.maxNotionalPerAction.toString(),
  };
}

export function decisionToJson(d: Decision): {
  kind: string;
  reason: string;
  targetNotional?: string;
} {
  return {
    kind: d.kind,
    reason: d.reason,
    ...(d.kind === "reduce" ? { targetNotional: d.targetNotional.toString() } : {}),
  };
}
