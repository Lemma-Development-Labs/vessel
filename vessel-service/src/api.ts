import { readFileSync } from "node:fs";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import pino from "pino";
import {
  createPublicClient,
  formatEther,
  http,
  type PublicClient,
} from "viem";
import { engineLiteAbi, tranchesAbi } from "./abis.ts";
import {
  getAllowedOrigins,
  getChainId,
  getCrankIntervalSec,
  getKeeperPk,
  getMaxCrankIntervals,
  getMaxIndexerLagBlocks,
  getPort,
  getRateLimitMax,
  getRateLimitWindowSec,
  getRpcUrl,
  loadAddresses,
  vesselChain,
  type VesselAddresses,
} from "./addresses.ts";
import { fundingApr7dBps, type Store } from "./db.ts";
import { getIndexerStatus } from "./indexer.ts";
import { getKeeperStatus, getLastSuccessfulCrank } from "./keeper.ts";

const log = pino({ name: "api", level: process.env.LOG_LEVEL ?? "info" });

export type ApiHandle = {
  stop: () => Promise<void>;
};

function clampPct(bps: bigint): number {
  if (bps > 1_000_000n) return 10_000;
  if (bps < -1_000_000n) return -10_000;
  return Number(bps) / 100;
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0] ?? err.message;
  return String(err);
}

/** package.json version, or null. Never a made-up string. */
function readVersion(): string | null {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export async function startApi(opts: {
  store: Store;
  publicClient?: PublicClient;
  addrs?: VesselAddresses;
  keeperAddress?: `0x${string}`;
}): Promise<ApiHandle> {
  const rpcUrl = getRpcUrl();
  const chainId = getChainId();
  const addrs = opts.addrs ?? loadAddresses();
  const client =
    opts.publicClient ??
    createPublicClient({
      chain: vesselChain(rpcUrl, chainId),
      transport: http(rpcUrl),
    });
  const engine = addrs.contracts.EngineLite;
  const tranches = addrs.contracts.Tranches;
  const port = getPort();

  const allowedOrigins = getAllowedOrigins();
  const rlMax = getRateLimitMax();
  const rlWindowSec = getRateLimitWindowSec();
  const intervalSec = getCrankIntervalSec();
  const maxCrankIntervals = getMaxCrankIntervals();
  const maxLagBlocks = getMaxIndexerLagBlocks();
  const staleCrankAfterSec = intervalSec * maxCrankIntervals;
  const version = readVersion();
  const startedAt = Math.floor(Date.now() / 1000);

  let keeperAddress = opts.keeperAddress;
  if (!keeperAddress) {
    const pk = getKeeperPk();
    if (pk) {
      const { privateKeyToAccount } = await import("viem/accounts");
      keeperAddress = privateKeyToAccount(pk).address;
    }
  }

  const app = Fastify({ loggerInstance: log });

  /**
   * Exact-match allowlist only. The previous regex allowed
   * https://<anything>.vercel.app, i.e. any Vercel deployment on the internet
   * could read this API with credentials from a user's browser.
   */
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl / server-to-server
      return cb(null, allowedOrigins.includes(origin));
    },
    methods: ["GET", "HEAD"],
  });

  // global:false — only routes that opt in via config.rateLimit are limited,
  // so /health stays available to the platform healthcheck under load.
  await app.register(rateLimit, {
    global: false,
    max: rlMax,
    timeWindow: rlWindowSec * 1000,
  });
  const rateLimitConfig = {
    config: { rateLimit: { max: rlMax, timeWindow: rlWindowSec * 1000 } },
  };

  log.info(
    { allowedOrigins, rateLimitMax: rlMax, rateLimitWindowSec: rlWindowSec },
    "cors allowlist + rate limit configured",
  );

  app.addHook("onSend", async (req, reply, payload) => {
    if (req.method === "GET") {
      // /health must never be cached — a platform healthcheck reading a stale
      // ok:true would defeat the point of the endpoint.
      reply.header("Cache-Control", req.url.startsWith("/health") ? "no-store" : "max-age=3");
    }
    return payload;
  });

  app.get("/health", async (_req, reply) => {
    const now = Math.floor(Date.now() / 1000);
    const errors: Record<string, string> = {};
    const degraded: string[] = [];

    const [blockRes, lastCrankRes, bpsRes, balRes] = await Promise.allSettled([
      client.getBlockNumber(),
      client.readContract({ address: engine, abi: engineLiteAbi, functionName: "lastCrank" }),
      client.readContract({ address: engine, abi: engineLiteAbi, functionName: "netDeltaBps" }),
      keeperAddress
        ? client.getBalance({ address: keeperAddress })
        : Promise.reject(new Error("KEEPER_PK unset — no keeper address")),
    ]);

    // ---- RPC reachability -------------------------------------------------
    const rpcOk = blockRes.status === "fulfilled";
    const blockNumber = blockRes.status === "fulfilled" ? blockRes.value.toString() : null;
    if (!rpcOk) {
      errors.blockNumber = errMsg(blockRes.reason);
      degraded.push(`rpc unreachable: ${errors.blockNumber}`);
    }

    // ---- last crank (on-chain truth, then the keeper's own record) ---------
    let chainLastCrank: number | null = null;
    if (lastCrankRes.status === "fulfilled") {
      const v = lastCrankRes.value as bigint;
      chainLastCrank = v > 0n ? Number(v) : null; // 0 means "never", not "epoch"
    } else {
      errors.lastCrank = errMsg(lastCrankRes.reason);
    }
    const keeperLastCrank = getLastSuccessfulCrank();
    const lastCrankTs =
      chainLastCrank === null && keeperLastCrank === null
        ? null
        : Math.max(chainLastCrank ?? 0, keeperLastCrank ?? 0);
    const secondsSinceLastCrank = lastCrankTs === null ? null : now - lastCrankTs;

    if (lastCrankTs === null) {
      if (lastCrankRes.status === "fulfilled") {
        degraded.push("no crank has ever been observed");
      }
    } else if (secondsSinceLastCrank !== null && secondsSinceLastCrank > staleCrankAfterSec) {
      degraded.push(
        `no crank for ${secondsSinceLastCrank}s (limit ${staleCrankAfterSec}s = ${maxCrankIntervals} x CRANK_INTERVAL_SEC)`,
      );
    }

    // ---- netDeltaBps ------------------------------------------------------
    let netDeltaBps: string | null = null;
    let netDeltaPct: number | null = null;
    if (bpsRes.status === "fulfilled") {
      const v = bpsRes.value as bigint;
      netDeltaBps = v.toString();
      netDeltaPct = clampPct(v);
    } else {
      errors.netDeltaBps = errMsg(bpsRes.reason);
    }

    // ---- keeper -----------------------------------------------------------
    const ks = getKeeperStatus();
    let keeperBalanceMon: string | null = null;
    let keeperBalanceWei: string | null = null;
    if (balRes.status === "fulfilled") {
      keeperBalanceWei = balRes.value.toString();
      keeperBalanceMon = formatEther(balRes.value);
    } else {
      // Never 0 here. An unreadable balance is unknown, not empty.
      errors.keeperBalance = errMsg(balRes.reason);
    }
    if (!ks.configured) {
      degraded.push("keeper not configured (KEEPER_PK unset) — nothing is cranking");
    } else if (
      ks.cranksRemaining !== null &&
      ks.cranksRemaining < ks.minCranksRunway
    ) {
      degraded.push(
        `keeper gas runway ${ks.cranksRemaining} cranks < MIN_CRANKS_RUNWAY ${ks.minCranksRunway}`,
      );
    }
    if (ks.stuckTxHash) degraded.push(`keeper has a stuck crank tx ${ks.stuckTxHash}`);

    // ---- indexer ----------------------------------------------------------
    const ix = getIndexerStatus();
    if (!ix.started) {
      degraded.push("indexer not running");
    } else if (ix.lagBlocks === null) {
      degraded.push("indexer has not completed a pass yet");
    } else if (ix.lagBlocks > maxLagBlocks) {
      degraded.push(
        `indexer lag ${ix.lagBlocks} blocks > HEALTH_MAX_INDEXER_LAG_BLOCKS ${maxLagBlocks}`,
      );
    }
    if (ix.lastError) {
      errors.indexer = ix.lastError;
      degraded.push(`indexer error: ${ix.lastError}`);
    }

    const ok = degraded.length === 0;
    const body = {
      ok,
      degraded,
      service: {
        version,
        startedAt,
        uptimeSec: now - startedAt,
        db: opts.store.kind,
        chainId,
        venue: addrs.venue,
      },
      rpc: { ok: rpcOk, blockNumber },
      keeper: {
        configured: ks.configured,
        running: ks.running,
        address: keeperAddress ?? null,
        balanceWei: keeperBalanceWei,
        balanceMon: keeperBalanceMon,
        gasLimit: ks.gasLimit,
        gasPriceWei: ks.gasPriceWei,
        gasPriceGwei: ks.gasPriceGwei,
        costPerCrankMon: ks.costPerCrankMon,
        cranksRemaining: ks.cranksRemaining,
        // 0 here would read as "the threshold is zero"; unconfigured means unknown.
        minCranksRunway: ks.configured ? ks.minCranksRunway : null,
        runwayComputedAt: ks.lastRunwayAt,
        stuckTxHash: ks.stuckTxHash,
        lastError: ks.lastError,
      },
      indexer: {
        running: ix.started,
        confirmations: ix.confirmations,
        cursor: ix.cursor,
        safeHead: ix.safeHead,
        head: ix.head,
        lagBlocks: ix.lagBlocks,
        maxLagBlocks,
        lastPassAt: ix.lastPassAt,
        lastError: ix.lastError,
      },
      protocol: {
        lastCrankTs,
        secondsSinceLastCrank,
        staleCrankAfterSec,
        netDeltaBps,
        netDeltaPct,
      },
      errors: Object.keys(errors).length === 0 ? null : errors,
    };

    // 503 so a platform healthcheck actually restarts a wedged process.
    return reply.code(ok ? 200 : 503).send(body);
  });

  app.get("/stats", rateLimitConfig, async (_req, reply) => {
    try {
      const [deckRes, bpsRes, lastRes, head] = await Promise.all([
        client.readContract({
          address: tranches,
          abi: tranchesAbi,
          functionName: "deckStats",
        }),
        client.readContract({
          address: engine,
          abi: engineLiteAbi,
          functionName: "netDeltaBps",
        }),
        client.readContract({
          address: engine,
          abi: engineLiteAbi,
          functionName: "lastCrank",
        }),
        client.getBlockNumber(),
      ]);

      const hullTvl = deckRes[0];
      const balTvl = deckRes[1];
      const reserve = deckRes[2];
      const tvl = hullTvl + balTvl;
      // Undefined at zero TVL — 0% subordination would read as "Hull is
      // completely unprotected", which is a different claim from "no deck".
      const subordinationPct =
        tvl === 0n ? null : Number((balTvl * 10_000n) / tvl) / 100;
      const netDeltaBps = bpsRes as bigint;
      const rawLastCrank = lastRes as bigint;
      // 0 means the engine has never been cranked, not 1970-01-01.
      const lastCrankTs = rawLastCrank > 0n ? Number(rawLastCrank) : null;
      const genesis = addrs.deployedBlock;
      // head < deployedBlock means the RPC is behind or pointed at the wrong
      // chain — that is unknown, not "0 blocks since genesis".
      const blocksSinceGenesis = head >= genesis ? Number(head - genesis) : null;

      return {
        tvl: tvl.toString(),
        hullTvl: hullTvl.toString(),
        balTvl: balTvl.toString(),
        subordinationPct,
        reserve: reserve.toString(),
        netDeltaBps: netDeltaBps.toString(),
        netDeltaPct: clampPct(netDeltaBps),
        fundingApr7dBps: await fundingApr7dBps(opts.store),
        lastCrankTs,
        blocksSinceGenesis,
        venue: addrs.venue,
      };
    } catch (err) {
      log.error({ err }, "stats failed");
      return reply.code(503).send({ error: "upstream unavailable" });
    }
  });

  app.get("/waterfall", rateLimitConfig, async (req) => {
    const q = req.query as { limit?: string };
    const parsed = Number(q.limit ?? 50);
    const limit = Number.isFinite(parsed)
      ? Math.min(500, Math.max(1, Math.floor(parsed)))
      : 50;
    return opts.store.listWaterfall(limit);
  });

  await app.listen({ host: "0.0.0.0", port });
  log.info({ host: "0.0.0.0", port }, "api listening");

  return {
    stop: async () => {
      await app.close();
    },
  };
}
