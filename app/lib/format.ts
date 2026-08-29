export function formatDusd(amount: bigint): string {
  const n = Number(amount) / 1e6;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatShares(amount: bigint): string {
  const n = Number(amount) / 1e18;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

export function formatBps(bps: bigint | number): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

export function formatDelta(v: bigint): string {
  const n = Number(v) / 1e6;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

export function parseDusd(input: string): bigint {
  const t = input.trim();
  if (!t) return 0n;
  const [w, f = ""] = t.split(".");
  return BigInt(w || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6));
}

export function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatTs(ts: bigint): string {
  if (ts === 0n) return "—";
  return new Date(Number(ts) * 1000).toLocaleTimeString();
}
