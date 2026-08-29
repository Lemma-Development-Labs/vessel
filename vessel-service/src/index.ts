import pino from "pino";
import { createPublicClient, http } from "viem";
import { startApi } from "./api.ts";
import {
  getChainId,
  getKeeperPk,
  getRpcUrl,
  loadAddresses,
  vesselChain,
} from "./addresses.ts";
import { initDb } from "./db.ts";
import { startIndexer } from "./indexer.ts";
import { startKeeper, type KeeperHandle } from "./keeper.ts";

const log = pino({ name: "vessel-service", level: process.env.LOG_LEVEL ?? "info" });

async function main(): Promise<void> {
  const rpcUrl = getRpcUrl();
  const chainId = getChainId();
  const addrs = loadAddresses();
  const publicClient = createPublicClient({
    chain: vesselChain(rpcUrl, chainId),
    transport: http(rpcUrl),
  });
  const store = await initDb();

  const api = await startApi({ store, publicClient, addrs });

  let keeper: KeeperHandle | undefined;
  let indexer: Awaited<ReturnType<typeof startIndexer>> | undefined;

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    keeper?.stop();
    indexer?.stop();
    await api.stop();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  if (getKeeperPk()) {
    keeper = await startKeeper({ publicClient, addrs });
  } else {
    log.warn("KEEPER_PK unset — keeper not started (API + indexer still running)");
  }

  indexer = await startIndexer({ store, publicClient, addrs });
}

void main().catch((err) => {
  log.fatal({ err }, "fatal");
  process.exit(1);
});
