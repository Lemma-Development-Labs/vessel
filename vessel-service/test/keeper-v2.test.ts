import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pgliteSql, type Sql } from "../src/auth/sql.ts";
import { FencedError, acquireLease, migrateJournal, openEntries } from "../src/v2/journal.ts";
import { NotAllowedError, TimeoutError, reconcile, tick, type ChainPort, type KeeperDeps, type Tx } from "../src/v2/keeper.ts";

const ACCOUNT = "0x000000000000000000000000000000000000beef";
const CONTROLLER = "0x00000000000000000000000000000000000c0de1";
const SETTLE = "0x11da60b4"; // settle()

/** Deterministic chain: mines what it accepts, can drop acks, can time out after or before accepting. */
class FakeChain implements ChainPort {
  readonly address = ACCOUNT;
  mined: Tx[] = [];
  pending: Tx[] = [];
  mode: "normal" | "timeout-after-accept" | "timeout-before-accept" | "hold" = "normal";
  async minedNonce() {
    return BigInt(this.mined.length);
  }
  async send(tx: Tx): Promise<string> {
    if (tx.nonce !== BigInt(this.mined.length + this.pending.length) && tx.nonce < BigInt(this.mined.length)) {
      throw new Error("nonce too low");
    }
    if (this.mode === "timeout-before-accept") throw new TimeoutError("rpc timeout");
    if (this.mode === "hold") {
      this.pending.push(tx);
      return this.hash(tx);
    }
    this.mined.push(tx);
    if (this.mode === "timeout-after-accept") throw new TimeoutError("ack lost");
    return this.hash(tx);
  }
  async receipt(hash: string) {
    return this.mined.some((t) => this.hash(t) === hash) ? { status: "success" as const } : null;
  }
  mineHeld() {
    this.mined.push(...this.pending);
    this.pending = [];
  }
  hash(t: Tx) {
    return `0xhash-${t.nonce}-${t.data}`;
  }
}

let sql: Sql;
let clock: Date;
let chain: FakeChain;

const deps = (holderId = "worker-a", c: ChainPort = chain): KeeperDeps => ({
  sql,
  chain: c,
  holderId,
  allow: [{ target: CONTROLLER, selector: SETTLE, action: "settle" }],
  policyVersion: "test-1",
  now: () => clock,
  leaseStaleAfterMs: 60_000,
});

const settlePlan = (id: string) => async () => ({
  clientRequestId: id,
  action: "settle",
  target: CONTROLLER,
  calldata: SETTLE,
  inputs: { reason: "test" },
});

beforeEach(async () => {
  sql = pgliteSql(new PGlite());
  await migrateJournal(sql);
  clock = new Date("2026-10-01T09:00:00Z");
  chain = new FakeChain();
});
afterEach(async () => {
  await sql.close();
});

describe("durable keeper journal", () => {
  it("persists before dispatch and replaying a decision never duplicates it", async () => {
    await tick(deps(), settlePlan("settle:1"));
    await tick(deps(), settlePlan("settle:1")); // same decision again
    expect(chain.mined).toHaveLength(1);
    await reconcile(deps(), 1n);
    const [row] = await sql.query<{ state: string }>("SELECT state FROM action_journal");
    expect(row?.state).toBe("CONFIRMED");
  });

  it("crash after persist, before send: restart sends exactly once", async () => {
    chain.mode = "timeout-before-accept"; // stands in for a crash before anything reached the chain
    await tick(deps(), settlePlan("settle:1"));
    expect(chain.mined).toHaveLength(0);
    chain.mode = "normal";
    await tick(deps(), async () => null); // restart: reconcile resends with the SAME nonce
    await tick(deps(), async () => null);
    expect(chain.mined).toHaveLength(1);
  });

  it("timeout_is_unknown_not_failed: a lost ack is reconciled, not resent", async () => {
    chain.mode = "timeout-after-accept";
    await tick(deps(), settlePlan("settle:1"));
    expect(chain.mined).toHaveLength(1);
    const [row] = await sql.query<{ state: string }>("SELECT state FROM action_journal");
    expect(row?.state).toBe("UNKNOWN");
    chain.mode = "normal";
    await tick(deps(), settlePlan("settle:2")); // nonce consumed → flagged, next action proceeds
    expect(chain.mined).toHaveLength(2);
    expect(chain.mined.map((t) => t.nonce)).toEqual([0n, 1n]);
  });

  it("does not sign new work while a transaction is pending", async () => {
    chain.mode = "hold";
    await tick(deps(), settlePlan("settle:1"));
    const second = await tick(deps(), settlePlan("settle:2"));
    expect(second).toBeNull();
    chain.mineHeld();
    chain.mode = "normal";
    await tick(deps(), settlePlan("settle:2"));
    expect(chain.mined).toHaveLength(2);
  });

  it("two_workers_one_signs and a stale worker is fenced", async () => {
    await tick(deps("worker-a"), settlePlan("settle:1"));
    await expect(tick(deps("worker-b"), settlePlan("settle:2"))).rejects.toBeInstanceOf(FencedError);
    expect(chain.mined).toHaveLength(1);

    clock = new Date(clock.getTime() + 120_000); // worker-a stops heartbeating
    const tokenB = await acquireLease(sql, ACCOUNT, "worker-b", clock, 60_000);
    expect(tokenB).toBe(2n);
    // worker-a wakes up and tries to act with its old view: refused before signing.
    await expect(reconcile({ ...deps("worker-a") }, 1n)).resolves.toBe(true);
    await expect(
      tick({ ...deps("worker-a"), leaseStaleAfterMs: 10 ** 9 }, settlePlan("settle:stale")),
    ).rejects.toBeInstanceOf(FencedError);
    expect(chain.mined).toHaveLength(1);
  });

  it("stale_worker_rejected_by_fencing at the signing guard", async () => {
    chain.mode = "timeout-before-accept"; // worker-a persisted an action that never reached the chain
    await tick(deps("worker-a"), settlePlan("settle:1"));
    expect(chain.mined).toHaveLength(0);
    clock = new Date(clock.getTime() + 120_000);
    await acquireLease(sql, ACCOUNT, "worker-b", clock, 60_000); // takeover → token 2
    chain.mode = "normal";
    // worker-a still believes it holds token 1 and tries to finish its entry.
    await expect(reconcile(deps("worker-a"), 1n)).rejects.toBeInstanceOf(FencedError);
    expect(chain.mined).toHaveLength(0);
    // The current writer finishes it exactly once.
    await reconcile(deps("worker-b"), 2n);
    expect(chain.mined).toHaveLength(1);
  });

  it("refuses anything outside the allowlist", async () => {
    await expect(
      tick(deps(), async () => ({ clientRequestId: "x", action: "drain", target: CONTROLLER, calldata: "0xdeadbeef", inputs: {} })),
    ).rejects.toBeInstanceOf(NotAllowedError);
    expect(chain.mined).toHaveLength(0);
    const open = await openEntries(sql, ACCOUNT);
    expect(open).toHaveLength(0);
  });

  it("a replaced transaction is marked superseded, not confirmed", async () => {
    chain.mode = "hold";
    await tick(deps(), settlePlan("settle:1"));
    chain.pending = [];
    chain.mined.push({ to: CONTROLLER, data: "0xother", nonce: 0n }); // someone replaced nonce 0
    chain.mode = "normal";
    await reconcile(deps(), 1n);
    const [row] = await sql.query<{ state: string }>("SELECT state FROM action_journal");
    expect(row?.state).toBe("SUPERSEDED");
  });
});
