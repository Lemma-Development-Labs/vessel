import type { Live } from "./live";

export type DeckKind = "hull" | "ballast";

/**
 * RULE 0: every field a user can read is a `Live<T>`. There is no shape here
 * that can hold a number without also holding its provenance, so a failed
 * chain read cannot be rendered as data.
 */
export type DeckStats = {
  hullTvl: Live<bigint>;
  balTvl: Live<bigint>;
  reserve: Live<bigint>;
  treasuryAccrued: Live<bigint>;
  hullSupply: Live<bigint>;
  balSupply: Live<bigint>;
  lastSettle: Live<bigint>;
  thetaBps: Live<bigint>;
  /** Tranches.HULL_RATE_BPS() — the senior coupon. Read, not assumed. */
  hullRateBps: Live<bigint>;
  /** Tranches.RESERVE_TARGET_BPS(). */
  reserveTargetBps: Live<bigint>;
  /** Tranches.THETA_MIN_BPS() — the subordination floor itself. */
  thetaMinBps: Live<bigint>;
  /** Tranches.FEE_BPS(). */
  feeBps: Live<bigint>;
};

export type EngineView = {
  spotQty: Live<bigint>;
  spotValue: Live<bigint>;
  shortNotional: Live<bigint>;
  netDelta: Live<bigint>;
  netDeltaBps: Live<bigint>;
  /**
   * Signed, from IVenue.position(id).fundingAccrued. Previously hardcoded to
   * 0n while the value was already being fetched and discarded.
   */
  fundingAccrued: Live<bigint>;
  /** Signed venue funding rate in bps. Replaces a hardcoded "12.00% APR". */
  fundingRateBps: Live<bigint>;
  lastCrankTs: Live<bigint>;
  lastBlock: Live<number>;
  venueName: Live<string>;
  simulated: Live<boolean>;
  shortId: Live<bigint>;
  keeperActive: Live<boolean>;
  lastCrankBy: Live<`0x${string}`>;
};

/**
 * What the vault can actually pay out right now. `idle` is the vault's own
 * dUSD balance; anything beyond it is at the engine and must be unwound first.
 * This is the read the exit flow was missing.
 */
export type VaultLiquidity = {
  idle: Live<bigint>;
  deployed: Live<bigint>;
};

export type FaucetState = {
  /** Seconds until the faucet is callable again. 0 means ready. */
  cooldownSec: Live<number>;
  /** dUSD still mintable under the lifetime cap. */
  lifetimeRemaining: Live<bigint>;
};

export type WaterfallEvent = {
  gross: bigint;
  fee: bigint;
  toReserve: bigint;
  toTreasury: bigint;
  hullAccrual: bigint;
  toBallast: bigint;
  fromBallast: bigint;
  fromReserve: bigint;
  hullTvl: bigint;
  balTvl: bigint;
  reserve: bigint;
  ts: bigint;
  txHash: string;
  blockNumber?: bigint;
};

export type Toast = {
  id: string;
  kind: "pending" | "success" | "error" | "info";
  text: string;
  href?: string;
};

export type PositionMeta = {
  /** Block timestamp of the user's first join, from indexed events. */
  boardedAt: Live<number>;
  /** Net assets the user put in, from indexed join/exit events. */
  principal: Live<bigint>;
  /** Deck NAV per share over time, from indexed Waterfall events. */
  spark: Live<number[]>;
};

/** Where the waterfall history came from, so the UI can say so. */
export type HistorySource = "stats" | "chain" | "mock" | "none";

export interface VesselDataProvider {
  dusdBalance: Live<bigint>;
  hullShares: Live<bigint>;
  balShares: Live<bigint>;
  deck: DeckStats;
  engine: EngineView;
  vault: VaultLiquidity;
  faucetState: FaucetState;
  waterfall: WaterfallEvent[];
  historySource: HistorySource;
  paused: Live<boolean>;

  /** Local session state — known without a chain read, so not Live<T>. */
  loading: boolean;
  connected: boolean;
  address?: `0x${string}`;
  chainId: number;
  wrongNetwork: boolean;
  reconnecting: boolean;
  impaired: boolean;
  isMock: boolean;

  hullMeta: PositionMeta;
  balMeta: PositionMeta;
  toasts: Toast[];

  faucet: () => Promise<void>;
  deposit: (amount: bigint, deck: DeckKind) => Promise<void>;
  withdraw: (shares: bigint, deck: DeckKind) => Promise<void>;
  joinHull: (assets: bigint) => Promise<void>;
  joinBallast: (assets: bigint) => Promise<void>;
  exitHull: (shares: bigint) => Promise<void>;
  exitBallast: (shares: bigint) => Promise<void>;
  crank: () => Promise<void>;
  deployLiquidity: () => Promise<void>;
  /** Closes the short, swaps WMON back, returns everything to the vault. */
  unwind: () => Promise<void>;
  connect: (connectorId?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  dismissToast: (id: string) => void;
  connectors: { id: string; name: string; ready: boolean }[];
}

/* ------------------------------------------------------------------ *
 * Exit planning — the Phase 0.1 fix.
 *
 * After deployLiquidity(), ~90% of vault cash is at the engine. Tranches
 * settles an exit with vault.withdraw(assetsOut), which transfers from the
 * vault's own dUSD balance. If assetsOut exceeds that balance the transaction
 * reverts with an ERC20 balance error the user cannot act on.
 *
 * We check it up front and, when short, name the exact shortfall and offer
 * unwind instead of letting the user burn gas on a doomed transaction.
 * ------------------------------------------------------------------ */

export type ExitPlan =
  /** Enough idle dUSD; the exit will be served. */
  | { kind: "ready"; assetsOut: bigint }
  /** Vault cannot cover it. The hedge must be unwound first. */
  | { kind: "needs-unwind"; assetsOut: bigint; idle: bigint; shortfall: bigint }
  /** The subordination floor blocks this exit regardless of liquidity. */
  | { kind: "blocked-floor"; assetsOut: bigint }
  /** We could not read what we needed. Never guess — say so. */
  | { kind: "unknown"; reason: string };

/**
 * Decide whether an exit can be served, using only values we actually read.
 * Any unreadable input yields "unknown" rather than an optimistic "ready" —
 * an exit we wrongly call ready costs the user a reverted transaction.
 */
export function planExit(args: {
  shares: bigint;
  deckTvl: Live<bigint>;
  deckSupply: Live<bigint>;
  otherTvl: Live<bigint>;
  idle: Live<bigint>;
  thetaMinBps: Live<bigint>;
  exitingBallast: boolean;
}): ExitPlan {
  const { shares, deckTvl, deckSupply, otherTvl, idle, thetaMinBps, exitingBallast } = args;

  if (shares <= 0n) return { kind: "unknown", reason: "no shares selected" };
  if (deckTvl.status !== "ok") return { kind: "unknown", reason: `deck TVL unavailable — ${deckTvl.reason}` };
  if (deckSupply.status !== "ok") {
    return { kind: "unknown", reason: `deck share supply unavailable — ${deckSupply.reason}` };
  }
  if (deckSupply.value === 0n) return { kind: "unknown", reason: "deck has no shares" };

  // Mirrors Tranches.exitHull/exitBallast: assetsOut floors.
  const assetsOut = (shares * deckTvl.value) / deckSupply.value;

  // Floor check first — it reverts before liquidity is ever consulted.
  if (exitingBallast) {
    if (otherTvl.status !== "ok" || thetaMinBps.status !== "ok") {
      return { kind: "unknown", reason: "subordination floor inputs unavailable" };
    }
    const newBal = deckTvl.value - assetsOut;
    const sum = otherTvl.value + newBal;
    const breaches = sum > 0n && newBal * 10_000n < thetaMinBps.value * sum;
    if (breaches) {
      // Tranches allows an exit that still improves the ratio.
      const oldSum = otherTvl.value + deckTvl.value;
      const oldBps = oldSum === 0n ? 10_000n : (deckTvl.value * 10_000n) / oldSum;
      const newBps = sum === 0n ? 10_000n : (newBal * 10_000n) / sum;
      if (newBps < oldBps) return { kind: "blocked-floor", assetsOut };
    }
  }

  if (idle.status !== "ok") {
    return { kind: "unknown", reason: `vault liquidity unavailable — ${idle.reason}` };
  }
  if (assetsOut > idle.value) {
    return { kind: "needs-unwind", assetsOut, idle: idle.value, shortfall: assetsOut - idle.value };
  }
  return { kind: "ready", assetsOut };
}

export const COPY = {
  floor: "Ballast must stay at or above 20% of deck TVL. Join Ballast or exit Hull.",
  hullFull: "Hull is full for now — Ballast capacity must grow first (20% floor)",
  ballastExit:
    "Exit queued by the floor — Ballast is what protects Hull. Capacity frees as Hull exits or Ballast grows.",
  cooldown: (s: number) => {
    const m = Math.floor(Math.max(0, s) / 60);
    const r = Math.max(0, s) % 60;
    return `Faucet cooldown — ${m}:${r.toString().padStart(2, "0")} remaining`;
  },
  impair: "HULL IMPAIRMENT — halted",
  slippage: "price moved — try again",
  banner: "TESTNET — demo assets, unaudited contracts.",
  legal: "Unaudited testnet. Demo dollars (dUSD) have no value. Not an offer of securities.",
  unwindWhat:
    "Unwind closes the venue short, swaps WMON back to dUSD, and returns every deployed dollar to the vault. It is permissionless — anyone can call it.",
  unwindScope:
    "This unwinds the hedge for the whole vault, not just your position. Funding stops accruing until the hedge is redeployed.",
} as const;

export function thetaWouldHold(hull: bigint, bal: bigint): boolean {
  const sum = hull + bal;
  if (sum === 0n) return true;
  return bal * 10_000n >= 2_000n * sum;
}
