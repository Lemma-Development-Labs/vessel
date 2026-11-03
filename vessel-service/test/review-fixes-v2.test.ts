import { PGlite } from "@electric-sql/pglite";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { decodeFunctionData, parseEther, toFunctionSelector, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { pgliteSql, type Sql } from "../src/auth/sql.ts";
import { acquireLease, markState, migrateJournal, persistAction } from "../src/v2/journal.ts";
import { v2HealthRoutes } from "../src/v2/ops.ts";
import { controllerWriteAbi, decide, engineCashNeed, type Observed, type PolicyConfig } from "../src/v2/policy.ts";
import { gasCapFor } from "../src/v2/runner.ts";

/** Regression tests for the 25 Oct review's keeper findings (E2E-01, E2E-02, E2E-03, SVC-01). */
const C = "0x00000000000000000000000000000000000000c1" as const;
const cfg: PolicyConfig = { settleEverySec: 3600n, batchSize: 10n, idleTargetBps: 1_500n, minMove: 1_000_000n };
const base = (): Observed => ({
  now: 1_800_000_000n,
  pendingBallastDeposits: 0n,
  pendingExits: 0n,
  headExitReadyAt: 0n,
  activeSeries: 0n,
  seriesState: 0,
  subscriptionEnd: 0n,
  maturity: 0n,
  hullNav: 0n,
  impaired: false,
  activeIdle: 150_000_000n,
  engineValue: 850_000_000n,
  treasuryLiability: 0n,
  engineWired: true,
  lastSettleAt: 1_800_000_000n,
});
const fn = (o: Observed) => {
  const p = decide(o, cfg, C);
  return p ? decodeFunctionData({ abi: controllerWriteAbi, data: p.calldata as `0x${string}` }) : null;
};

describe("E2E-01: exits bigger than idle cash get funded", () => {
  // the run that found it: idle at 0, a cooled 400 USDC exit, the rest of the book in the engine
  const waiting = (): Observed => ({ ...base(), activeIdle: 0n, engineValue: 1_000_000_000n, pendingExits: 1n, headExitReadyAt: 1_799_000_000n, readyExitDemand: 400_000_000n });

  it("doesn't plan a no-op exit batch with nothing liquid; recalls the target plus the exits' value instead", () => {
    const r = fn(waiting());
    expect(r?.functionName).toBe("recallFromEngine");
    expect(r?.args?.[0]).toBe(150_000_000n + 400_000_000n); // 15% idle target + what the exits wait for
  });

  it("a hedged engine short of cash reports the shortfall the hedge policy must unwind", () => {
    const o = { ...waiting(), engineCash: 100_000_000n };
    expect(engineCashNeed(o, cfg)).toEqual({ need: 550_000_000n, available: 100_000_000n });
    expect(fn(o)?.args?.[0]).toBe(100_000_000n); // recalls what is cash now; runner hands 450 to the hedge
  });

  it("once the cash is there, the exit batch runs", () => {
    expect(fn({ ...waiting(), activeIdle: 600_000_000n })?.functionName).toBe("processExitBatch");
  });
});

describe("E2E-03: a refused action can't stall the policy", () => {
  it("activation over its cap is skipped for 30 min; deposits behind it still run", () => {
    const o = { ...base(), activeSeries: 1n, seriesState: 1, subscriptionEnd: 1_799_999_999n, pendingBallastDeposits: 3n };
    expect(fn(o)?.functionName).toBe("activateSeries");
    expect(fn({ ...o, recentlyRejected: ["activateSeries"] })?.functionName).toBe("processDepositBatch");
  });

  it("gas caps are per action: a full series activation (~2.2M with margin) fits", () => {
    expect(gasCapFor(toFunctionSelector("activateSeries(uint256)") + "00".repeat(32))).toBe(6_000_000n);
    expect(gasCapFor(toFunctionSelector("processExitBatch(uint256)"))).toBe(3_000_000n);
    expect(gasCapFor(toFunctionSelector("settle()"))).toBe(2_000_000n);
  });
});

describe("E2E-02: a revert reason with NUL bytes can't wedge the journal", () => {
  it("stores the state change (and a cleaned reason) instead of throwing", async () => {
    const sql: Sql = pgliteSql(new PGlite());
    await migrateJournal(sql);
    const account = "0x00000000000000000000000000000000000000a1";
    const token = await acquireLease(sql, account, "worker-1", new Date("2026-11-03T09:00:00Z"), 300_000);
    const e = await persistAction(sql, {
      clientRequestId: "deposits:1",
      account,
      token,
      policyVersion: "test",
      action: "processDepositBatch",
      target: C,
      calldata: "0x",
      plannedNonce: 0n,
      inputs: { note: "a\u0000b" },
    });
    await markState(sql, e.id, "REJECTED", { result: { reason: "execution reverted: \u0000\u0001Paused\u0000" } });
    const [row] = await sql.query<{ state: string; result: { reason: string }; inputs: { note: string } }>("SELECT state, result, inputs FROM action_journal WHERE id = $1", [e.id]);
    expect(row!.state).toBe("REJECTED");
    expect(row!.result.reason).toBe("execution reverted: Paused");
    expect(row!.inputs.note).toBe("ab");
    await sql.close();
  });
});

describe("SVC-01: a health-check flood can't reach the keeper's RPC", () => {
  const KEEPER = "0x00000000000000000000000000000000000000b1";

  it("/v2/health computes at most once per window, whatever the request rate", async () => {
    let reads = 0;
    const client = { getBalance: async () => (reads++, parseEther("5")) } as unknown as PublicClient;
    const sql = { query: async () => [{ at: new Date() }] } as unknown as Sql;
    const app = Fastify();
    await app.register(rateLimit, { global: false });
    await app.register(v2HealthRoutes({ client, sql, keeper: KEEPER, quoter: null }, { rateLimit: { max: 1_000, timeWindow: 60_000 } }));
    await Promise.all(Array.from({ length: 40 }, () => app.inject({ method: "GET", url: "/v2/health" })));
    expect(reads).toBe(1); // concurrent callers share one computation
    for (let i = 0; i < 20; i++) await app.inject({ method: "GET", url: "/v2/health" });
    expect(reads).toBe(1); // and one after another, the 5 s snapshot answers them
    await app.close();
  });

  it("/v2/health is rate-limited per IP", async () => {
    const client = { getBalance: async () => parseEther("5") } as unknown as PublicClient;
    const sql = { query: async () => [{ at: new Date() }] } as unknown as Sql;
    const app = Fastify();
    await app.register(rateLimit, { global: false });
    await app.register(v2HealthRoutes({ client, sql, keeper: KEEPER, quoter: null }, { rateLimit: { max: 3, timeWindow: 60_000 } }));
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await app.inject({ method: "GET", url: "/v2/health" })).statusCode);
    expect(codes.slice(0, 3).every((c) => c !== 429)).toBe(true);
    expect(codes[3]).toBe(429);
    await app.close();
  });
});
