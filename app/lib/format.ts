export function formatDusd(amount: bigint, digits = 2): string {
  const n = Number(amount) / 1e6;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatDusd4(amount: bigint): string {
  return formatDusd(amount, 4);
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

export function formatPct(pct: number, digits = 2): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

export function formatDelta(v: bigint): string {
  const n = Number(v) / 1e6;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

export function formatWmon(amount: bigint): string {
  const n = Number(amount) / 1e18;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export function parseDusd(input: string): bigint {
  const t = input.trim();
  if (!t) return 0n;
  const [w, f = ""] = t.split(".");
  return BigInt(w || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6));
}

export function shorten(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatTs(ts: bigint | number): string {
  const n = Number(ts);
  if (!n) return "—";
  return new Date(n * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCountdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function formatBlock(n: number | bigint): string {
  return Number(n).toLocaleString("en-US");
}
