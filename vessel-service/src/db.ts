import { Pool } from "pg";
import pino from "pino";
import type { Hex } from "viem";

const log = pino({ name: "db", level: process.env.LOG_LEVEL ?? "info" });

export type WaterfallRow = {
  block: number;
  ts: number;
  gross: string;
  fee: string;
  to_reserve: string;
  to_treasury: string;
  hull_accrual: string;
  to_ballast: string;
  from_ballast: string;
  from_reserve: string;
  hull_tvl: string;
  bal_tvl: string;
  reserve: string;
  tx_hash: Hex;
  log_index: number;
};

export type EngineSnapshotRow = {
  net_delta: string;
  funding_accrued: string;
  spot_value: string;
  short_notional: string;
  ts: number;
  tx_hash: Hex;
  log_index: number;
};

export type Store = {
  kind: "memory" | "pg";
  upsertWaterfall(row: WaterfallRow): Promise<void>;
  upsertSnapshot(row: EngineSnapshotRow): Promise<void>;
  listWaterfall(limit: number): Promise<WaterfallRow[]>;
  listSnapshotsSince(ts: number): Promise<EngineSnapshotRow[]>;
  /** Last fully-indexed block for this chain, or null when nothing is persisted. */
  getCursor(chainId: number): Promise<bigint | null>;
  /** Persist the last fully-indexed block. Only ever called after a range ingested cleanly. */
  setCursor(chainId: number, block: bigint): Promise<void>;
  close(): Promise<void>;
};

/**
 * Both event upserts are keyed on (tx_hash, log_index), which is what makes
 * re-indexing the last CONFIRMATIONS blocks idempotent: a row seen twice
 * overwrites itself, and a row that was reorged out is replaced by whatever
 * the canonical chain now has at that (tx_hash, log_index).
 */
function eventKey(row: { tx_hash: Hex; log_index: number }): string {
  return `${row.tx_hash}:${row.log_index}`;
}

class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private readonly waterfall = new Map<string, WaterfallRow>();
  private readonly snapshots = new Map<string, EngineSnapshotRow>();
  private readonly cursors = new Map<number, bigint>();

  async upsertWaterfall(row: WaterfallRow): Promise<void> {
    this.waterfall.set(eventKey(row), row);
  }

  async upsertSnapshot(row: EngineSnapshotRow): Promise<void> {
    this.snapshots.set(eventKey(row), row);
  }

  async listWaterfall(limit: number): Promise<WaterfallRow[]> {
    return [...this.waterfall.values()]
      .sort((a, b) => b.block - a.block || b.log_index - a.log_index)
      .slice(0, limit);
  }

  async listSnapshotsSince(ts: number): Promise<EngineSnapshotRow[]> {
    return [...this.snapshots.values()]
      .filter((s) => s.ts >= ts)
      .sort((a, b) => a.ts - b.ts);
  }

  async getCursor(chainId: number): Promise<bigint | null> {
    return this.cursors.get(chainId) ?? null;
  }

  async setCursor(chainId: number, block: bigint): Promise<void> {
    this.cursors.set(chainId, block);
  }

  async close(): Promise<void> {
    this.waterfall.clear();
    this.snapshots.clear();
    this.cursors.clear();
  }
}

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS waterfall_events (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block BIGINT NOT NULL,
  ts BIGINT NOT NULL,
  gross TEXT NOT NULL,
  fee TEXT NOT NULL,
  to_reserve TEXT NOT NULL,
  to_treasury TEXT NOT NULL,
  hull_accrual TEXT NOT NULL,
  to_ballast TEXT NOT NULL,
  from_ballast TEXT NOT NULL,
  from_reserve TEXT NOT NULL,
  hull_tvl TEXT NOT NULL,
  bal_tvl TEXT NOT NULL,
  reserve TEXT NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS engine_snapshots (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL DEFAULT 0,
  net_delta TEXT NOT NULL,
  funding_accrued TEXT NOT NULL,
  spot_value TEXT NOT NULL,
  short_notional TEXT NOT NULL,
  ts BIGINT NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

-- One row per chain. Holds the highest block that has been fully ingested.
CREATE TABLE IF NOT EXISTS indexer_cursor (
  chain_id INTEGER PRIMARY KEY,
  last_block BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
`;

/**
 * engine_snapshots shipped with PRIMARY KEY (tx_hash) only. Widen it to
 * (tx_hash, log_index) in place so re-indexing keys the same way waterfall_events
 * does. Idempotent: skipped once the composite key is present.
 */
const MIGRATE_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'engine_snapshots' AND column_name = 'log_index'
  ) THEN
    ALTER TABLE engine_snapshots ADD COLUMN log_index INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'engine_snapshots'::regclass
      AND contype = 'p'
      AND array_length(conkey, 1) = 1
  ) THEN
    ALTER TABLE engine_snapshots DROP CONSTRAINT engine_snapshots_pkey;
    ALTER TABLE engine_snapshots ADD PRIMARY KEY (tx_hash, log_index);
  END IF;
END $$;
`;

class PgStore implements Store {
  readonly kind = "pg" as const;
  // Plain field, not a TS parameter property: node --experimental-strip-types
  // (strip-only mode) rejects parameter properties, and we want the service to
  // run under bare node with no transpiler in the container.
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async upsertWaterfall(row: WaterfallRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO waterfall_events (
         tx_hash, log_index, block, ts, gross, fee, to_reserve, to_treasury,
         hull_accrual, to_ballast, from_ballast, from_reserve, hull_tvl, bal_tvl, reserve
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (tx_hash, log_index) DO UPDATE SET
         block = EXCLUDED.block,
         ts = EXCLUDED.ts,
         gross = EXCLUDED.gross,
         fee = EXCLUDED.fee,
         to_reserve = EXCLUDED.to_reserve,
         to_treasury = EXCLUDED.to_treasury,
         hull_accrual = EXCLUDED.hull_accrual,
         to_ballast = EXCLUDED.to_ballast,
         from_ballast = EXCLUDED.from_ballast,
         from_reserve = EXCLUDED.from_reserve,
         hull_tvl = EXCLUDED.hull_tvl,
         bal_tvl = EXCLUDED.bal_tvl,
         reserve = EXCLUDED.reserve`,
      [
        row.tx_hash,
        row.log_index,
        row.block,
        row.ts,
        row.gross,
        row.fee,
        row.to_reserve,
        row.to_treasury,
        row.hull_accrual,
        row.to_ballast,
        row.from_ballast,
        row.from_reserve,
        row.hull_tvl,
        row.bal_tvl,
        row.reserve,
      ],
    );
  }

  async upsertSnapshot(row: EngineSnapshotRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO engine_snapshots (
         tx_hash, log_index, net_delta, funding_accrued, spot_value, short_notional, ts
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tx_hash, log_index) DO UPDATE SET
         net_delta = EXCLUDED.net_delta,
         funding_accrued = EXCLUDED.funding_accrued,
         spot_value = EXCLUDED.spot_value,
         short_notional = EXCLUDED.short_notional,
         ts = EXCLUDED.ts`,
      [
        row.tx_hash,
        row.log_index,
        row.net_delta,
        row.funding_accrued,
        row.spot_value,
        row.short_notional,
        row.ts,
      ],
    );
  }

  async listWaterfall(limit: number): Promise<WaterfallRow[]> {
    const { rows } = await this.pool.query<{
      tx_hash: string;
      log_index: number;
      block: string;
      ts: string;
      gross: string;
      fee: string;
      to_reserve: string;
      to_treasury: string;
      hull_accrual: string;
      to_ballast: string;
      from_ballast: string;
      from_reserve: string;
      hull_tvl: string;
      bal_tvl: string;
      reserve: string;
    }>(
      `SELECT tx_hash, log_index, block, ts, gross, fee, to_reserve, to_treasury,
              hull_accrual, to_ballast, from_ballast, from_reserve, hull_tvl, bal_tvl, reserve
       FROM waterfall_events
       ORDER BY block DESC, log_index DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      tx_hash: r.tx_hash as Hex,
      log_index: Number(r.log_index),
      block: Number(r.block),
      ts: Number(r.ts),
      gross: r.gross,
      fee: r.fee,
      to_reserve: r.to_reserve,
      to_treasury: r.to_treasury,
      hull_accrual: r.hull_accrual,
      to_ballast: r.to_ballast,
      from_ballast: r.from_ballast,
      from_reserve: r.from_reserve,
      hull_tvl: r.hull_tvl,
      bal_tvl: r.bal_tvl,
      reserve: r.reserve,
    }));
  }

  async listSnapshotsSince(ts: number): Promise<EngineSnapshotRow[]> {
    const { rows } = await this.pool.query<{
      tx_hash: string;
      log_index: number;
      net_delta: string;
      funding_accrued: string;
      spot_value: string;
      short_notional: string;
      ts: string;
    }>(
      `SELECT tx_hash, log_index, net_delta, funding_accrued, spot_value, short_notional, ts
       FROM engine_snapshots
       WHERE ts >= $1
       ORDER BY ts ASC`,
      [ts],
    );
    return rows.map((r) => ({
      tx_hash: r.tx_hash as Hex,
      log_index: Number(r.log_index),
      net_delta: r.net_delta,
      funding_accrued: r.funding_accrued,
      spot_value: r.spot_value,
      short_notional: r.short_notional,
      ts: Number(r.ts),
    }));
  }

  async getCursor(chainId: number): Promise<bigint | null> {
    const { rows } = await this.pool.query<{ last_block: string }>(
      `SELECT last_block FROM indexer_cursor WHERE chain_id = $1`,
      [chainId],
    );
    const row = rows[0];
    if (!row) return null;
    return BigInt(row.last_block);
  }

  async setCursor(chainId: number, block: bigint): Promise<void> {
    // GREATEST() guards against a stale writer ever walking the cursor backwards.
    await this.pool.query(
      `INSERT INTO indexer_cursor (chain_id, last_block, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (chain_id) DO UPDATE SET
         last_block = GREATEST(indexer_cursor.last_block, EXCLUDED.last_block),
         updated_at = EXCLUDED.updated_at`,
      [chainId, block.toString(), Math.floor(Date.now() / 1000)],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Whether to negotiate TLS to Postgres.
 *
 * Not every managed Postgres speaks SSL. Railway's private network
 * (`*.railway.internal`) does not, and forcing `ssl` there fails the connection
 * outright with "The server does not support SSL connections" — the traffic is
 * already confined to the project's private network. Public/proxied endpoints
 * still get TLS.
 *
 * `?sslmode=disable` in the URL is honoured, since that is the standard way to
 * say so and node-postgres ignores it once an explicit `ssl` option is set.
 */
function pgSsl(connectionString: string): boolean | { rejectUnauthorized: boolean } {
  if (/[?&]sslmode=disable\b/.test(connectionString)) return false;
  if (/localhost|127\.0\.0\.1|\.railway\.internal|\.internal(?::\d+)?\//.test(connectionString)) {
    return false;
  }
  return { rejectUnauthorized: false };
}

export async function initDb(): Promise<Store> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    log.info("DATABASE_URL unset — in-memory Maps (lost on restart, indexer re-backfills)");
    return new MemoryStore();
  }
  const pool = new Pool({ connectionString: url, ssl: pgSsl(url) });
  await pool.query(CREATE_SQL);
  await pool.query(MIGRATE_SQL);
  log.info("postgres ready (waterfall_events, engine_snapshots, indexer_cursor)");
  return new PgStore(pool);
}

const YEAR = 365n;
const BPS = 10_000n;

/**
 * Annualize 7d funding / avg short notional into bps.
 *
 * Returns null — never 0 — when there is nothing to annualize (no snapshots in
 * the window, or zero average notional). 0 is a real APR; "unknown" is not 0.
 */
export async function fundingApr7dBps(store: Store): Promise<number | null> {
  const since = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
  const snaps = await store.listSnapshotsSince(since);
  if (snaps.length === 0) return null;
  let funding = 0n;
  let notional = 0n;
  for (const s of snaps) {
    funding += BigInt(s.funding_accrued);
    notional += BigInt(s.short_notional);
  }
  const avg = notional / BigInt(snaps.length);
  if (avg === 0n) return null;
  const apr = (funding * YEAR * BPS) / (avg * 7n);
  if (apr > 1_000_000_000n) return 1_000_000_000;
  if (apr < -1_000_000_000n) return -1_000_000_000;
  return Number(apr);
}
