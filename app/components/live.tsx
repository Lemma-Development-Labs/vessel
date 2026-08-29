"use client";

import type { ReactNode } from "react";
import { ageSec, isStale, type Live } from "@/lib/live";

/**
 * RULE 0 rendering. A datum that could not be read renders as a dim mono `—`
 * carrying its reason in a tooltip. It never renders as `0`, never as a
 * skeleton that resolves to nothing, and never as a placeholder that reads
 * like data.
 */

const DASH = "—";

export function Unavailable({ reason, className = "" }: { reason: string; className?: string }) {
  return (
    <span
      className={`num cursor-help text-steel/60 ${className}`}
      title={reason}
      data-live="unavailable"
      aria-label={`unavailable: ${reason}`}
    >
      {DASH}
    </span>
  );
}

/**
 * Render a Live<T>. `children` only ever sees a real, sourced value.
 *
 * `staleAfterSec` renders an ok-but-old read dim with an age suffix instead of
 * presenting it as current — a number from three crank intervals ago is not a
 * lie, but showing it undecorated would be.
 */
export function Val<T>({
  of,
  children,
  nowSec,
  staleAfterSec,
  className = "",
}: {
  of: Live<T>;
  children: (value: T) => ReactNode;
  nowSec?: number;
  staleAfterSec?: number;
  className?: string;
}) {
  if (of.status !== "ok") return <Unavailable reason={of.reason} className={className} />;

  const stale =
    nowSec !== undefined && staleAfterSec !== undefined && isStale(of, nowSec, staleAfterSec);

  if (!stale) {
    return (
      <span className={className} data-live="ok" data-source={of.source}>
        {children(of.value)}
      </span>
    );
  }

  const age = nowSec !== undefined ? ageSec(of, nowSec) : null;
  return (
    <span
      className={`text-steel/70 ${className}`}
      data-live="stale"
      data-source={of.source}
      title={`Last read ${age ?? "?"}s ago — older than one crank interval.`}
    >
      {children(of.value)}
      <span className="num ml-1.5 text-[10px] text-steel/60">{age !== null ? `${fmtAge(age)} old` : "stale"}</span>
    </span>
  );
}

function fmtAge(sec: number): string {
  if (sec < 90) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

/**
 * Chip shown when the app is reading history from chain because the stats
 * service did not answer. Silent degradation is a lie of omission on a
 * product whose argument is verifiability, so the downgrade is stated.
 */
export function SourceChip({ source }: { source: "chain" | "stats" | "mock" | "none" }) {
  if (source === "stats") return null;
  const copy =
    source === "chain"
      ? "reading from chain · history limited"
      : source === "mock"
        ? "demo data · not chain state"
        : "history unavailable";
  const tone = source === "mock" ? "text-amber border-amber/30" : "text-steel border-white/10";
  return (
    <span
      className={`num inline-flex items-center rounded-md border px-2 py-1 text-[10px] tracking-[0.1em] ${tone}`}
      title={
        source === "chain"
          ? "The stats service did not answer, so history is being read directly from the RPC. Only recent blocks are available and the list may be incomplete."
          : source === "mock"
            ? "This screen is showing demo data, not live chain state."
            : "No history source is reachable."
      }
    >
      {copy}
    </span>
  );
}

/**
 * Empty state for a chart whose series could not be built. Explicitly not a
 * flat line at zero — a flat line reads as "nothing happened", which is a
 * different claim from "we could not read it".
 */
export function ChartUnavailable({ reason, className = "" }: { reason: string; className?: string }) {
  return (
    <div
      className={`flex min-h-[32px] items-center justify-center rounded-md border border-dashed border-white/10 px-2 py-2 ${className}`}
      data-live="unavailable"
    >
      <span className="num text-[10px] leading-tight text-steel/60" title={reason}>
        {reason}
      </span>
    </div>
  );
}
