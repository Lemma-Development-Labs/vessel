import Fastify from "fastify";
import { parseEther, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import type { Sql } from "../src/auth/sql.ts";
import { evaluateOps, v2HealthRoutes, type OpsInput } from "../src/v2/ops.ts";

const KEEPER = "0x00000000000000000000000000000000000000a1";
const QUOTER = "0x00000000000000000000000000000000000000b1";
const NOW = 1_800_000_000;

const healthy = (): OpsInput => ({
  now: NOW,
  keeper: { address: KEEPER, balanceWei: parseEther("5"), lastActionAt: NOW - 600 },
  quoter: { address: QUOTER, balanceWei: parseEther("4"), lastActionAt: NOW - 300 },
  minKeeperWei: parseEther("2"),
  minQuoterWei: parseEther("1"),
  keeperIdleAfterSec: 3 * 3600,
  quoterIdleAfterSec: 3 * 900,
});

describe("v2 ops health", () => {
  it("is ok with funded, active signers", () => {
    const r = evaluateOps(healthy());
    expect(r.ok).toBe(true);
    expect(r.degraded).toEqual([]);
    expect(r.keeper?.balanceMon).toBe("5");
  });

  it("flags low gas with the address to fund", () => {
    const i = healthy();
    i.keeper!.balanceWei = parseEther("0.58");
    const r = evaluateOps(i);
    expect(r.ok).toBe(false);
    expect(r.degraded[0]).toMatch(/v2 keeper gas low: 0\.58 MON < 2 MON — fund 0x0+a1/);
  });

  it("flags a signer that has stopped acting, but not one that has never acted yet", () => {
    const i = healthy();
    i.quoter!.lastActionAt = NOW - 3 * 900 - 1;
    expect(evaluateOps(i).degraded).toEqual([expect.stringMatching(/kuru quoter idle/)]);
    i.quoter!.lastActionAt = null;
    expect(evaluateOps(i).ok).toBe(true);
  });

  it("an unreadable balance is degraded, never read as zero or fine", () => {
    const i = healthy();
    i.keeper!.balanceWei = null;
    const r = evaluateOps(i);
    expect(r.degraded).toEqual(["v2 keeper balance unreadable"]);
    expect(r.keeper?.balanceMon).toBeNull();
  });

  it("a signer that is not configured is not reported", () => {
    const r = evaluateOps({ ...healthy(), quoter: null });
    expect(r.quoter).toBeNull();
    expect(r.ok).toBe(true);
  });

  it("GET /v2/health answers 503 with the reasons when degraded", async () => {
    const client = { getBalance: async () => parseEther("0.5") } as unknown as PublicClient;
    const sql = { query: async () => [{ at: new Date() }] } as unknown as Sql;
    const app = Fastify();
    await app.register(v2HealthRoutes({ client, sql, keeper: KEEPER, quoter: null }));
    const res = await app.inject({ method: "GET", url: "/v2/health" });
    expect(res.statusCode).toBe(503);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json().degraded[0]).toMatch(/gas low/);
    await app.close();
  });
});
