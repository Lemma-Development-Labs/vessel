import { applyMigrations } from "../auth/migrations.ts";
import type { Sql } from "../auth/sql.ts";

/**
 * Durable execution journal for the v2 keeper (spec §11, master prompt 3.4).
 *
 * - One active writer per signing account: a lease row with a monotonically
 *   increasing fencing token. Taking over bumps the token; every later write
 *   and every signature is checked against the CURRENT token, so a stalled old
 *   worker that wakes up is refused.
 * - Decisions are persisted before dispatch (PERSISTED), with the planned
 *   nonce. After sending, the tx hash is recorded (DISPATCHED). A timeout is
 *   UNKNOWN, not failed: recovery reconciles against the chain by nonce and
 *   hash before anything is resent, so a crash or redelivery can never create
 *   a duplicate transaction.
 * - An entry that provably never reached the chain (REJECTED by the node, or
 *   SUPERSEDED before signing) releases its nonce and its decision id, so a
 *   refused call cannot jam the account and the decision can be retried.
 */

export const JOURNAL_MIGRATIONS: ReadonlyArray<{ id: string; statements: string[] }> = [
  {
    id: "002_keeper_journal",
    statements: [
      `CREATE TABLE writer_lease (
         account        text PRIMARY KEY,
         holder_id      text NOT NULL,
         fencing_token  bigint NOT NULL,
         acquired_at    timestamptz NOT NULL,
         heartbeat_at   timestamptz NOT NULL
       )`,
      `CREATE TABLE action_journal (
         id                 bigserial PRIMARY KEY,
         client_request_id  text NOT NULL UNIQUE,
         account            text NOT NULL,
         fencing_token      bigint NOT NULL,
         policy_version     text NOT NULL,
         action             text NOT NULL,
         target             text NOT NULL,
         calldata           text NOT NULL,
         planned_nonce      bigint NOT NULL,
         inputs             jsonb NOT NULL DEFAULT '{}'::jsonb,
         state              text NOT NULL CHECK (state IN
                              ('PERSISTED','DISPATCHED','UNKNOWN','CONFIRMED','REVERTED','SUPERSEDED')),
         tx_hash            text,
         result             jsonb,
         created_at         timestamptz NOT NULL DEFAULT now(),
         updated_at         timestamptz NOT NULL DEFAULT now(),
         UNIQUE (account, planned_nonce)
       )`,
      `CREATE INDEX action_journal_open ON action_journal (account, state)`,
    ],
  },
  {
    // Uniqueness only binds entries that hold (or may hold) their nonce. Without this, an
    // entry the node refused kept its nonce reserved and every later decision collided on it.
    id: "004_keeper_journal_release_unsent",
    statements: [
      `ALTER TABLE action_journal DROP CONSTRAINT IF EXISTS action_journal_state_check`,
      `ALTER TABLE action_journal ADD CONSTRAINT action_journal_state_check CHECK (state IN
         ('PERSISTED','DISPATCHED','UNKNOWN','CONFIRMED','REVERTED','SUPERSEDED','REJECTED'))`,
      `ALTER TABLE action_journal DROP CONSTRAINT IF EXISTS action_journal_client_request_id_key`,
      `ALTER TABLE action_journal DROP CONSTRAINT IF EXISTS action_journal_account_planned_nonce_key`,
      `CREATE UNIQUE INDEX action_journal_live_request ON action_journal (client_request_id)
         WHERE state NOT IN ('SUPERSEDED','REJECTED')`,
      `CREATE UNIQUE INDEX action_journal_live_nonce ON action_journal (account, planned_nonce)
         WHERE state NOT IN ('SUPERSEDED','REJECTED')`,
    ],
  },
];

export type JournalState = "PERSISTED" | "DISPATCHED" | "UNKNOWN" | "CONFIRMED" | "REVERTED" | "SUPERSEDED" | "REJECTED";

export type JournalEntry = {
  id: string;
  client_request_id: string;
  account: string;
  fencing_token: string;
  action: string;
  target: string;
  calldata: string;
  planned_nonce: string;
  state: JournalState;
  tx_hash: string | null;
};

export class FencedError extends Error {
  override name = "FencedError";
}

export async function migrateJournal(sql: Sql): Promise<void> {
  await applyMigrations(sql, JOURNAL_MIGRATIONS);
}

/**
 * Take (or renew) the writer lease for `account`. A different holder can take
 * over only after the current lease is older than `staleAfterMs`; taking over
 * bumps the fencing token. Returns this holder's token.
 */
export async function acquireLease(
  sql: Sql,
  account: string,
  holderId: string,
  now: Date,
  staleAfterMs: number,
): Promise<bigint> {
  return sql.transaction(async (q) => {
    const [row] = await q.query<{ holder_id: string; fencing_token: string; heartbeat_at: Date }>(
      "SELECT holder_id, fencing_token, heartbeat_at FROM writer_lease WHERE account = $1 FOR UPDATE",
      [account],
    );
    if (!row) {
      await q.query(
        "INSERT INTO writer_lease (account, holder_id, fencing_token, acquired_at, heartbeat_at) VALUES ($1, $2, 1, $3, $3)",
        [account, holderId, now],
      );
      return 1n;
    }
    if (row.holder_id === holderId) {
      await q.query("UPDATE writer_lease SET heartbeat_at = $2 WHERE account = $1", [account, now]);
      return BigInt(row.fencing_token);
    }
    if (now.getTime() - row.heartbeat_at.getTime() < staleAfterMs) {
      throw new FencedError(`lease for ${account} held by ${row.holder_id}`);
    }
    const next = BigInt(row.fencing_token) + 1n;
    await q.query(
      "UPDATE writer_lease SET holder_id = $2, fencing_token = $3, acquired_at = $4, heartbeat_at = $4 WHERE account = $1",
      [account, holderId, next.toString(), now],
    );
    return next;
  });
}

/** Throws unless `token` is still the current fencing token for `account`. */
export async function assertCurrentToken(sql: Sql, account: string, token: bigint): Promise<void> {
  const [row] = await sql.query<{ fencing_token: string }>("SELECT fencing_token FROM writer_lease WHERE account = $1", [account]);
  if (!row || BigInt(row.fencing_token) !== token) {
    throw new FencedError(`stale fencing token ${token} for ${account}`);
  }
}

/** Persist a decision BEFORE dispatch. Idempotent on clientRequestId while the earlier entry is live. */
export async function persistAction(
  sql: Sql,
  e: {
    clientRequestId: string;
    account: string;
    token: bigint;
    policyVersion: string;
    action: string;
    target: string;
    calldata: string;
    plannedNonce: bigint;
    inputs: object;
  },
): Promise<JournalEntry> {
  return sql.transaction(async (q) => {
    await assertCurrentToken(q, e.account, e.token);
    const [existing] = await q.query<JournalEntry>(
      "SELECT * FROM action_journal WHERE client_request_id = $1 AND state NOT IN ('SUPERSEDED','REJECTED')",
      [e.clientRequestId],
    );
    if (existing) return existing;
    const [row] = await q.query<JournalEntry>(
      `INSERT INTO action_journal
         (client_request_id, account, fencing_token, policy_version, action, target, calldata, planned_nonce, inputs, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PERSISTED') RETURNING *`,
      [e.clientRequestId, e.account, e.token.toString(), e.policyVersion, e.action, e.target, e.calldata, e.plannedNonce.toString(), JSON.stringify(e.inputs)],
    );
    return row!;
  });
}

export async function markState(
  sql: Sql,
  id: string,
  state: JournalState,
  patch: { txHash?: string; result?: object } = {},
): Promise<void> {
  await sql.query(
    `UPDATE action_journal SET state = $2, tx_hash = COALESCE($3, tx_hash), result = COALESCE($4, result), updated_at = now() WHERE id = $1`,
    [id, state, patch.txHash ?? null, patch.result ? JSON.stringify(patch.result) : null],
  );
}

export async function openEntries(sql: Sql, account: string): Promise<JournalEntry[]> {
  return sql.query<JournalEntry>(
    `SELECT * FROM action_journal WHERE account = $1 AND state IN ('PERSISTED','DISPATCHED','UNKNOWN') ORDER BY planned_nonce`,
    [account],
  );
}
