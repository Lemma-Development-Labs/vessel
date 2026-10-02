import type { Live } from "../live";
import type { Toast } from "../copy";

/**
 * The v2 book (TrancheController) as the app reads it. Rule 0 still holds:
 * every group a user can read is a `Live<T>`. A group shares one provenance
 * because it comes from one multicall at one block — it is either all read or
 * all unavailable, never half-filled with defaults.
 */

export const SERIES_STATES = [
  "NONE",
  "SUBSCRIPTION_OPEN",
  "CANCELLED",
  "ACTIVE",
  "MATURED_UNWINDING",
  "CLAIMABLE",
  "CLOSED",
  "IMPAIRED",
] as const;
export type SeriesState = (typeof SERIES_STATES)[number];

export const REQ_STATUSES = ["NONE", "ESCROWED", "ADMITTED", "REFUNDABLE", "REFUNDED"] as const;
export type ReqStatus = (typeof REQ_STATUSES)[number];

export const EXIT_STATUSES = ["NONE", "COOLING", "FUNDED", "CANCELLED"] as const;
export type ExitStatus = (typeof EXIT_STATUSES)[number];

export type TrancheKind = "hull" | "ballast";

/** PauseGuardian dimensions (bitmask). */
export const PAUSE = { ADMISSION: 1, RISK_INCREASE: 2, SETTLEMENT: 4, CLAIMS: 8 } as const;

/** Contract constants (TrancheController), mirrored for planning; the chain still enforces them. */
export const RULES = {
  EXIT_COOLDOWN_SEC: 48n * 3600n,
  SUBSCRIPTION_WINDOW_SEC: 72n * 3600n,
  HULL_TERM_SEC: 28n * 86400n,
  MAX_SUBSCRIBERS: 25n,
  ABSOLUTE_LIFETIME_CAP: 25_000_000_000n,
  COVER_TARGET_BPS: 3_000n,
  COVER_FLOOR_BPS: 2_000n,
  RESERVE_TARGET_BPS: 200n,
} as const;

export type BookState = {
  hullNav: bigint;
  ballastNav: bigint;
  reserveNav: bigint;
  treasuryLiability: bigint;
  recordedActive: bigint;
  lossCarry: bigint;
  epoch: bigint;
  impaired: boolean;
  /** B / (H + B) in bps, from juniorCoverBps(). */
  coverBps: bigint;
  stageCap: bigint;
  lifetimeAdmitted: bigint;
  pendingReserved: bigint;
  activeSeries: bigint;
  seriesCount: bigint;
  ballastSupply: bigint;
  /** Ballast unit pricing offsets (immutable, release-manifest values). */
  virtualUnits: bigint;
  virtualAssets: bigint;
  pausedMask: number;
  /** Address of the wired engine; null before governance wires one. */
  engine: `0x${string}` | null;
  /** Custody cash: deposits awaiting admission, and idle book cash. */
  custodyPending: bigint;
  activeIdle: bigint;
  /** dUSD funded into claim escrow and not yet paid out. */
  escrowFunded: bigint;
  /** Stressed close-cost estimate charged to Ballast in cover checks. */
  closeCost: bigint;
  /** Maximum engine valuation age (seconds) a settlement accepts. */
  maxValuationAge: bigint;
  /** Unit queue lengths, for "your place in line" context. */
  ballastQueue: bigint;
  exitQueue: bigint;
};

export type EngineState = {
  simulated: boolean;
  value: bigint;
  /** Timestamp the engine's valuation refers to. */
  observedAt: bigint;
  fundingRateBps: bigint;
};

export type Series = {
  id: bigint;
  state: SeriesState;
  rateBps: bigint;
  termsHash: `0x${string}`;
  subscriptionEnd: bigint;
  activation: bigint;
  maturity: bigint;
  principal: bigint;
  recognizedCoupon: bigint;
  subscriptions: bigint;
  /** The connected wallet's units in this series (0 when not connected). */
  myUnits: bigint;
  /** What the connected wallet can claim from this series right now. */
  myClaimable: bigint;
};

export type DepositRequest = {
  id: bigint;
  owner: `0x${string}`;
  receiver: `0x${string}`;
  tranche: TrancheKind;
  seriesId: bigint;
  deadline: bigint;
  createdAt: bigint;
  status: ReqStatus;
  assets: bigint;
  minOut: bigint;
};

export type ExitRequest = {
  id: bigint;
  owner: `0x${string}`;
  receiver: `0x${string}`;
  requestedAt: bigint;
  status: ExitStatus;
  /** Units still locked and exposed (not yet funded). */
  units: bigint;
  /** dUSD moved to escrow for this exit so far. */
  funded: bigint;
  /** dUSD sitting in escrow for this exit, claimable now. */
  claimable: bigint;
};

export type Wallet = {
  dusd: bigint;
  /** dUSD the custody contract may pull (deposits are pulled by AssetCustody). */
  custodyAllowance: bigint;
  /** Beta allowance set by governance; 0 means not invited. */
  betaAllowance: bigint;
  admitted: bigint;
  reserved: bigint;
  /** BallastToken.balanceOf — ALL units held, including those locked in exits. */
  ballastUnits: bigint;
  /** BallastToken.lockedOf — the part of ballastUnits locked in exit requests (still exposed). */
  ballastLocked: bigint;
  /** ballastUnitValue(ballastUnits): what all held units are worth now. */
  ballastValue: bigint;
  faucetCooldownSec: number;
  faucetRemaining: bigint;
};

export type ChainClock = { number: bigint; timestamp: bigint };

export type BookHistoryRow = {
  blockNumber: string;
  txHash: string;
  logIndex: number;
  event: string;
  args: Record<string, unknown>;
  finalized: boolean;
};

export type BookCheck = { id: string; verdict: "PASS" | "MISMATCH" | "SIMULATED" | "INFO"; summary: string };

/** /v1/book evidence: what the service's independent checker says, with its own envelope. */
export type BookEvidence = {
  status: "LIVE" | "SIMULATED" | "MISMATCH" | "UNAVAILABLE";
  blockNumber: string | null;
  blockHash: string | null;
  checks: BookCheck[];
};

export interface BookProvider {
  clock: Live<ChainClock>;
  book: Live<BookState>;
  engine: Live<EngineState | null>;
  series: Live<Series[]>;
  /** Connected wallet; unavailable (with a reason) when no wallet is connected. */
  wallet: Live<Wallet>;
  myDeposits: Live<DepositRequest[]>;
  myExits: Live<ExitRequest[]>;
  history: Live<BookHistoryRow[]>;
  evidence: Live<BookEvidence>;

  loading: boolean;
  connected: boolean;
  address?: `0x${string}`;
  wrongNetwork: boolean;
  reconnecting: boolean;
  isMock: boolean;
  toasts: Toast[];
  connectors: { id: string; name: string; ready: boolean }[];

  /** Each action resolves true once the transaction is confirmed, false if it failed or was rejected. */
  faucet: () => Promise<boolean>;
  requestDeposit: (args: { tranche: TrancheKind; seriesId: bigint; assets: bigint; minOut: bigint; deadline: bigint }) => Promise<boolean>;
  cancelDeposit: (id: bigint) => Promise<boolean>;
  claimRefund: (id: bigint) => Promise<boolean>;
  requestRedeem: (units: bigint, minAssets: bigint) => Promise<boolean>;
  cancelRedeem: (id: bigint) => Promise<boolean>;
  claimExit: (id: bigint) => Promise<boolean>;
  claimHull: (seriesId: bigint) => Promise<boolean>;

  connect: (connectorId?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  dismissToast: (id: string) => void;
}
