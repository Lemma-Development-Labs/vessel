import Fastify from "fastify";
import type { PublicClient } from "viem";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { pgliteSql } from "../src/auth/sql.ts";
import { indexPass, migrateV2Indexer, type LogSource } from "../src/v2/indexer.ts";
import { v1Routes, type V1Deps } from "../src/v2/api.ts";
import type { Snapshot } from "../src/vendor/verify/checks.ts";

const manifest = {
  schemaVersion: 1,
  environment: "testnet",
  chainId: 10143,
  contracts: {
    TrancheController: "0x00000000000000000000000000000000000000c1",
    AssetCustody: "0x00000000000000000000000000000000000000c2",
    ClaimEscrow: "0x00000000000000000000000000000000000000c3",
    BallastToken: "0x00000000000000000000000000000000000000c4",
    DemoUSD: "0x00000000000000000000000000000000000000c5",
  },
} as V1Deps["manifest"];

const snap = (): Snapshot => ({
  chainId: 10143,
  blockNumber: 66_956_024n,
  blockHash: "0x65f5ddc9009424eff1d047ffd8607632756342be5aa17f180debb6aebd47fb3f",
  blockTimestamp: 1_790_766_658n,
  asset: { symbol: "dUSD", decimals: 6 },
  controller: {
    hullNav: 80_000_000n, ballastNav: 900_000_000n, reserveNav: 20_000_000n, treasuryLiability: 0n,
    lastActive: 1_000_000_000n, lifetimeAdmitted: 1_000_000_000n, pendingReserved: 0n,
    stageCap: 25_000_000_000n, impaired: false, lossCarry: 0n, epoch: 4n,
  },
  custody: { pending: 0n, activeIdle: 200_000_000n, tokenBalance: 200_000_000n },
  escrow: { totalFunded: 0n, tokenBalance: 0n },
  engine: { present: true, simulated: true, value: 800_000_000n, observedAt: 1_790_766_658n },
  ballastSupply: 900n * 10n ** 18n,
});

const stubClient = (seriesState = 3) =>
  ({
    getBlock: async () => ({ number: 66_956_024n, hash: "0x65f5" }),
    readContract: async ({ functionName }: { functionName: string }) =>
      functionName === "seriesInfo"
        ? [seriesState, 800n, "0x7b51", 1n, 2n, 3n, 80_000_000n, 5n, 6n, 1n]
        : [
            "0x0000000000000000000000000000000000000a11",
            "0x0000000000000000000000000000000000000a11",
            1, 0n, 9n, 8n, 2, 300_000_000n, 0n,
          ],
  }) as unknown as PublicClient;

async function app(read: () => Promise<Snapshot>, client = stubClient()) {
  const a = Fastify();
  await a.register(v1Routes({ manifest, client, read, sourceLabel: "rpc:test (direct chain read)" }));
  await a.ready();
  return a;
}

describe("/v1 evidence API", () => {
  it("serves the book with the evidence envelope, decimal-string money, and SIMULATED status", async () => {
    const a = await app(async () => snap());
    const r = await a.inject({ method: "GET", url: "/v1/book" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({
      schemaVersion: 1,
      environment: "testnet",
      chainId: 10143,
      blockNumber: "66956024",
      blockHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      units: "dUSD:6",
      status: "SIMULATED",
    });
    expect(body.data.hullNav).toBe("80000000");
    expect(typeof body.data.ballastNav).toBe("string");
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("a corrupted book is reported as MISMATCH with the failing check", async () => {
    const bad = snap();
    bad.controller.ballastNav += 1n;
    const body = (await (await app(async () => bad)).inject({ method: "GET", url: "/v1/book" })).json();
    expect(body.status).toBe("MISMATCH");
    expect(body.checks.find((c: { id: string }) => c.id === "book.identity").verdict).toBe("MISMATCH");
  });

  it("no_empty_array_on_failure: a failed read is 503 UNAVAILABLE with a reason and no numbers", async () => {
    const a = await app(async () => {
      throw new Error("TrancheController has no code at finalized block 0\nmore detail");
    });
    const r = await a.inject({ method: "GET", url: "/v1/book" });
    expect(r.statusCode).toBe(503);
    const body = r.json();
    expect(body.status).toBe("UNAVAILABLE");
    expect(body.error).toBe("STALE_DATA");
    expect(body.reason).toBe("TrancheController has no code at finalized block 0");
    expect(body).not.toHaveProperty("data");
  });

  it("serves series and requests with named states; rejects bad ids and unknown series", async () => {
    const a = await app(async () => snap());
    const s = (await a.inject({ method: "GET", url: "/v1/series/1" })).json();
    expect(s.data).toMatchObject({ state: "ACTIVE", rateBps: "800", principal: "80000000" });
    const q = (await a.inject({ method: "GET", url: "/v1/requests/7" })).json();
    expect(q.data).toMatchObject({ tranche: "BALLAST", status: "ADMITTED", assets: "300000000" });
    expect((await a.inject({ method: "GET", url: "/v1/series/abc" })).statusCode).toBe(400);
    const none = await (await app(async () => snap(), stubClient(0))).inject({ method: "GET", url: "/v1/series/9" });
    expect(none.statusCode).toBe(404);
  });

  it("history is UNAVAILABLE (503) when no index is configured or before the first pass", async () => {
    const a = await app(async () => snap());
    const r = await a.inject({ method: "GET", url: "/v1/history" });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ status: "UNAVAILABLE", error: "STALE_DATA" });

    const sql = pgliteSql(new PGlite());
    await migrateV2Indexer(sql);
    const b = Fastify();
    await b.register(v1Routes({ manifest, client: stubClient(), read: async () => snap(), sourceLabel: "x", historySql: sql }));
    const r2 = await b.inject({ method: "GET", url: "/v1/history" });
    expect(r2.statusCode).toBe(503);
    expect(r2.json().reason).toMatch(/not completed a pass/);
    await sql.close();
  });

  it("history serves canonical indexed events at the indexed block", async () => {
    const sql = pgliteSql(new PGlite());
    await migrateV2Indexer(sql);
    const hash = `0x${"ab".repeat(32)}` as `0x${string}`;
    const src: LogSource = {
      chainId: 10143,
      head: async () => 5n,
      finalized: async () => 5n,
      blockHash: async () => hash,
      logs: async () => [
        { blockNumber: 3n, blockHash: hash, txHash: `0x${"cd".repeat(32)}`, logIndex: 0, address: manifest.contracts.TrancheController as `0x${string}`, event: "DepositRequested", args: { assets: 100_000_000n } },
      ],
    };
    await indexPass(sql, src, { startBlock: 1n, chunk: 100n, maxReorgDepth: 64n });
    const a = Fastify();
    await a.register(v1Routes({ manifest, client: stubClient(), read: async () => snap(), sourceLabel: "x", historySql: sql }));
    const r = await a.inject({ method: "GET", url: "/v1/history?limit=10" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({ status: "LIVE", blockNumber: "5", blockHash: hash, chainId: 10143 });
    expect(body.data).toEqual([
      expect.objectContaining({ event: "DepositRequested", blockNumber: "3", finalized: true, args: { assets: "100000000" } }),
    ]);
    expect(r.headers["cache-control"]).toBe("no-store");
    await sql.close();
  });
});
