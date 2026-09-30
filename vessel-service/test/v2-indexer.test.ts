import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pgliteSql, type Sql } from "../src/auth/sql.ts";
import { history, indexPass, migrateV2Indexer, type DecodedLog, type LogSource } from "../src/v2/indexer.ts";

/** Chain whose blocks can be replaced to simulate a reorg. */
class FakeChain implements LogSource {
  chainId = 10143;
  blocks = new Map<bigint, { hash: `0x${string}`; logs: DecodedLog[] }>();
  fin = 0n;
  add(n: bigint, fork: string, events: string[]) {
    const hash = `0x${fork}${n.toString(16).padStart(8, "0")}` as `0x${string}`;
    this.blocks.set(n, {
      hash,
      logs: events.map((e, i) => ({
        blockNumber: n, blockHash: hash, txHash: `0xtx${fork}${n}` as `0x${string}`, logIndex: i,
        address: "0x00000000000000000000000000000000000000c1", event: e, args: { amount: 5n },
      })),
    });
  }
  async head() { return BigInt(Math.max(...[...this.blocks.keys()].map(Number))); }
  async finalized() { return this.fin; }
  async blockHash(n: bigint) { return this.blocks.get(n)?.hash ?? ("0xmissing" as `0x${string}`); }
  async logs(from: bigint, to: bigint) {
    const out: DecodedLog[] = [];
    for (let n = from; n <= to; n++) out.push(...(this.blocks.get(n)?.logs ?? []));
    return out;
  }
}

let sql: Sql;
let chain: FakeChain;
const opts = { startBlock: 100n, chunk: 50n, maxReorgDepth: 20n };

beforeEach(async () => {
  sql = pgliteSql(new PGlite());
  await migrateV2Indexer(sql);
  chain = new FakeChain();
  for (let n = 100n; n <= 110n; n++) chain.add(n, "aa", n === 103n ? ["DepositRequested", "DepositAdmitted"] : n === 108n ? ["EpochSettled"] : []);
});
afterEach(async () => {
  await sql.close();
});

describe("v2 indexer", () => {
  it("dedupe_uses_full_event_identity: two logs in one tx are two rows; re-ingest is idempotent", async () => {
    await indexPass(sql, chain, opts);
    await sql.query("DELETE FROM v2_indexer_cursor"); // force a full re-ingest
    await indexPass(sql, chain, opts);
    const rows = await history(sql, 10143, 50);
    expect(rows.map((r) => r.event)).toEqual(["EpochSettled", "DepositAdmitted", "DepositRequested"]);
    expect(rows[1]!.txHash).toBe(rows[2]!.txHash);
    expect(rows[0]!.args).toEqual({ amount: "5" }); // bigints as strings
  });

  it("reorg_replay: orphaned events are marked REVERTED and the new branch is indexed", async () => {
    await indexPass(sql, chain, opts);
    // Blocks 108–110 are replaced by a fork where the settlement lands in 109 instead.
    for (let n = 108n; n <= 110n; n++) chain.add(n, "bb", n === 109n ? ["EpochSettled"] : []);
    chain.add(111n, "bb", []);
    await indexPass(sql, chain, opts);
    const live = await history(sql, 10143, 50);
    expect(live.filter((r) => r.event === "EpochSettled").map((r) => r.blockNumber)).toEqual(["109"]);
    const [reverted] = await sql.query<{ n: string }>("SELECT count(*)::text AS n FROM v2_events WHERE status = 'REVERTED'");
    expect(reverted?.n).toBe("1");
  });

  it("marks finality and never exceeds the head", async () => {
    chain.fin = 105n;
    const to = await indexPass(sql, chain, opts);
    expect(to).toBe(110n);
    const rows = await history(sql, 10143, 50);
    expect(rows.find((r) => r.event === "DepositRequested")?.finalized).toBe(true);
    expect(rows.find((r) => r.event === "EpochSettled")?.finalized).toBe(false);
    chain.fin = 110n;
    await indexPass(sql, chain, opts);
    expect((await history(sql, 10143, 50)).every((r) => r.finalized)).toBe(true);
  });
});
