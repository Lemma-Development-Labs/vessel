export type DeckKind = "hull" | "ballast";

export type DeckStats = {
  hullTvl: bigint;
  balTvl: bigint;
  reserve: bigint;
  treasuryAccrued: bigint;
  hullSupply: bigint;
  balSupply: bigint;
  lastSettle: bigint;
  thetaBps: bigint;
  hullRateBps: bigint;
  balLeveredAprBps: bigint;
  reserveTargetBps: bigint;
};

export type EngineView = {
  spotQty: bigint;
  spotValue: bigint;
  shortNotional: bigint;
  netDelta: bigint;
  netDeltaBps: bigint;
  fundingAccrued: bigint;
  lastCrankTs: bigint;
  lastBlock: number;
  venueName: string;
  simulated: boolean;
  shortId: bigint;
  keeperActive: boolean;
  lastCrankBy?: `0x${string}`;
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

export type SparkPoint = number;

export type PositionMeta = {
  boardedAt: number;
  principal: bigint;
  spark: SparkPoint[];
};

export interface VesselDataProvider {
  dusdBalance: bigint;
  hullShares: bigint;
  balShares: bigint;
  deck: DeckStats;
  engine: EngineView;
  waterfall: WaterfallEvent[];
  loading: boolean;
  connected: boolean;
  address?: `0x${string}`;
  chainId: number;
  wrongNetwork: boolean;
  reconnecting: boolean;
  paused: boolean;
  impaired: boolean;
  faucetCooldownSec: number;
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
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  dismissToast: (id: string) => void;
}

export const EMPTY_DECK: DeckStats = {
  hullTvl: 0n,
  balTvl: 0n,
  reserve: 0n,
  treasuryAccrued: 0n,
  hullSupply: 0n,
  balSupply: 0n,
  lastSettle: 0n,
  thetaBps: 10_000n,
  hullRateBps: 800n,
  balLeveredAprBps: 0n,
  reserveTargetBps: 200n,
};

export const EMPTY_ENGINE: EngineView = {
  spotQty: 0n,
  spotValue: 0n,
  shortNotional: 0n,
  netDelta: 0n,
  netDeltaBps: 0n,
  fundingAccrued: 0n,
  lastCrankTs: 0n,
  lastBlock: 0,
  venueName: "SimVenue",
  simulated: true,
  shortId: 0n,
  keeperActive: false,
};

export const EMPTY_META: PositionMeta = {
  boardedAt: 0,
  principal: 0n,
  spark: [],
};

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
} as const;

export function thetaWouldHold(hull: bigint, bal: bigint): boolean {
  const sum = hull + bal;
  if (sum === 0n) return true;
  return bal * 10_000n >= 2_000n * sum;
}

export function wouldBreachFloor(hull: bigint, bal: bigint, exitingBallast: boolean): boolean {
  if (!exitingBallast) return false;
  const sum = hull + bal;
  if (sum === 0n) return false;
  const newBps = (bal * 10_000n) / sum;
  return newBps < 2_000n;
}
