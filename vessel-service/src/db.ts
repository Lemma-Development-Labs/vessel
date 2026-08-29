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
};

export type Store = {
  kind: "memory" | "pg";
  upsertWaterfall(row: WaterfallRow): Promise<void>;
  upsertSnapshot(row: EngineSnapshotRow): Promise<void>;
  listWaterfall(limit: number): Promise<WaterfallRow[]>;
  listSnapshotsSince(ts: number): Promise<EngineSnapshotRow[]>;
  close(): Promise<void>;
};

function waterfallKey(row: WaterfallRow): string {
  return `${row.tx_hash}:${row.log_index}`;
}

class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private readonly waterfall = new Map<string, WaterfallRow>();
  private readonly snapshots = new Map<string, EngineSnapshotRow>();

  async upsertWaterfall(row: WaterfallRow): Promise<void> {
    this.waterfall.set(waterfallKey(row), row);
  }

  async upsertSnapshot(row: EngineSnapshotRow): Promise<void> {
    this.snapshots.set(row.tx_hash, row);
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

  async close(): Promise<void> {
    this.waterfall.clear();
    this.snapshots.clear();
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
  tx_hash TEXT PRIMARY KEY,
  net_delta TEXT NOT NULL,
  funding_accrued TEXT NOT NULL,
  spot_value TEXT NOT NULL,
  short_notional TEXT NOT NULL,
  ts BIGINT NOT NULL
);
`;

class PgStore implements Store {
  readonly kind = "pg" as const;
  constructor(private readonly pool: Pool) {}

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
         tx_hash, net_delta, funding_accrued, spot_value, short_notional, ts
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tx_hash) DO UPDATE SET
         net_delta = EXCLUDED.net_delta,
         funding_accrued = EXCLUDED.funding_accrued,
         spot_value = EXCLUDED.spot_value,
         short_notional = EXCLUDED.short_notional,
         ts = EXCLUDED.ts`,
      [
        row.tx_hash,
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
      net_delta: string;
      funding_accrued: string;
      spot_value: string;
      short_notional: string;
      ts: string;
    }>(
      `SELECT tx_hash, net_delta, funding_accrued, spot_value, short_notional, ts
       FROM engine_snapshots
       WHERE ts >= $1
       ORDER BY ts ASC`,
      [ts],
    );
    return rows.map((r) => ({
      tx_hash: r.tx_hash as Hex,
      net_delta: r.net_delta,
      funding_accrued: r.funding_accrued,
      spot_value: r.spot_value,
      short_notional: r.short_notional,
      ts: Number(r.ts),
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function pgSsl(connectionString: string): boolean | { rejectUnauthorized: boolean } {
  if (/localhost|127\.0\.0\.1/.test(connectionString)) return false;
  return { rejectUnauthorized: false };
}

export async function initDb(): Promise<Store> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    log.info("DATABASE_URL unset — in-memory Maps (lost on restart)");
    return new MemoryStore();
  }
  const pool = new Pool({ connectionString: url, ssl: pgSsl(url) });
  await pool.query(CREATE_SQL);
  log.info("postgres ready (waterfall_events, engine_snapshots)");
  return new PgStore(pool);
}

const YEAR = 365n;
const BPS = 10_000n;

/** Annualize 7d funding / avg short notional into bps. 0 if no snapshots. */
export async function fundingApr7dBps(store: Store): Promise<number> {
  const since = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
  const snaps = await store.listSnapshotsSince(since);
  if (snaps.length === 0) return 0;
  let funding = 0n;
  let notional = 0n;
  for (const s of snaps) {
    funding += BigInt(s.funding_accrued);
    notional += BigInt(s.short_notional);
  }
  const avg = notional / BigInt(snaps.length);
  if (avg === 0n) return 0;
  const apr = (funding * YEAR * BPS) / (avg * 7n);
  if (apr > 1_000_000_000n) return 1_000_000_000;
  if (apr < -1_000_000_000n) return -1_000_000_000;
  return Number(apr);
}
