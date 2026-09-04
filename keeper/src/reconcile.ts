/**
 * After any WS close: reconnect with jitter, re-auth, then re-read fills +
 * positions + on-chain state before acting. Never assume in-flight landed or dropped.
 */
import type { AuthConfig } from "./auth.ts";
import { signedFetch } from "./auth.ts";
import type { Fill, Position } from "./types.ts";

export type Truth = {
  fills: Fill[];
  positions: Position[];
  reconciledAt: number;
};

export async function fetchFills(cfg: AuthConfig, count = 50): Promise<Fill[]> {
  const target = `/v1/trading/fills?count=${count}`;
  const res = await signedFetch(cfg, "GET", target);
  if (res.status === 429) {
    throw new Error("REST 429 on fills — backoff");
  }
  if (!res.ok) {
    throw new Error(`fills HTTP ${res.status}`);
  }
  const body = (await res.json()) as { d?: Fill[] };
  return body.d ?? [];
}

export async function fetchPositionHistory(cfg: AuthConfig, count = 50): Promise<Position[]> {
  const target = `/v1/trading/position-history?count=${count}`;
  const res = await signedFetch(cfg, "GET", target);
  if (res.status === 429) throw new Error("REST 429 on positions — backoff");
  if (!res.ok) throw new Error(`positions HTTP ${res.status}`);
  const body = (await res.json()) as { d?: Position[] };
  return body.d ?? [];
}

/**
 * Merge snapshot fills with any fills that arrived while disconnected.
 * Last-write-wins by oid+timestamp.
 */
export function mergeFills(local: Fill[], remote: Fill[]): Fill[] {
  const map = new Map<string, Fill>();
  for (const f of [...local, ...remote]) {
    const key = `${f.oid}:${f.at?.t ?? 0}:${f.s}`;
    map.set(key, f);
  }
  return [...map.values()].sort((a, b) => (b.at?.t ?? 0) - (a.at?.t ?? 0));
}

/**
 * Rebuild short notional from open positions for a market.
 * Short size is negative; notional uses |s| * mark when `n` absent.
 */
export function shortNotionalFromPositions(
  positions: Position[],
  marketId: number,
  markScaled: number,
  sizeDecimals: number,
): bigint {
  let sizeScaled = 0n;
  for (const p of positions) {
    if (p.mkt !== marketId) continue;
    if (p.s < 0) sizeScaled += BigInt(-p.s);
  }
  if (sizeScaled === 0n) return 0n;
  if (pHasNotional(positions, marketId)) {
    let n = 0n;
    for (const p of positions) {
      if (p.mkt === marketId && p.s < 0 && p.n) n += BigInt(p.n.replace(/^-/, ""));
    }
    if (n > 0n) return n;
  }
  // sizeScaled / 10^dec * markScaled — keep integer: (size * mark) / 10^dec
  const scale = 10n ** BigInt(sizeDecimals);
  return (sizeScaled * BigInt(markScaled)) / scale;
}

function pHasNotional(positions: Position[], marketId: number): boolean {
  return positions.some((p) => p.mkt === marketId && p.n != null);
}

export async function reconcileAfterReconnect(
  cfg: AuthConfig,
  localFills: Fill[],
): Promise<Truth> {
  const [remoteFills, positions] = await Promise.all([
    fetchFills(cfg),
    fetchPositionHistory(cfg),
  ]);
  return {
    fills: mergeFills(localFills, remoteFills),
    positions,
    reconciledAt: Date.now(),
  };
}
