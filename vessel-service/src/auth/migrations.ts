import type { Sql } from "./sql.ts";

/**
 * Ordered, append-only migrations for the private-beta identity tables
 * (spec §13–§14). Each migration is a list of single statements so it runs
 * identically on node-postgres and PGlite. Never edit an applied migration;
 * add a new one.
 *
 * These tables are operational identity state. They are NOT chain-derived
 * projections and carry no financial authority: nothing here can change a
 * claim, a balance or admission on-chain (spec §13).
 */
export const MIGRATIONS: ReadonlyArray<{ id: string; statements: string[] }> = [
  {
    id: "001_identity",
    statements: [
      `CREATE TABLE participants (
         id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         created_at  timestamptz NOT NULL DEFAULT now()
       )`,
      // One wallet → one participant (PK), one active wallet per participant (UNIQUE).
      `CREATE TABLE wallets (
         address         text PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
         participant_id  uuid NOT NULL UNIQUE REFERENCES participants(id),
         bound_at        timestamptz NOT NULL DEFAULT now()
       )`,
      // Codes are random, single-use and stored only as SHA-256.
      `CREATE TABLE invitations (
         id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         code_sha256     text NOT NULL UNIQUE CHECK (code_sha256 ~ '^[0-9a-f]{64}$'),
         created_at      timestamptz NOT NULL DEFAULT now(),
         expires_at      timestamptz NOT NULL,
         used_at         timestamptz,
         revoked_at      timestamptz,
         participant_id  uuid UNIQUE REFERENCES participants(id),
         CHECK ((used_at IS NULL) = (participant_id IS NULL))
       )`,
      `CREATE TABLE consent_versions (
         version       text PRIMARY KEY,
         text_sha256   text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
         published_at  timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE TABLE consents (
         participant_id  uuid NOT NULL REFERENCES participants(id),
         version         text NOT NULL REFERENCES consent_versions(version),
         accepted_at     timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY (participant_id, version)
       )`,
      // SIWE nonces: single-use, short-lived. Not secret (they are signed in clear).
      `CREATE TABLE auth_nonces (
         nonce        text PRIMARY KEY CHECK (nonce ~ '^[A-Za-z0-9]{16,64}$'),
         created_at   timestamptz NOT NULL DEFAULT now(),
         expires_at   timestamptz NOT NULL,
         consumed_at  timestamptz
       )`,
      // Opaque tokens stored only as SHA-256. A family is one login; rotation
      // adds rows to it; reuse of a rotated refresh token revokes the family.
      `CREATE TABLE auth_sessions (
         id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         family_id           uuid NOT NULL,
         address             text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
         access_sha256       text NOT NULL UNIQUE,
         access_expires_at   timestamptz NOT NULL,
         refresh_sha256      text NOT NULL UNIQUE,
         refresh_expires_at  timestamptz NOT NULL,
         family_expires_at   timestamptz NOT NULL,
         created_at          timestamptz NOT NULL DEFAULT now(),
         rotated_at          timestamptz,
         revoked_at          timestamptz
       )`,
      `CREATE INDEX auth_sessions_family ON auth_sessions (family_id)`,
      `CREATE TABLE audit_events (
         id      bigserial PRIMARY KEY,
         at      timestamptz NOT NULL DEFAULT now(),
         actor   text,
         action  text NOT NULL,
         detail  jsonb NOT NULL DEFAULT '{}'::jsonb
       )`,
      // Intent identity (used from Session 4): an idempotency key binds account
      // + action + body; reusing it with a different action/body is refused.
      `CREATE TABLE intents (
         id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         account          text NOT NULL CHECK (account ~ '^0x[0-9a-f]{40}$'),
         idempotency_key  text NOT NULL,
         action           text NOT NULL,
         body_sha256      text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
         created_at       timestamptz NOT NULL DEFAULT now(),
         UNIQUE (account, idempotency_key)
       )`,
    ],
  },
];

export async function migrate(sql: Sql): Promise<string[]> {
  await sql.query(
    `CREATE TABLE IF NOT EXISTS auth_schema_migrations (
       id          text PRIMARY KEY,
       applied_at  timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const applied = new Set(
    (await sql.query<{ id: string }>("SELECT id FROM auth_schema_migrations")).map((r) => r.id),
  );
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await sql.transaction(async (q) => {
      for (const s of m.statements) await q.query(s);
      await q.query("INSERT INTO auth_schema_migrations (id) VALUES ($1)", [m.id]);
    });
    ran.push(m.id);
  }
  return ran;
}
