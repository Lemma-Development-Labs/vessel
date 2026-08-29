import pg from "pg";
const url = process.env.DATABASE_URL;
if (!url) { console.log("no DATABASE_URL"); process.exit(1); }
const ssl = /sslmode=disable|railway\.internal|localhost/.test(url) ? false : { rejectUnauthorized:false };
const c = new pg.Client({ connectionString: url, ssl });
await c.connect();
for (const t of ["waterfall_events","engine_snapshots","indexer_cursor"]) {
  try { const r = await c.query(`DELETE FROM ${t}`); console.log(`cleared ${t}: ${r.rowCount} rows`); }
  catch (e) { console.log(`${t}: ${e.message}`); }
}
await c.end();
