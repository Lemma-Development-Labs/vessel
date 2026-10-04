"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useBook } from "@/lib/book/context";
import { COPY } from "@/lib/copy";
import { PAUSE } from "@/lib/book/types";
import { V2 } from "@/lib/book/release";
import { USE_MOCK } from "@/lib/providers";
import { formatBlock, shorten } from "@/lib/format";
import { AddressChip, Badge } from "@/components/ui";
import { Val } from "@/components/live";
import { mapLive } from "@/lib/live";
import { ConnectButton } from "@/components/connect";
import { useSession } from "@/lib/auth";
import { networkBanner } from "@/lib/banner";
import { TARGET_CHAIN_ID } from "@/lib/wagmi";

function Wordmark() {
  return (
    <Link href="/deposit" className="flex min-w-0 items-center gap-3 text-ink hover:text-ink">
      {/* The Vessel mark: hull circle, waterline, and the plumb in signal. Same paths as vessel.wtf. */}
      <svg width="24" height="24" viewBox="0 0 40 40" fill="none" aria-hidden>
        <circle cx="20" cy="20" r="14.4" stroke="#F4F1EA" strokeWidth="2.6" />
        <path d="M3 20H37" stroke="#F4F1EA" strokeWidth="2.6" />
        <path d="M20 20V34.4" stroke="#FF5B29" strokeWidth="2.6" />
      </svg>
      <span className="num text-[14px] font-semibold tracking-[0.26em] sm:text-[15px]">VESSEL</span>
    </Link>
  );
}

const NAV = [
  { href: "/deposit", label: "Deposit", short: "Deposit", mobile: true },
  { href: "/portfolio", label: "Portfolio", short: "Portfolio", mobile: true },
  { href: "/withdraw", label: "Withdraw", short: "Withdraw", mobile: true },
  { href: "/series", label: "Series", short: "Series", mobile: true },
  { href: "/transparency", label: "Transparency", short: "Proof", mobile: true },
  { href: "/terminal", label: "Terminal", short: "Terminal", mobile: false },
  { href: "/onboarding", label: "Onboarding", short: "Onboarding", mobile: false },
] as const;

const PAUSE_NAMES: [number, string][] = [
  [PAUSE.ADMISSION, "deposits"],
  [PAUSE.RISK_INCREASE, "deployment"],
  [PAUSE.SETTLEMENT, "settlement"],
  [PAUSE.CLAIMS, "claims"],
];

const BANNER = networkBanner(TARGET_CHAIN_ID, process.env.NEXT_PUBLIC_REVIEW_STATUS);

export function AppShell({ children }: { children: React.ReactNode }) {
  const v = useBook();
  const path = usePathname();
  const book = v.book.status === "ok" ? v.book.value : null;
  const engine = v.engine.status === "ok" ? v.engine.value : null;
  const paused = book ? PAUSE_NAMES.filter(([bit]) => book.pausedMask & bit).map(([, n]) => n) : [];
  const { toasts, dismissToast } = v;

  useEffect(() => {
    const timers = toasts
      .filter((t) => t.kind !== "pending")
      .map((t) => setTimeout(() => dismissToast(t.id), 5_000));
    return () => {
      for (const id of timers) clearTimeout(id);
    };
  }, [toasts, dismissToast]);

  return (
    <div className="flex min-h-dvh flex-col">
      <div
        role="note"
        className={`num border-b px-4 py-2 text-center text-[10.5px] uppercase leading-snug tracking-[0.2em] sm:px-5 md:px-7 ${
          BANNER.tone === "mainnet" ? "border-red/40 bg-red/10 text-red" : "border-ink/8 bg-bg/90 text-amber"
        }`}
      >
        <span data-testid="network-banner" className="font-medium">{BANNER.text}</span>
        <span className="hidden text-steel sm:inline">
          {engine === null || engine.simulated ? " · strategy engine simulated" : ""}
        </span>
        {v.reconnecting ? (
          <span className="ml-3 text-steel">reconnecting…</span>
        ) : (
          <span className="ml-3 hidden text-steel sm:inline">
            block{" "}
            <Val of={mapLive(v.clock, (c) => c.number)}>{(b) => formatBlock(b)}</Val>
            {v.isMock ? " · mock" : ""}
          </span>
        )}
      </div>

      <header className="sticky top-0 z-50 border-b border-ink/8 bg-[rgba(5,7,10,0.72)] backdrop-blur-[18px]">
        <div className="mx-auto flex h-[60px] max-w-[1320px] items-center gap-3 px-4 sm:h-[70px] sm:gap-8 sm:px-5 md:px-[30px]">
          <Wordmark />
          <nav className="num hidden h-full items-stretch gap-1 text-[11.5px] uppercase tracking-[0.16em] lg:flex" aria-label="Primary">
            {NAV.map((n) => {
              const on = path === n.href || (n.href === "/deposit" && path === "/");
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`relative whitespace-nowrap px-3 ${n.href === "/onboarding" ? "hidden 2xl:block" : n.href === "/terminal" ? "hidden lg:block" : ""} ${on ? "text-ink" : "text-steel hover:text-hull"}`}
                >
                  <span className="flex h-full items-center">{n.label}</span>
                  {on ? <span className="absolute inset-x-3 bottom-0 h-px bg-ink" /> : null}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
            <a
              href="https://docs.vessel.wtf"
              target="_blank"
              rel="noreferrer"
              className="num hidden text-[11.5px] uppercase tracking-[0.16em] text-steel hover:text-hull xl:inline"
            >
              Docs ↗
            </a>
            {/* Only a read of simulated=false earns the hedged chip; unread, unwired or simulated is SIM. */}
            {engine && !engine.simulated ? <Badge kind="hedged" /> : <Badge kind="sim" />}
            <NetworkPill />
            <SessionChip />
            {v.connected ? (
              <button
                type="button"
                onClick={() => void v.disconnect()}
                className="num min-h-11 max-w-[9.5rem] truncate rounded-[2px] border border-ink/15 px-3 py-1.5 text-[11.5px] text-dim sm:max-w-none"
              >
                {v.address ? shorten(v.address) : "connected"}
              </button>
            ) : (
              <ConnectButton />
            )}
          </div>
        </div>
      </header>

      {v.wrongNetwork ? (
        <div className="mx-auto flex w-full max-w-[1320px] items-center justify-between gap-3 px-4 py-3 sm:px-5 md:px-7">
          <p className="text-sm text-amber">Wrong network — switch</p>
          <button
            type="button"
            onClick={() => void v.switchNetwork()}
            className="min-h-11 rounded-[2px] border border-amber px-3 py-1.5 text-xs text-amber"
          >
            Switch
          </button>
        </div>
      ) : null}

      {book?.impaired ? (
        <div role="alert" className="border-b border-red/40 bg-red/10 px-4 py-3 text-center text-sm text-red sm:px-5">
          {COPY.impair}
        </div>
      ) : null}

      {/* Only assert a pause we actually read; an unread mask asserts nothing. */}
      {paused.length ? (
        <div className="border-b border-amber/30 bg-amber/5 px-4 py-2 text-center text-sm text-amber sm:px-5">
          Guardian pause is on for {paused.join(", ")}. Views still work.
        </div>
      ) : null}

      <main className="mx-auto w-full flex-1">{children}</main>

      <footer className="mt-12 border-t border-ink/8 px-4 py-8 pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-xs text-steel sm:mt-16 sm:px-5 lg:pb-8 md:px-[30px]">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="num flex flex-wrap gap-6 text-[10.5px] uppercase tracking-[0.18em]">
            <Link href="/transparency#contracts" className="hover:text-hull">
              Contracts
            </Link>
            <a href="https://github.com/Lemma-Development-Labs/vessel" className="hover:text-hull">
              GitHub
            </a>
            <a href="https://docs.vessel.wtf" className="hover:text-hull">
              Docs
            </a>
          </div>
          <AddressChip address={V2.TrancheController} href={`https://testnet.monadvision.com/address/${V2.TrancheController}`} />
        </div>
        <p className="mx-auto mt-5 max-w-[1320px] text-[11px] text-[#4E5762]">{COPY.legal}</p>
      </footer>

      <nav
        className="num fixed inset-x-0 bottom-0 z-50 border-t border-ink/8 bg-[rgba(5,7,10,0.92)] pb-[env(safe-area-inset-bottom)] backdrop-blur-[18px] lg:hidden"
        aria-label="Primary"
      >
        <div className="grid grid-cols-5">
          {NAV.filter((n) => n.mobile).map((n) => {
            const on = path === n.href || (n.href === "/deposit" && path === "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex min-h-12 items-center justify-center text-[10px] uppercase tracking-[0.12em] ${on ? "text-ink" : "text-steel"}`}
              >
                {n.short}
              </Link>
            );
          })}
        </div>
      </nav>

      <ToastHost />
    </div>
  );
}

function NetworkPill() {
  const v = useBook();
  if (USE_MOCK) {
    return (
      <span className="num hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-amber/40 px-3 py-1 text-[11px] text-amber xl:inline-flex">
        <span className="h-1.5 w-1.5 rounded-full bg-amber" />
        mock · stage
      </span>
    );
  }
  if (v.wrongNetwork) {
    return (
      <button
        type="button"
        onClick={() => void v.switchNetwork()}
        className="num inline-flex min-h-11 items-center gap-1.5 rounded-full border border-amber px-3 py-1 text-[11px] text-amber"
      >
        Wrong network — switch
      </button>
    );
  }
  const ok = v.connected;
  return (
    <span className="num hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-phosphor/40 px-3 py-1 text-[11px] text-phosphor xl:inline-flex">
      <span className={`h-1.5 w-1.5 rounded-full bg-phosphor ${ok ? "pulse-dot" : ""}`} />
      Monad Testnet
    </span>
  );
}

function ToastHost() {
  const { toasts, dismissToast } = useBook();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 flex max-w-md flex-col gap-2 sm:inset-x-auto sm:right-4 sm:top-20 sm:bottom-auto sm:w-80">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto break-words border bg-panel px-3 py-2 text-sm ${
            t.kind === "error"
              ? "border-red/50 text-red"
              : t.kind === "success"
                ? "border-phosphor/40 text-phosphor"
                : t.kind === "pending"
                  ? "border-hull/40 text-hull"
                  : "border-line"
          }`}
        >
          <div className="flex justify-between gap-2">
            <p className="flex items-center gap-2">
              {t.kind === "pending" ? (
                <span className="spin h-3 w-3 shrink-0 rounded-full border-2 border-current/30 border-t-current" />
              ) : null}
              {t.text}
            </p>
            <button type="button" className="min-h-11 min-w-11 shrink-0 text-steel sm:min-h-0 sm:min-w-0" onClick={() => dismissToast(t.id)}>
              ×
            </button>
          </div>
          {t.href ? (
            <a href={t.href} target="_blank" rel="noreferrer" className="num text-xs text-hull underline">
              View on explorer
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Signed-in state (SIWE session), distinct from merely having a wallet connected. */
function SessionChip() {
  const session = useSession();
  if (!session.data) return null;
  return (
    <Link
      href="/onboarding"
      data-testid="session-chip"
      className="hidden min-h-11 items-center rounded-[2px] border border-ink/15 px-2.5 text-[11px] text-ink sm:inline-flex"
      title={`Signed in as ${session.data.address}`}
    >
      signed in
    </Link>
  );
}
