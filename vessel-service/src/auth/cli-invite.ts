/**
 * Create one invitation and print its code once. The database stores only
 * the SHA-256; the plaintext is never written anywhere else, so hand it to
 * the participant directly and do not paste it into logs or tickets.
 *
 *   DATABASE_URL=… VESSEL_ENV=testnet pnpm invite:create [ttlDays=7]
 *
 * Requires a real DATABASE_URL: an in-process PGlite would forget the
 * invitation the moment this command exits.
 */
import pg from "pg";
import { pgSsl } from "../db.ts";
import { createInvitation } from "./core.ts";
import { migrate } from "./migrations.ts";
import { pgSql } from "./sql.ts";

const env = process.env.VESSEL_ENV;
if (env !== "local" && env !== "testnet" && env !== "mainnet") {
  console.error("VESSEL_ENV must be local | testnet | mainnet");
  process.exit(2);
}
const dbUrl = process.env.DATABASE_URL?.trim();
if (!dbUrl) {
  console.error("DATABASE_URL is required (an in-process database would lose the invitation on exit)");
  process.exit(2);
}
const ttlDays = BigInt(process.argv[2] ?? "7");
if (ttlDays < 1n || ttlDays > 30n) {
  console.error("ttlDays must be between 1 and 30");
  process.exit(2);
}

const sql = pgSql(new pg.Pool({ connectionString: dbUrl, ssl: pgSsl(dbUrl) }));
try {
  await migrate(sql);
  const { code, expiresAt } = await createInvitation(
    sql,
    { domain: "", origin: "", chainId: 0, now: () => new Date() },
    Number(ttlDays) * 24 * 60 * 60_000,
  );
  console.log(`environment ${env}`);
  console.log(`expires     ${expiresAt.toISOString()}`);
  console.log(`code        ${code}`);
} finally {
  await sql.close();
}
