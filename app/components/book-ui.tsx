"use client";

import type { ReactNode } from "react";
import { useBook } from "@/lib/book/context";
import { useNowSec } from "@/lib/now";
import { valueOrForLogic } from "@/lib/live";
import { EXPLORER } from "@/lib/wagmi";

/** Seconds → "41h 12m" / "2d 4h" / "12m". Countdown text, mono at the call site. */
export function formatDuration(sec: bigint | number): string {
  const s = Math.max(0, Number(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Client clock for countdowns, falling back to the last chain timestamp before hydration. */
export function useNow(): bigint {
  const v = useBook();
  const n = useNowSec();
  if (n > 0) return BigInt(n);
  return valueOrForLogic(v.clock, { number: 0n, timestamp: 0n }).timestamp;
}

export function PageHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <>
      <p className="num text-[10.5px] tracking-[0.18em] text-steel">{eyebrow}</p>
      <h1 className="display mt-3 text-[32px] font-bold leading-[1.04] tracking-[-0.02em] sm:text-[40px] md:text-[44px]">
        {title}
      </h1>
      {children ? <div className="mt-3 max-w-xl text-base text-dim">{children}</div> : null}
    </>
  );
}

export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`num text-[10.5px] tracking-[0.16em] text-steel ${className}`}>{children}</p>;
}

export function TrancheTag({ kind }: { kind: "hull" | "ballast" }) {
  return kind === "hull" ? (
    <span className="num rounded-[7px] border border-steel/40 px-2 py-0.5 text-[10px] tracking-[0.14em] text-steel">HULL</span>
  ) : (
    <span className="num rounded-[7px] border border-brass/40 px-2 py-0.5 text-[10px] tracking-[0.14em] text-brass">BALLAST</span>
  );
}

export function TxLink({ hash }: { hash: string }) {
  if (!EXPLORER || !hash.startsWith("0x") || hash.length !== 66) return <span className="num">{hash.slice(0, 10)}…</span>;
  return (
    <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer" className="num text-purple hover:underline">
      {hash.slice(0, 10)}…
    </a>
  );
}

/** Shown on every money screen in mock mode — demo data must never read as chain state. */
export function MockNotice() {
  const v = useBook();
  if (!v.isMock) return null;
  return (
    <p className="num mt-4 inline-flex rounded-md border border-amber/30 px-2 py-1 text-[10px] tracking-[0.1em] text-amber">
      demo data · not chain state
    </p>
  );
}
