import type { WaterfallEvent } from "./provider";

const STATS = process.env.NEXT_PUBLIC_STATS_URL;

export type StatsRow = {
  tvl?: string;
  hullTvl?: string;
  balTvl?: string;
  subordinationPct?: number;
  reserve?: string;
  netDeltaPct?: number;
  /** null when the service has no snapshots — never 0, which would read as a real APR. */
  fundingApr7dBps?: number | null;
  lastCrankTs?: number;
  venue?: "sim" | "perpl";
};

export async function fetchStats(): Promise<StatsRow | null> {
  if (!STATS) return null;
  try {
    const res = await fetch(`${STATS}/stats`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as StatsRow;
  } catch {
    return null;
  }
}

/** Strict bigint parse. A missing or unparseable field invalidates the row. */
function big(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  return null;
}

function pick(r: Record<string, unknown>, ...keys: string[]): bigint | null {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null) return big(r[k]);
  }
  return null;
}

/**
 * RULE 0: a waterfall row with a missing field is malformed data, not a datum
 * worth zero. Zero-filling it would publish a fabricated settle on the
 * transparency log, so we drop the row and let the count speak for itself.
 *
 * Returns null when the service is unreachable (caller falls back to chain),
 * and [] when the service answered with nothing.
 */
export async function fetchWaterfall(limit = 50): Promise<WaterfallEvent[] | null> {
  if (!STATS) return null;
  try {
    const res = await fetch(`${STATS}/waterfall?limit=${limit}`, { cache: "no-store" });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return null;

    const out: WaterfallEvent[] = [];
    for (const r of rows) {
      const gross = pick(r, "gross");
      const fee = pick(r, "fee");
      const toReserve = pick(r, "to_reserve", "toReserve");
      const toTreasury = pick(r, "to_treasury", "toTreasury");
      const hullAccrual = pick(r, "hull_accrual", "hullAccrual");
      const toBallast = pick(r, "to_ballast", "toBallast");
      const fromBallast = pick(r, "from_ballast", "fromBallast");
      const fromReserve = pick(r, "from_reserve", "fromReserve");
      const hullTvl = pick(r, "hull_tvl", "hullTvl");
      const balTvl = pick(r, "bal_tvl", "balTvl");
      const reserve = pick(r, "reserve");
      const ts = pick(r, "ts");
      const txHash = r.tx_hash ?? r.txHash;

      if (
        gross === null || fee === null || toReserve === null || toTreasury === null ||
        hullAccrual === null || toBallast === null || fromBallast === null ||
        fromReserve === null || hullTvl === null || balTvl === null ||
        reserve === null || ts === null || typeof txHash !== "string" || txHash === ""
      ) {
        continue; // malformed — drop rather than fabricate
      }

      const block = pick(r, "block");
      out.push({
        gross, fee, toReserve, toTreasury, hullAccrual, toBallast,
        fromBallast, fromReserve, hullTvl, balTvl, reserve, ts,
        txHash,
        blockNumber: block === null ? undefined : block,
      });
    }
    return out;
  } catch {
    return null;
  }
}

export function statsUrl(): string | undefined {
  return STATS;
}
