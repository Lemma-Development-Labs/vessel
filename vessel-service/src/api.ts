import cors from "@fastify/cors";
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
  getChainId,
  getKeeperPk,
  getPort,
  getRpcUrl,
  loadAddresses,
  vesselChain,
  type VesselAddresses,
} from "./addresses.ts";
import { fundingApr7dBps, type Store } from "./db.ts";
import { getLastSuccessfulCrank } from "./keeper.ts";

const log = pino({ name: "api", level: process.env.LOG_LEVEL ?? "info" });

const CORS_ORIGINS = [
  "https://vessel.wtf",
  "https://testnet.vessel.wtf",
  "https://docs.vessel.wtf",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

function allowOrigin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
  if (!origin) return cb(null, true);
  if (CORS_ORIGINS.includes(origin)) return cb(null, true);
  if (/^https:\/\/([a-z0-9-]+\.)*vercel\.app$/.test(origin)) return cb(null, true);
  return cb(null, false);
}

export type ApiHandle = {
  stop: () => Promise<void>;
};

function clampPct(bps: bigint): number {
  if (bps > 1_000_000n) return 10_000;
  if (bps < -1_000_000n) return -10_000;
  return Number(bps) / 100;
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

  let keeperAddress = opts.keeperAddress;
  if (!keeperAddress) {
    const pk = getKeeperPk();
    if (pk) {
      const { privateKeyToAccount } = await import("viem/accounts");
      keeperAddress = privateKeyToAccount(pk).address;
    }
  }

  const app = Fastify({ loggerInstance: log });

  await app.register(cors, { origin: allowOrigin, methods: ["GET", "HEAD"] });

  app.addHook("onSend", async (req, reply, payload) => {
    if (req.method === "GET") {
      reply.header("Cache-Control", "max-age=3");
    }
    return payload;
  });

  app.get("/health", async () => {
    let lastCrank = getLastSuccessfulCrank() ?? 0;
    let keeperBalance = "0";
    try {
      const onChain = (await client.readContract({
        address: engine,
        abi: engineLiteAbi,
        functionName: "lastCrank",
      })) as bigint;
      if (onChain > 0n) lastCrank = Number(onChain);
    } catch {
      /* liveness: still ok */
    }
    if (keeperAddress) {
      try {
        const bal = await client.getBalance({ address: keeperAddress });
        keeperBalance = formatEther(bal);
      } catch {
        keeperBalance = "0";
      }
    }
    return { ok: true, lastCrank, keeperBalance };
  });

  app.get("/stats", async (_req, reply) => {
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
      const subordinationPct =
        tvl === 0n ? 0 : Number((balTvl * 10_000n) / tvl) / 100;
      const netDeltaBps = bpsRes as bigint;
      const lastCrankTs = Number(lastRes as bigint);
      const genesis = addrs.deployedBlock;
      const blocksSinceGenesis = head >= genesis ? Number(head - genesis) : 0;

      return {
        tvl: tvl.toString(),
        hullTvl: hullTvl.toString(),
        balTvl: balTvl.toString(),
        subordinationPct,
        reserve: reserve.toString(),
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

  app.get("/waterfall", async (req) => {
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
