import type { FastifyPluginAsync } from "fastify";
import { formatEther, parseEther, type Address, type PublicClient } from "viem";
import type { Sql } from "../auth/sql.ts";

/**
 * v2 operational health: the keeper's and the quoter's gas, and whether each is still acting.
 * `/health` is the v0 service's readiness check and reports v0 problems on a v2-only deployment;
 * this is the signal for the v2 book. 503 when degraded, so any uptime monitor can alert on it.
 */

export interface SignerState {
  address: string;
  balanceWei: bigint | null;
  /** last CONFIRMED journal action, unix seconds; null if none yet */
  lastActionAt: number | null;
}

export interface OpsInput {
  now: number;
  keeper: SignerState | null;
  quoter: SignerState | null;
  minKeeperWei: bigint;
  minQuoterWei: bigint;
  /** an idle signer is degraded after this long without a confirmed action */
  keeperIdleAfterSec: number;
  quoterIdleAfterSec: number;
}

export interface OpsReport {
  ok: boolean;
  degraded: string[];
  keeper: SignerView | null;
  quoter: SignerView | null;
}

interface SignerView {
  address: string;
  balanceMon: string | null;
  minMon: string;
  lastActionAt: number | null;
  secondsSinceLastAction: number | null;
}

function view(s: SignerState, min: bigint, now: number): SignerView {
  return {
    address: s.address,
    balanceMon: s.balanceWei === null ? null : formatEther(s.balanceWei),
    minMon: formatEther(min),
    lastActionAt: s.lastActionAt,
    secondsSinceLastAction: s.lastActionAt === null ? null : now - s.lastActionAt,
  };
}

export function evaluateOps(i: OpsInput): OpsReport {
  const degraded: string[] = [];
  const check = (name: string, s: SignerState | null, min: bigint, idleAfter: number) => {
    if (!s) return;
    if (s.balanceWei === null) degraded.push(`${name} balance unreadable`);
    else if (s.balanceWei < min) {
      degraded.push(`${name} gas low: ${formatEther(s.balanceWei)} MON < ${formatEther(min)} MON — fund ${s.address}`);
    }
    if (s.lastActionAt !== null && i.now - s.lastActionAt > idleAfter) {
      degraded.push(`${name} idle: no confirmed action for ${i.now - s.lastActionAt}s (limit ${idleAfter}s)`);
    }
  };
  check("v2 keeper", i.keeper, i.minKeeperWei, i.keeperIdleAfterSec);
  check("kuru quoter", i.quoter, i.minQuoterWei, i.quoterIdleAfterSec);
  return {
    ok: degraded.length === 0,
    degraded,
    keeper: i.keeper ? view(i.keeper, i.minKeeperWei, i.now) : null,
    quoter: i.quoter ? view(i.quoter, i.minQuoterWei, i.now) : null,
  };
}

export interface OpsDeps {
  client: PublicClient;
  sql: Sql;
  keeper: Address | null;
  quoter: Address | null;
  minKeeperWei?: bigint;
  minQuoterWei?: bigint;
  keeperIdleAfterSec?: number;
  quoterIdleAfterSec?: number;
}

async function signer(d: OpsDeps, address: Address | null): Promise<SignerState | null> {
  if (!address) return null;
  const [balance, rows] = await Promise.all([
    d.client.getBalance({ address }).catch(() => null),
    d.sql
      .query<{ at: Date | null }>(
        "SELECT max(updated_at) AS at FROM action_journal WHERE lower(account) = lower($1) AND state = 'CONFIRMED'",
        [address],
      )
      .catch(() => [{ at: null }]),
  ]);
  const at = rows[0]?.at;
  return { address, balanceWei: balance, lastActionAt: at ? Math.floor(new Date(at).getTime() / 1000) : null };
}

export async function readOps(d: OpsDeps): Promise<OpsReport> {
  const [keeper, quoter] = await Promise.all([signer(d, d.keeper), signer(d, d.quoter)]);
  return evaluateOps({
    now: Math.floor(Date.now() / 1000),
    keeper,
    quoter,
    minKeeperWei: d.minKeeperWei ?? parseEther("2"),
    minQuoterWei: d.minQuoterWei ?? parseEther("1"),
    // The keeper settles at least every V2_SETTLE_EVERY_SEC (1 h); the quoter refreshes every 15 min.
    keeperIdleAfterSec: d.keeperIdleAfterSec ?? 3 * 3600,
    quoterIdleAfterSec: d.quoterIdleAfterSec ?? 3 * 900,
  });
}

/**
 * GET /v2/health — 200 when healthy, 503 with the reasons otherwise. Not cached by clients, but computed at
 * most once per 5 s (shared by concurrent callers) and rate-limited per IP: each computation reads the chain,
 * and an unlimited flood starved the keeper's RPC budget (review SVC-01).
 */
export function v2HealthRoutes(d: OpsDeps, opts: { cacheMs?: number; rateLimit?: { max: number; timeWindow: number } } = {}): FastifyPluginAsync {
  const cacheMs = opts.cacheMs ?? 5_000;
  let cached: { at: number; r: OpsReport } | null = null;
  let inflight: Promise<OpsReport> | null = null;
  return async (app) => {
    app.get("/v2/health", { config: { rateLimit: opts.rateLimit ?? { max: 60, timeWindow: 60_000 } } }, async (_req, reply) => {
      if (!cached || Date.now() - cached.at > cacheMs) {
        inflight ??= readOps(d).finally(() => {
          inflight = null;
        });
        cached = { at: Date.now(), r: await inflight };
      }
      reply.header("Cache-Control", "no-store");
      return reply.code(cached.r.ok ? 200 : 503).send(cached.r);
    });
  };
}
