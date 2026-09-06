/**
 * After any WS close: reconnect with jitter, re-auth, then re-read fills +
 * positions before acting. Never assume an in-flight order landed or dropped.
 *
 * Fee gotcha (api-docs README): on Order(mt:24)/Fill(mt:25), `f` is **gross**
 * and already includes builder portion `bfa`. Never add them.
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
  if (res.status === 429) throw new Error("REST 429 on fills — backoff");
  if (!res.ok) throw new Error(`fills HTTP ${res.status}`);
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

/** Merge local + remote fills. Last-write-wins by oid+timestamp+size. */
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
  const withN = positions.filter((p) => p.mkt === marketId && p.s < 0 && p.n);
  if (withN.length) {
    let n = 0n;
    for (const p of withN) n += BigInt(p.n!.replace(/^-/, ""));
    if (n > 0n) return n;
  }
  const scale = 10n ** BigInt(sizeDecimals);
  return (sizeScaled * BigInt(markScaled)) / scale;
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
