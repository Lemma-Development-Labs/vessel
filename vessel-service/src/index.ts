import pino from "pino";
import { createPublicClient, http } from "viem";
import { startApi } from "./api.ts";
import {
  getChainId,
  getKeeperPk,
  getRpcUrl,
  loadAddresses,
  readManifestSource,
  vesselChain,
} from "./addresses.ts";
import { assertRpcChainIds, loadRuntimeConfig } from "./vendor/vessel-config.ts";
import { initDb } from "./db.ts";
import { initAuth } from "./auth/bootstrap.ts";
import { loadV2Manifest } from "./v2/manifest.ts";
import { startV2Keeper, type V2KeeperHandle } from "./v2/runner.ts";
import { startIndexer } from "./indexer.ts";
import { startKeeper, type KeeperHandle } from "./keeper.ts";

const log = pino({ name: "vessel-service", level: process.env.LOG_LEVEL ?? "info" });

async function main(): Promise<void> {
  const rpcUrl = getRpcUrl();
  const chainId = getChainId();
  const addrs = loadAddresses();

  // Fail closed before serving or signing: explicit environment, matching
  // chain, no placeholder addresses, no sim/mock/lab on mainnet, and every
  // RPC actually on that chain (packages/config, vendored).
  const runtime = loadRuntimeConfig(
    {
      VESSEL_ENV: process.env.VESSEL_ENV,
      VESSEL_CHAIN_ID: String(chainId),
      VESSEL_RPC_URLS: rpcUrl,
      VESSEL_VENUE_PROVIDER: addrs.venue,
      VESSEL_ADMISSION_ENABLED: process.env.VESSEL_ADMISSION_ENABLED,
    },
    JSON.parse(readManifestSource().raw) as unknown,
  );
  await assertRpcChainIds(runtime.rpcUrls, runtime.chainId);
  log.info({ environment: runtime.environment, chainId: runtime.chainId }, "config guards passed");
  const publicClient = createPublicClient({
    chain: vesselChain(rpcUrl, chainId),
    transport: http(rpcUrl),
  });
  const store = await initDb();

  const auth = await initAuth(runtime.environment, runtime.chainId, log);

  const v2Manifest = loadV2Manifest(runtime.chainId, log);
  const v1 = v2Manifest
    ? { manifest: v2Manifest, client: publicClient, sourceLabel: `rpc:${new URL(rpcUrl).host} (finalized block, direct chain read)` }
    : undefined;

  const api = await startApi({
    store,
    publicClient,
    addrs,
    ...(auth ? { auth: auth.deps } : {}),
    ...(v1 ? { v1 } : {}),
  });

  let v2Keeper: V2KeeperHandle | null = null;
  if (v2Manifest) {
    v2Keeper = await startV2Keeper({
      manifest: v2Manifest,
      pc: publicClient,
      chain: vesselChain(rpcUrl, chainId),
      rpcUrl,
      environment: runtime.environment,
      log,
    });
  }

  let keeper: KeeperHandle | undefined;
  let indexer: Awaited<ReturnType<typeof startIndexer>> | undefined;

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    keeper?.stop();
    v2Keeper?.stop();
    indexer?.stop();
    await api.stop();
    await store.close();
    await auth?.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Indexer first: startKeeper() awaits its first crank, which can block for a
  // whole receipt timeout (~2 crank intervals). Starting the keeper first would
  // delay the indexer by that long on every boot that begins with a slow tx.
  indexer = await startIndexer({ store, publicClient, addrs });

  if (getKeeperPk()) {
    keeper = await startKeeper({ publicClient, addrs });
  } else {
    log.warn("KEEPER_PK unset — keeper not started (API + indexer still running)");
  }
}

void main().catch((err) => {
  log.fatal({ err }, "fatal");
  process.exit(1);
});
