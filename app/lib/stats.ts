import type { WaterfallEvent } from "./provider";

const STATS = process.env.NEXT_PUBLIC_STATS_URL;

export type StatsRow = {
  tvl?: string;
  hullTvl?: string;
  balTvl?: string;
  subordinationPct?: number;
  reserve?: string;
  netDeltaPct?: number;
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

export async function fetchWaterfall(limit = 50): Promise<WaterfallEvent[] | null> {
  if (!STATS) return null;
  try {
    const res = await fetch(`${STATS}/waterfall?limit=${limit}`, { cache: "no-store" });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<Record<string, string | number>>;
    return rows.map((r) => ({
      gross: BigInt(r.gross ?? 0),
      fee: BigInt(r.fee ?? 0),
      toReserve: BigInt(r.to_reserve ?? r.toReserve ?? 0),
      toTreasury: BigInt(r.to_treasury ?? r.toTreasury ?? 0),
      hullAccrual: BigInt(r.hull_accrual ?? r.hullAccrual ?? 0),
      toBallast: BigInt(r.to_ballast ?? r.toBallast ?? 0),
      fromBallast: BigInt(r.from_ballast ?? r.fromBallast ?? 0),
      fromReserve: BigInt(r.from_reserve ?? r.fromReserve ?? 0),
      hullTvl: BigInt(r.hull_tvl ?? r.hullTvl ?? 0),
      balTvl: BigInt(r.bal_tvl ?? r.balTvl ?? 0),
      reserve: BigInt(r.reserve ?? 0),
      ts: BigInt(r.ts ?? 0),
      txHash: String(r.tx_hash ?? r.txHash ?? ""),
      blockNumber: r.block != null ? BigInt(r.block) : undefined,
    }));
  } catch {
    return null;
  }
}

export function statsUrl(): string | undefined {
  return STATS;
}
