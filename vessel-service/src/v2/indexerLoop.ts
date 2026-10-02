import type { Logger } from "pino";
import type { Address, PublicClient } from "viem";
import type { Sql } from "../auth/sql.ts";
import { envInt } from "../addresses.ts";
import type { Manifest } from "../vendor/verify/read.ts";
import { indexPass, migrateV2Indexer, viemLogSource } from "./indexer.ts";

/** Poll the chain and project v2 controller events into v2_events. */
export async function startV2Indexer(opts: { manifest: Manifest; pc: PublicClient; sql: Sql; log: Logger }) {
  await migrateV2Indexer(opts.sql);
  const m = opts.manifest as Manifest & { deployedBlock?: number };
  const startBlock = BigInt(m.deployedBlock ?? 0);
  const src = viemLogSource(opts.pc, m.chainId, m.contracts.TrancheController as Address);
  const intervalMs = envInt("V2_INDEXER_POLL_MS", 3_000, 250, 600_000);
  let running = true;
  const loop = async () => {
    while (running) {
      try {
        await indexPass(opts.sql, src, { startBlock, chunk: 100n, maxReorgDepth: 64n });
      } catch (err) {
        opts.log.error({ err }, "v2 indexer pass failed");
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  void loop();
  opts.log.info({ startBlock: startBlock.toString() }, "v2 indexer started");
  return {
    stop: () => {
      running = false;
    },
  };
}
