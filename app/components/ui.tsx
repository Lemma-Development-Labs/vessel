"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  tooltip?: string;
};

const variants: Record<Variant, string> = {
  primary:
    "border-none bg-purple text-[#0A0A14] hover:bg-[#957FFF] disabled:hover:bg-purple",
  ghost:
    "bg-transparent border border-white/20 text-ink hover:border-ink hover:bg-white/[0.04]",
  danger: "bg-transparent border border-red/50 text-red hover:bg-red/10",
};

export function Button({
  variant = "primary",
  loading,
  tooltip,
  disabled,
  children,
  className = "",
  ...rest
}: Props) {
  const isDisabled = disabled || loading;
  const btn = (
    <button
      type="button"
      disabled={isDisabled}
      title={tooltip}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
      {...rest}
    >
      {loading ? (
        <>
          <span className="spin h-3.5 w-3.5 rounded-full border-2 border-current/30 border-t-current" />
          <span className="sr-only">Loading</span>
        </>
      ) : (
        children
      )}
    </button>
  );
  if (tooltip && isDisabled) {
    return (
      <span className="group relative inline-flex w-full" title={tooltip}>
        {btn}
        <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 hidden w-[min(16rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-line bg-panel px-3 py-2 text-left text-xs font-normal text-dim shadow-none group-hover:block group-focus-within:block">
          {tooltip}
        </span>
      </span>
    );
  }
  return btn;
}

export function Card({
  children,
  className = "",
  accent,
}: {
  children: ReactNode;
  className?: string;
  accent?: "steel" | "brass" | "line";
}) {
  const ring =
    accent === "steel"
      ? "border-steel/30"
      : accent === "brass"
        ? "border-brass/30"
        : "border-line";
  return (
    <div className={`rounded-[var(--radius-card)] border bg-bg2 ${ring} ${className}`}>
      {children}
    </div>
  );
}

export function StatBlock({
  label,
  value,
  delta,
  tone = "ink",
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "ink" | "phosphor" | "brass" | "red" | "steel";
}) {
  const color =
    tone === "phosphor"
      ? "text-phosphor"
      : tone === "brass"
        ? "text-brass"
        : tone === "red"
          ? "text-red"
          : tone === "steel"
            ? "text-steel"
            : "text-ink";
  return (
    <div className="flex min-w-[120px] flex-col gap-1.5 bg-bg2 px-5 py-4 sm:min-w-[150px]">
      <span className="num text-[10px] uppercase tracking-[0.16em] text-steel">{label}</span>
      <span className={`num text-lg ${color}`}>{value}</span>
      {delta ? <span className="num text-[11px] text-phosphor">{delta}</span> : null}
    </div>
  );
}

export function Badge({
  kind,
  compact,
  venue,
}: {
  kind: "testnet" | "sim" | "verified" | "hedged";
  compact?: boolean;
  /**
   * Venue name as READ FROM CHAIN. The hedged badge used to hardcode
   * "HEDGED ON PERPL TESTNET" — a venue this protocol has never been wired to.
   * It shipped in the bundle and would have rendered the moment any
   * non-simulated venue was connected. The badge now states the venue it was
   * told about, or nothing.
   */
  venue?: string;
}) {
  if (kind === "testnet") {
    return (
      <span className="num inline-flex items-center gap-1.5 rounded-[7px] border border-brass/35 px-2.5 py-1 text-[10.5px] tracking-[0.14em] text-brass">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-brass" />
        TESTNET
      </span>
    );
  }
  if (kind === "sim") {
    return (
      <span className="num inline-flex max-w-full items-center gap-1.5 rounded-[7px] border border-amber/50 px-2 py-1 text-[10.5px] tracking-[0.12em] text-amber sm:px-2.5">
        {compact ? (
          "SIM"
        ) : (
          <>
            <span className="sm:hidden">SIM</span>
            <span className="hidden sm:inline">SIM VENUE — Perpl next</span>
          </>
        )}
      </span>
    );
  }
  if (kind === "hedged") {
    return (
      <span className="num inline-flex items-center gap-1.5 rounded-[7px] border border-phosphor/40 px-2 py-1 text-[10.5px] tracking-[0.12em] text-phosphor sm:px-2.5">
        <span className="h-1.5 w-1.5 rounded-full bg-phosphor" />
        <span className="sm:hidden">HEDGED</span>
        <span className="hidden sm:inline">
          {venue ? `HEDGED ON ${venue.toUpperCase()}` : "HEDGED"}
        </span>
      </span>
    );
  }
  return (
    <span className="num inline-flex items-center gap-1.5 text-[11px] tracking-[0.1em] text-phosphor">
      <span className="h-1.5 w-1.5 rounded-full bg-phosphor" />
      VERIFIED
    </span>
  );
}

export function AddressChip({
  address,
  href,
}: {
  address: string;
  href?: string;
}) {
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      /* ignore */
    }
  }
  return (
    <span className="num inline-flex items-center gap-1.5 rounded-lg border border-white/14 px-3 py-1.5 text-[11.5px] text-[#B9C6D4]">
      <button type="button" onClick={() => void copy()} className="hover:text-ink">
        {short}
      </button>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-purple" aria-label="Open in explorer">
          ↗
        </a>
      ) : null}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} />;
}

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 hidden w-[min(16rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-line bg-panel px-3 py-2 text-xs text-dim group-hover:block group-focus-within:block">
        {content}
      </span>
    </span>
  );
}

export function EmptyState({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
        <circle cx="16" cy="16" r="12" stroke="#8FA6BC" strokeWidth="2.5" />
        <line x1="6" y1="16" x2="26" y2="16" stroke="#EAEEF3" strokeWidth="2.5" />
      </svg>
      <p className="display text-lg text-ink">{title}</p>
      {action}
    </Card>
  );
}

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal>
      <div className="mb-[env(safe-area-inset-bottom)] max-h-[min(90dvh,36rem)] w-full max-w-md overflow-y-auto rounded-[var(--radius-modal)] border border-line bg-panel p-6 sm:mb-0">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="display text-lg">{title}</h2>
          <button type="button" onClick={onClose} className="text-steel hover:text-ink">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`relative px-4 py-2 text-sm ${value === t.id ? "text-ink" : "text-steel hover:text-ink"}`}
        >
          {t.label}
          {value === t.id ? <span className="absolute inset-x-3 bottom-0 h-0.5 bg-ink" /> : null}
        </button>
      ))}
    </div>
  );
}

export function Gauge({
  pct,
  freeze,
}: {
  pct: number;
  freeze?: boolean;
}) {
  const band = 1;
  const clamped = Math.max(-2, Math.min(2, pct));
  const pos = ((clamped + 2) / 4) * 100;
  const inside = Math.abs(pct) <= band;
  const color = inside ? "var(--phosphor)" : "var(--amber)";
  const label = inside
    ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% — inside band`
    : `${pct.toFixed(2)}% — rebalance pending`;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative h-[74px] w-full overflow-hidden rounded-xl border border-white/8 bg-bg">
        <div
          className="absolute inset-y-0"
          style={{
            left: "25%",
            right: "25%",
            background: "rgba(53,214,153,0.06)",
            borderLeft: "1px solid rgba(53,214,153,0.18)",
            borderRight: "1px solid rgba(53,214,153,0.18)",
          }}
        />
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/14" />
        <div className="absolute inset-y-3 left-1/2 w-px bg-white/35" />
        <div
          className={`gauge-needle absolute top-2 bottom-2 w-0.5 ${freeze ? "" : "transition-[left] duration-[2000ms] ease-in-out"}`}
          style={{ left: `${pos}%`, background: color }}
        />
        <span className="num absolute bottom-2 left-3 text-[10px] tracking-[0.1em] text-steel/70">−1.0%</span>
        <span className="num absolute bottom-2 right-3 text-[10px] tracking-[0.1em] text-steel/70">+1.0%</span>
        <span className="num absolute left-1/2 top-2 -translate-x-1/2 text-[10px] tracking-[0.1em] text-white/50">
          0
        </span>
      </div>
      <p className="num shrink-0 text-sm" style={{ color }}>
        {label}
      </p>
    </div>
  );
}
