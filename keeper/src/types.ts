/** Shared types for the Perpl short-manager keeper. */

export type Decision =
  | { kind: "noop"; reason: string }
  | { kind: "crank"; reason: string }
  | { kind: "reduce"; targetNotional: bigint; reason: string }
  | { kind: "halt"; reason: string };

export type KeeperState = {
  /** Engine-held WMON (18dec). */
  spotInventoryWei: bigint;
  /** Marked spot value in quote (6dec) from IRouter.quoteExactBaseForQuote. */
  spotValueQuote: bigint;
  /** Absolute Perpl short notional in quote (6dec). 0 = flat. */
  perplShortNotional: bigint;
  /** Latest funding rate in micros (10^-6). Positive = longs pay shorts. */
  fundingRateMicros: number;
  /** Previous funding rate micros (for sign-flip detection). */
  prevFundingRateMicros: number;
  /** Best ask depth available to exit (quote 6dec). */
  exitDepthQuote: bigint;
  /** Allowed |spot - short| band in bps of combined book. */
  deviationBandBps: number;
  /** Current |netDelta| in bps of (spot+short). */
  netDeltaBps: number;
  /** Cap utilisation bps of configured AUM vs OI (0..10000+). */
  capUtilisationBps: number;
  /** Last successful on-chain crank block. */
  lastCrankBlock: bigint;
  /** Current chain head. */
  headBlock: bigint;
  /** Crank interval target in blocks (approx). */
  crankIntervalBlocks: bigint;
  /** Estimated MON wei runway for gas_limit-budgeted cranks. */
  gasBudgetWei: bigint;
  /** Minimum runway before halt (wei). */
  minGasBudgetWei: bigint;
  /** Market-data age in ms. */
  marketDataAgeMs: number;
  /** Max stale market data before halt. */
  maxMarketDataAgeMs: number;
  /** Operator kill switch. */
  killSwitch: boolean;
  /** Max notional the keeper may touch in one action (6dec). */
  maxNotionalPerAction: bigint;
};

export type CloseReason =
  | "too many requests"
  | "too many connections"
  | "ping timeout"
  | "idle timeout"
  | "failed to process"
  | "unauthorized"
  | "send buffer overflow"
  | "going away"
  | "abnormal"
  | "unknown";

export type Fill = {
  oid: number;
  mkt: number;
  s: number;
  p?: number;
  /** Gross fee — already includes builder portion `bfa`. Never add f+bfa. */
  f: string;
  bfa?: string;
  at?: { t: number; b?: number };
};

export type Position = {
  id: number;
  mkt: number;
  /** Signed size; short is negative on Perpl. */
  s: number;
  /** Notional in collateral native scale when provided. */
  n?: string;
};

export type LastDecision = {
  at: number;
  decision: Decision;
  dryRun: boolean;
  orderId?: number | string;
  note?: string;
};
