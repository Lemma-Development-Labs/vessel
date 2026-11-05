import { parseAbi, type Address, type PublicClient } from "viem";
import { evaluate, overall, ABSOLUTE_LIFETIME_CAP, type Check, type Snapshot } from "./vendor/verify/checks.ts";
import { readSnapshot, type Manifest } from "./vendor/verify/read.ts";

/**
 * Evidence-enveloped reads (spec §12–§13). Every result carries where and when
 * it was read, so an integrator can never mistake an unavailable datum for a
 * zero. Money is decimal strings of base units.
 */

export const SCHEMA_VERSION = 1;

export type Status = "LIVE" | "SIMULATED" | "MISMATCH" | "UNAVAILABLE";

export interface Envelope<T> {
  schemaVersion: number;
  environment: string;
  chainId: number;
  blockNumber: string | null;
  blockHash: string | null;
  observedAt: string;
  source: string;
  units: string | null;
  status: Status;
  /** Present only when status is not UNAVAILABLE. */
  data?: T;
  /** Present only when status is UNAVAILABLE: what is missing and why. */
  reason?: string;
}

const s = (x: bigint) => x.toString();

export function envelope<T>(m: Manifest, snap: Snapshot, status: Exclude<Status, "UNAVAILABLE">, data: T, source: string): Envelope<T> {
  return {
    schemaVersion: SCHEMA_VERSION,
    environment: m.environment,
    chainId: m.chainId,
    blockNumber: s(snap.blockNumber),
    blockHash: snap.blockHash,
    // eslint-disable-next-line no-restricted-syntax -- block timestamp (seconds -> ms), not a money value
    observedAt: new Date(Number(snap.blockTimestamp) * 1000).toISOString(),
    source,
    units: `${snap.asset.symbol}:${snap.asset.decimals}`,
    status,
    data,
  };
}

export function unavailable<T>(m: Manifest, reason: string, source: string): Envelope<T> {
  return {
    schemaVersion: SCHEMA_VERSION,
    environment: m.environment,
    chainId: m.chainId,
    blockNumber: null,
    blockHash: null,
    observedAt: new Date().toISOString(),
    source,
    units: null,
    status: "UNAVAILABLE",
    reason,
  };
}

/** LIVE, or SIMULATED when the engine says so, or MISMATCH when any independent check fails. */
export function statusOf(snap: Snapshot): Exclude<Status, "UNAVAILABLE"> {
  if (overall(evaluate(snap)) === "MISMATCH") return "MISMATCH";
  if (snap.engine.present && snap.engine.simulated) return "SIMULATED";
  return "LIVE";
}

export type BookState = {
  hullNav: string;
  ballastNav: string;
  reserveNav: string;
  treasuryLiability: string;
  recordedActive: string;
  lossCarry: string;
  epoch: string;
  impaired: boolean;
  custody: { pending: string; activeIdle: string };
  escrow: { totalFunded: string };
  engineValue: string | null;
};

export const bookState = (snap: Snapshot): BookState => {
  const c = snap.controller;
  return {
    hullNav: s(c.hullNav),
    ballastNav: s(c.ballastNav),
    reserveNav: s(c.reserveNav),
    treasuryLiability: s(c.treasuryLiability),
    recordedActive: s(c.lastActive),
    lossCarry: s(c.lossCarry),
    epoch: s(c.epoch),
    impaired: c.impaired,
    custody: { pending: s(snap.custody.pending), activeIdle: s(snap.custody.activeIdle) },
    escrow: { totalFunded: s(snap.escrow.totalFunded) },
    engineValue: snap.engine.present ? s(snap.engine.value) : null,
  };
};

export const ballastState = (snap: Snapshot) => ({
  nav: s(snap.controller.ballastNav),
  unitSupply: s(snap.ballastSupply),
  /** B / (H + B) in bps (decimal string); null when there is no capital. */
  coverBps: coverBps(snap),
  coverFloorBps: "2000",
  coverTargetBps: "3000",
});

export const reserveState = (snap: Snapshot) => ({
  nav: s(snap.controller.reserveNav),
  targetBps: "200",
  lossCarry: s(snap.controller.lossCarry),
});

export const capacity = (snap: Snapshot) => {
  const c = snap.controller;
  const used = c.lifetimeAdmitted + c.pendingReserved;
  return {
    stageCap: s(c.stageCap),
    lifetimeAdmitted: s(c.lifetimeAdmitted),
    pendingReserved: s(c.pendingReserved),
    remaining: s(c.stageCap > used ? c.stageCap - used : 0n),
    absoluteCeiling: s(ABSOLUTE_LIFETIME_CAP),
  };
};

export const engineState = (snap: Snapshot) =>
  snap.engine.present
    ? {
        wired: true as const,
        simulated: snap.engine.simulated,
        value: s(snap.engine.value),
        observedAt: s(snap.engine.observedAt),
        fundingRateBps: snap.engine.fundingRateBps === undefined ? null : s(snap.engine.fundingRateBps),
      }
    : { wired: false as const };

export const riskState = (snap: Snapshot) => {
  const c = snap.controller;
  return {
    /** Book impairment only; guardian pause state is not part of this snapshot. */
    impaired: c.impaired,
    coverBps: coverBps(snap),
    capacity: capacity(snap),
    lossCarry: s(c.lossCarry),
    checks: evaluate(snap),
  };
};

function coverBps(snap: Snapshot): string | null {
  const { hullNav: h, ballastNav: b } = snap.controller;
  return h + b === 0n ? null : s((b * 10_000n) / (h + b));
}

export const SERIES_STATES = ["NONE", "SUBSCRIPTION_OPEN", "CANCELLED", "ACTIVE", "MATURED_UNWINDING", "CLAIMABLE", "CLOSED", "IMPAIRED"] as const;

const seriesAbi = parseAbi([
  "function seriesCount() view returns (uint256)",
  "function seriesInfo(uint256) view returns (uint8, uint256, bytes32, uint256, uint256, uint256, uint256, uint256, uint256, uint256)",
]);

export type HullSeries = {
  id: string;
  state: (typeof SERIES_STATES)[number];
  rateBps: string;
  termsHash: string;
  subscriptionEnd: string;
  activation: string;
  maturity: string;
  principal: string;
  recognizedCoupon: string;
  subscriptions: string;
};

/** Hull series at the snapshot's block. `id` omitted → every series. */
export async function readSeries(pc: PublicClient, m: Manifest, blockNumber: bigint, id?: bigint): Promise<HullSeries[]> {
  const C = m.contracts.TrancheController as Address;
  const count = await pc.readContract({ address: C, abi: seriesAbi, functionName: "seriesCount", blockNumber });
  const ids: bigint[] = [];
  if (id !== undefined) {
    if (id >= 1n && id <= count) ids.push(id);
  } else {
    for (let i = 1n; i <= count; i++) ids.push(i);
  }
  const out: HullSeries[] = [];
  for (const sid of ids) {
    const r = await pc.readContract({ address: C, abi: seriesAbi, functionName: "seriesInfo", args: [sid], blockNumber });
    out.push({
      id: s(sid),
      state: SERIES_STATES[r[0]] ?? "NONE",
      rateBps: s(r[1]),
      termsHash: r[2],
      subscriptionEnd: s(r[3]),
      activation: s(r[4]),
      maturity: s(r[5]),
      principal: s(r[6]),
      recognizedCoupon: s(r[7]),
      subscriptions: s(r[9]),
    });
  }
  return out;
}

export type Checked = { overall: "PASS" | "MISMATCH"; checks: Check[] };

/** The independent verifier's checks over one snapshot. */
export const verifyBook = (snap: Snapshot): Checked => {
  const checks = evaluate(snap);
  return { overall: overall(checks), checks };
};

export { readSnapshot };
export type { Manifest, Snapshot, Check };
