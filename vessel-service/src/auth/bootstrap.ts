import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { Logger } from "pino";
import { pgSsl } from "../db.ts";
import { publishConsentVersion, type AuthSettings } from "./core.ts";
import { currentDisclosure } from "./disclosures.ts";
import { migrate } from "./migrations.ts";
import type { AuthRouteDeps } from "./routes.ts";
import { pgSql, pgliteSql, type Sql } from "./sql.ts";

type Environment = "local" | "testnet" | "mainnet";

/**
 * Build the auth dependencies from the environment, or return null when auth
 * is not configured (AUTH_DOMAIN / AUTH_ORIGIN unset) — the public read API
 * keeps working without it.
 *
 *   AUTH_DOMAIN  authority the app is served from, e.g. testnet.vessel.wtf
 *   AUTH_ORIGIN  exact app origin, e.g. https://testnet.vessel.wtf
 *   DATABASE_URL Postgres; required on mainnet. Without it (local/testnet
 *                only) sessions live in an in-process PGlite and are lost on
 *                restart.
 */
export async function initAuth(
  environment: Environment,
  chainId: number,
  log: Logger,
): Promise<{ deps: AuthRouteDeps; close: () => Promise<void> } | null> {
  const domain = process.env.AUTH_DOMAIN?.trim();
  const origin = process.env.AUTH_ORIGIN?.trim();
  if (!domain && !origin) {
    log.warn("AUTH_DOMAIN / AUTH_ORIGIN unset — auth routes not served");
    return null;
  }
  if (!domain || !origin) throw new Error("set both AUTH_DOMAIN and AUTH_ORIGIN, or neither");

  const url = new URL(origin);
  if (url.origin !== origin) throw new Error(`AUTH_ORIGIN must be a bare origin, got ${origin}`);
  if (url.host !== domain) throw new Error(`AUTH_DOMAIN ${domain} does not match AUTH_ORIGIN host ${url.host}`);
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  // Browsers treat localhost as a secure context, so Secure cookies still work
  // over http there. Anything else, and anything on mainnet, must be https.
  if (url.protocol !== "https:" && !(environment !== "mainnet" && isLocalhost)) {
    throw new Error("AUTH_ORIGIN must be https (http is allowed only for localhost outside mainnet)");
  }

  let sql: Sql;
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (dbUrl) {
    sql = pgSql(new pg.Pool({ connectionString: dbUrl, ssl: pgSsl(dbUrl) }));
  } else if (environment === "mainnet") {
    throw new Error("mainnet auth requires DATABASE_URL");
  } else {
    log.warn("DATABASE_URL unset — auth sessions in in-process PGlite (lost on restart)");
    sql = pgliteSql(new PGlite());
  }

  const applied = await migrate(sql);

  // Non-mainnet convenience for local runs and browser tests without a
  // database: pre-register invitations by the SHA-256 of codes the operator
  // chose. Only hashes enter the environment; mainnet refuses the variable.
  const seeded = (process.env.AUTH_SEED_INVITE_SHA256S ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  if (seeded.length > 0) {
    if (environment === "mainnet") throw new Error("AUTH_SEED_INVITE_SHA256S is not allowed on mainnet");
    for (const h of seeded) {
      if (!/^[0-9a-f]{64}$/.test(h)) throw new Error("AUTH_SEED_INVITE_SHA256S must hold lowercase SHA-256 hex digests");
      await sql.query(
        `INSERT INTO invitations (code_sha256, expires_at) VALUES ($1, now() + interval '1 day')
         ON CONFLICT (code_sha256) DO NOTHING`,
        [h],
      );
    }
    log.warn({ count: seeded.length }, "seeded invitation hashes from AUTH_SEED_INVITE_SHA256S (non-mainnet)");
  }
  const disclosure = currentDisclosure(environment);
  await publishConsentVersion(sql, disclosure.version, disclosure.text);
  log.info({ applied, disclosure: disclosure.version, db: sql.kind }, "auth store ready");

  const settings: AuthSettings = { domain, origin, chainId, now: () => new Date() };
  return { deps: { sql, settings, disclosure }, close: () => sql.close() };
}
