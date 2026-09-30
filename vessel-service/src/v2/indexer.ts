import { decodeEventLog, type Address, type Hex, type PublicClient } from "viem";
import type { Sql } from "../auth/sql.ts";
import { trancheControllerEvents } from "./abi/trancheControllerEvents.ts";

/**
 * v2 event indexer (spec §12). A rebuildable projection of chain events:
 * - identity is (chainId, blockHash, txHash, logIndex) — never the tx hash alone;
 * - on a reorg (the chain's hash at the cursor changed) it walks back to the
 *   common ancestor and marks orphaned rows REVERTED instead of deleting them;
 * - rows at or below the finalized block are flagged finalized.
 * It holds no financial authority: current balances come from chain reads.
 */

export const V2_INDEXER_MIGRATIONS: ReadonlyArray<{ id: string; statements: string[] }> = [
  {
    id: "003_v2_indexer",
    statements: [
      `CREATE TABLE v2_events (
         chain_id      integer NOT NULL,
         block_number  bigint NOT NULL,
         block_hash    text NOT NULL,
         tx_hash       text NOT NULL,
         log_index     integer NOT NULL,
         address       text NOT NULL,
         event         text NOT NULL,
         args          jsonb NOT NULL,
         status        text NOT NULL CHECK (status IN ('CANONICAL','REVERTED')),
         finalized     boolean NOT NULL DEFAULT false,
         PRIMARY KEY (chain_id, block_hash, tx_hash, log_index)
       )`,
      `CREATE INDEX v2_events_block ON v2_events (chain_id, block_number)`,
      `CREATE TABLE v2_indexer_cursor (
         chain_id      integer PRIMARY KEY,
         block_number  bigint NOT NULL,
         block_hash    text NOT NULL
       )`,
    ],
  },
];

export interface DecodedLog {
  blockNumber: bigint;
  blockHash: Hex;
  txHash: Hex;
  logIndex: number;
  address: Address;
  event: string;
  args: Record<string, unknown>;
}

export interface LogSource {
  chainId: number;
  head(): Promise<bigint>;
  finalized(): Promise<bigint>;
  blockHash(n: bigint): Promise<Hex>;
  logs(from: bigint, to: bigint): Promise<DecodedLog[]>;
}

export async function migrateV2Indexer(sql: Sql): Promise<void> {
  await sql.query(`CREATE TABLE IF NOT EXISTS auth_schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await sql.query<{ id: string }>("SELECT id FROM auth_schema_migrations")).map((r) => r.id));
  for (const m of V2_INDEXER_MIGRATIONS) {
    if (done.has(m.id)) continue;
    await sql.transaction(async (q) => {
      for (const s of m.statements) await q.query(s);
      await q.query("INSERT INTO auth_schema_migrations (id) VALUES ($1)", [m.id]);
    });
  }
}

const jsonArgs = (a: Record<string, unknown>) =>
  JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

/**
 * One indexing pass. Returns the new cursor block. `startBlock` is the
 * deployment block from the release manifest; `maxReorgDepth` bounds the
 * walk back to a common ancestor.
 */
export async function indexPass(
  sql: Sql,
  src: LogSource,
  opts: { startBlock: bigint; chunk: bigint; maxReorgDepth: bigint },
): Promise<bigint> {
  const [cur] = await sql.query<{ block_number: string; block_hash: string }>(
    "SELECT block_number, block_hash FROM v2_indexer_cursor WHERE chain_id = $1",
    [src.chainId],
  );
  let cursor = cur ? BigInt(cur.block_number) : opts.startBlock - 1n;

  // Reorg detection: the block we last indexed must still have the hash we saw. If it
  // changed, rewind to max(cursor − maxReorgDepth, finalized) and mark everything above
  // REVERTED; the re-scan restores rows whose block hash did not change (same identity),
  // and truly orphaned rows stay REVERTED. Finalized rows are never touched.
  const finAtStart = await src.finalized();
  if (cur && (await src.blockHash(cursor)) !== cur.block_hash) {
    let rewind = cursor - opts.maxReorgDepth;
    if (rewind < finAtStart) rewind = finAtStart;
    if (rewind < opts.startBlock - 1n) rewind = opts.startBlock - 1n;
    await sql.query(
      "UPDATE v2_events SET status = 'REVERTED' WHERE chain_id = $1 AND block_number > $2 AND status = 'CANONICAL' AND NOT finalized",
      [src.chainId, rewind.toString()],
    );
    cursor = rewind;
  }

  const head = await src.head();
  if (head <= cursor) {
    await sql.query("UPDATE v2_events SET finalized = true WHERE chain_id = $1 AND block_number <= $2 AND NOT finalized AND status = 'CANONICAL'", [src.chainId, finAtStart.toString()]);
    return cursor;
  }
  const to = head < cursor + opts.chunk ? head : cursor + opts.chunk;
  const logs = await src.logs(cursor + 1n, to);
  const toHash = await src.blockHash(to);
  const fin = await src.finalized();
  await sql.transaction(async (q) => {
    for (const l of logs) {
      await q.query(
        `INSERT INTO v2_events (chain_id, block_number, block_hash, tx_hash, log_index, address, event, args, status, finalized)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CANONICAL',$9)
         ON CONFLICT (chain_id, block_hash, tx_hash, log_index) DO UPDATE SET status = 'CANONICAL'`,
        [src.chainId, l.blockNumber.toString(), l.blockHash, l.txHash, l.logIndex, l.address.toLowerCase(), l.event, jsonArgs(l.args), l.blockNumber <= fin],
      );
    }
    await q.query("UPDATE v2_events SET finalized = true WHERE chain_id = $1 AND block_number <= $2 AND NOT finalized AND status = 'CANONICAL'", [src.chainId, fin.toString()]);
    await q.query(
      `INSERT INTO v2_indexer_cursor (chain_id, block_number, block_hash) VALUES ($1,$2,$3)
       ON CONFLICT (chain_id) DO UPDATE SET block_number = EXCLUDED.block_number, block_hash = EXCLUDED.block_hash`,
      [src.chainId, to.toString(), toHash],
    );
  });
  return to;
}

export interface HistoryRow {
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  event: string;
  args: Record<string, unknown>;
  finalized: boolean;
}

export async function history(sql: Sql, chainId: number, limit: number): Promise<HistoryRow[]> {
  const rows = await sql.query<{
    block_number: string; block_hash: string; tx_hash: string; log_index: number; event: string; args: Record<string, unknown>; finalized: boolean;
  }>(
    `SELECT block_number, block_hash, tx_hash, log_index, event, args, finalized FROM v2_events
     WHERE chain_id = $1 AND status = 'CANONICAL' ORDER BY block_number DESC, log_index DESC LIMIT $2`,
    [chainId, limit],
  );
  return rows.map((r) => ({
    blockNumber: String(r.block_number),
    blockHash: r.block_hash,
    txHash: r.tx_hash,
    logIndex: r.log_index,
    event: r.event,
    args: r.args,
    finalized: r.finalized,
  }));
}

/** LogSource over a viem client for the controller's events. */
export function viemLogSource(pc: PublicClient, chainId: number, controller: Address): LogSource {
  return {
    chainId,
    head: () => pc.getBlockNumber(),
    finalized: async () => (await pc.getBlock({ blockTag: "finalized" })).number!,
    blockHash: async (n) => (await pc.getBlock({ blockNumber: n })).hash!,
    async logs(from, to) {
      const raw = await pc.getLogs({ address: controller, fromBlock: from, toBlock: to });
      const out: DecodedLog[] = [];
      for (const l of raw) {
        try {
          const d = decodeEventLog({ abi: trancheControllerEvents, data: l.data, topics: l.topics });
          out.push({
            blockNumber: l.blockNumber!,
            blockHash: l.blockHash!,
            txHash: l.transactionHash!,
            logIndex: l.logIndex!,
            address: l.address,
            event: d.eventName,
            args: d.args as unknown as Record<string, unknown>,
          });
        } catch {
          // Not a controller event (e.g. a library log); ignored.
        }
      }
      return out;
    },
  };
}
