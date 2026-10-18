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

/**
 * Page title in the landing's hero style: a mono kicker, then heavy uppercase lines. `accent`
 * is the last line, set in mint or signal (signal only where Ballast is the subject).
 */
export function PageHead({
  eyebrow,
  title,
  accent,
  tone = "hull",
  children,
}: {
  eyebrow: string;
  title: string;
  accent?: string;
  tone?: "hull" | "ballast";
  children?: ReactNode;
}) {
  return (
    <>
      <p className="num text-[10.5px] tracking-[0.26em] text-steel">{eyebrow}</p>
      <h1 className="display mt-4 text-[clamp(36px,6vw,64px)] leading-[0.92] tracking-[-0.035em] [font-variation-settings:'wdth'_112]">
        <span className="block">{title}</span>
        {accent ? <span className={`block ${tone === "ballast" ? "text-ballast" : "text-hull"}`}>{accent}</span> : null}
      </h1>
      {children ? <div className="mt-6 max-w-[545px] text-[17px] leading-[1.55] text-dim">{children}</div> : null}
    </>
  );
}

export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`num text-[9.5px] tracking-[0.2em] text-steel ${className}`}>{children}</p>;
}

export function TrancheTag({ kind }: { kind: "hull" | "ballast" }) {
  return kind === "hull" ? (
    <span className="num rounded-[2px] border border-hull/40 px-2 py-0.5 text-[10px] tracking-[0.14em] text-hull">HULL</span>
  ) : (
    <span className="num rounded-[2px] border border-ballast/40 px-2 py-0.5 text-[10px] tracking-[0.14em] text-ballast">BALLAST</span>
  );
}

export function TxLink({ hash }: { hash: string }) {
  if (!EXPLORER || !hash.startsWith("0x") || hash.length !== 66) return <span className="num">{hash.slice(0, 10)}…</span>;
  return (
    <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer" className="num text-hull hover:underline">
      {hash.slice(0, 10)}…
    </a>
  );
}

/** Shown on every money screen in mock mode — demo data must never read as chain state. */
export function MockNotice() {
  const v = useBook();
  if (!v.isMock) return null;
  return (
    <p className="num mt-6 inline-flex items-center gap-2 rounded-full border border-amber/40 px-3.5 py-1.5 text-[10px] tracking-[0.22em] text-amber">
      <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden />
      DEMO DATA · NOT CHAIN STATE
    </p>
  );
}
