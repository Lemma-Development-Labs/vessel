import type { Sql } from "../auth/sql.ts";
import {
  FencedError,
  acquireLease,
  assertCurrentToken,
  markState,
  openEntries,
  persistAction,
  type JournalEntry,
} from "./journal.ts";

/**
 * v2 keeper: decide → persist → sign (guarded) → dispatch → reconcile.
 *
 * The chain is reached through `ChainPort`, so the same runner drives the
 * real viem client and deterministic tests. Transactions carry the nonce
 * planned at persist time, so one journal entry can produce at most one
 * mined transaction however often it is retried.
 */

export class TimeoutError extends Error {
  override name = "TimeoutError";
}

export interface Tx {
  to: string;
  data: string;
  nonce: bigint;
}

export interface ChainPort {
  /** the keeper's own address */
  readonly address: string;
  /** transactions mined from this address (the next nonce the chain expects) */
  minedNonce(): Promise<bigint>;
  /** Submit a signed tx. Resolves with the hash; throws TimeoutError when the outcome is unknown. */
  send(tx: Tx): Promise<string>;
  /** null while unknown/pending */
  receipt(hash: string): Promise<{ status: "success" | "reverted" } | null>;
}

/** One allowed operation: target contract + 4-byte selector. Anything else is refused. */
export interface Allowed {
  target: string;
  selector: string;
  action: string;
}

export class NotAllowedError extends Error {
  override name = "NotAllowedError";
}

/**
 * Signing guard (the in-process half of the signing broker, spec §11): checks
 * the allowlist and the CURRENT fencing token immediately before sending.
 * Network isolation of the signer is Session 7 work.
 */
export async function guardedSend(
  sql: Sql,
  chain: ChainPort,
  allow: readonly Allowed[],
  token: bigint,
  entry: JournalEntry,
): Promise<string> {
  const ok = allow.some(
    (a) => a.target.toLowerCase() === entry.target.toLowerCase() && entry.calldata.toLowerCase().startsWith(a.selector.toLowerCase()),
  );
  if (!ok) throw new NotAllowedError(`${entry.action} to ${entry.target} is not allowlisted`);
  await assertCurrentToken(sql, chain.address, token);
  return chain.send({ to: entry.target, data: entry.calldata, nonce: BigInt(entry.planned_nonce) });
}

export interface KeeperDeps {
  sql: Sql;
  chain: ChainPort;
  holderId: string;
  allow: readonly Allowed[];
  policyVersion: string;
  now: () => Date;
  leaseStaleAfterMs: number;
}

/**
 * Reconcile every open entry against the chain before anything new is signed.
 * Returns true when nothing is left in flight.
 */
export async function reconcile(d: KeeperDeps, token: bigint): Promise<boolean> {
  const mined = await d.chain.minedNonce();
  let clear = true;
  for (const e of await openEntries(d.sql, d.chain.address)) {
    const nonce = BigInt(e.planned_nonce);
    if (e.tx_hash) {
      const r = await d.chain.receipt(e.tx_hash);
      if (r) {
        await markState(d.sql, e.id, r.status === "success" ? "CONFIRMED" : "REVERTED");
        continue;
      }
      if (mined > nonce) {
        // The nonce was consumed by a different transaction (replacement).
        await markState(d.sql, e.id, "SUPERSEDED");
        continue;
      }
      clear = false; // still pending: wait, never resend over it
      continue;
    }
    if (mined > nonce) {
      // Sent before a crash/timeout but the hash was never recorded. The nonce is
      // spent, so it cannot be sent again; flag for inspection instead of guessing.
      await markState(d.sql, e.id, "UNKNOWN", { result: { reason: "nonce consumed, hash unknown" } });
      continue;
    }
    // Persisted but never mined: (re)send with the SAME nonce — at most one can land.
    try {
      const hash = await guardedSend(d.sql, d.chain, d.allow, token, e);
      await markState(d.sql, e.id, "DISPATCHED", { txHash: hash });
    } catch (err) {
      if (err instanceof TimeoutError) await markState(d.sql, e.id, "UNKNOWN");
      else throw err;
    }
    clear = false;
  }
  return clear;
}

export interface PlannedAction {
  /** stable id for this decision, e.g. "settle:epoch-42" — reusing it never duplicates work */
  clientRequestId: string;
  action: string;
  target: string;
  calldata: string;
  inputs: object;
}

/**
 * One keeper tick: take/renew the lease, reconcile, then persist-and-dispatch
 * at most one new action (the caller decides which, from fresh chain state).
 */
export async function tick(d: KeeperDeps, plan: () => Promise<PlannedAction | null>): Promise<JournalEntry | null> {
  const token = await acquireLease(d.sql, d.chain.address, d.holderId, d.now(), d.leaseStaleAfterMs);
  const clear = await reconcile(d, token);
  if (!clear) return null;
  const next = await plan();
  if (!next) return null;
  const entry = await persistAction(d.sql, {
    clientRequestId: next.clientRequestId,
    account: d.chain.address,
    token,
    policyVersion: d.policyVersion,
    action: next.action,
    target: next.target,
    calldata: next.calldata,
    plannedNonce: await d.chain.minedNonce(),
    inputs: next.inputs,
  });
  if (entry.state !== "PERSISTED") return entry; // idempotent replay of an old decision
  try {
    const hash = await guardedSend(d.sql, d.chain, d.allow, token, entry);
    await markState(d.sql, entry.id, "DISPATCHED", { txHash: hash });
  } catch (err) {
    if (err instanceof TimeoutError) {
      await markState(d.sql, entry.id, "UNKNOWN");
    } else if (err instanceof FencedError || err instanceof NotAllowedError) {
      await markState(d.sql, entry.id, "SUPERSEDED", { result: { reason: err.message } });
      throw err;
    } else {
      throw err;
    }
  }
  return entry;
}
