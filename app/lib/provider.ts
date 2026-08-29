export type DeckStats = {
  hullTvl: bigint;
  balTvl: bigint;
  reserve: bigint;
  treasuryAccrued: bigint;
  hullSupply: bigint;
  balSupply: bigint;
  lastSettle: bigint;
  thetaBps: bigint;
};

export type EngineView = {
  netDelta: bigint;
  netDeltaBps: bigint;
  shortId: bigint;
  simulated: boolean;
  venueName: string;
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
};

export type Toast = {
  id: string;
  kind: "pending" | "success" | "error" | "info";
  text: string;
  href?: string;
};

export interface VesselDataProvider {
  dusdBalance: bigint;
  hullShares: bigint;
  balShares: bigint;
  deck: DeckStats;
  engine: EngineView;
  waterfall: WaterfallEvent[];
  connected: boolean;
  address?: `0x${string}`;
  chainId: number;
  wrongNetwork: boolean;
  reconnecting: boolean;
  paused: boolean;
  impaired: boolean;
  toasts: Toast[];
  faucet: () => Promise<void>;
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
};

export const EMPTY_ENGINE: EngineView = {
  netDelta: 0n,
  netDeltaBps: 0n,
  shortId: 0n,
  simulated: true,
  venueName: "SimVenue",
};

export const COPY = {
  floor:
    "Ballast must stay at or above 20% of deck TVL. Join Ballast or exit Hull.",
  cooldown: (s: number) => `Faucet cooling down — ${s}s left.`,
  impair:
    "Hull impairment — v0 halted. Ballast and reserve cannot absorb this loss.",
  slippage: "price moved — try again",
} as const;
