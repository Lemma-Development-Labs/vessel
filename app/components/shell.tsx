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
    <Link href="/deposit" className="flex min-w-0 items-center gap-2 text-ink sm:gap-2.5">
      <svg width="18" height="18" viewBox="0 0 32 32" fill="none" aria-hidden>
        <circle cx="16" cy="16" r="12" stroke="#8FA6BC" strokeWidth="2.5" />
        <line x1="6" y1="16" x2="26" y2="16" stroke="#EAEEF3" strokeWidth="2.5" />
      </svg>
      <span className="display text-[14px] font-bold tracking-[0.16em] sm:text-[15px] sm:tracking-[0.22em]">
        VESSEL
      </span>
    </Link>
  );
}

const NAV = [
  { href: "/deposit", label: "Deposit", short: "Deposit", mobile: true },
  { href: "/portfolio", label: "Portfolio", short: "Portfolio", mobile: true },
  { href: "/withdraw", label: "Withdraw", short: "Withdraw", mobile: true },
  { href: "/series", label: "Series", short: "Series", mobile: true },
  { href: "/transparency", label: "Transparency", short: "Proof", mobile: true },
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
      <header className="sticky top-0 z-50 border-b border-white/8 bg-[rgba(7,11,16,0.88)] backdrop-blur-[14px]">
        <div className="mx-auto flex h-[56px] max-w-[1280px] items-center gap-3 px-4 sm:h-[60px] sm:gap-6 sm:px-5 md:px-7">
          <Wordmark />
          <nav className="hidden h-full items-stretch gap-1 sm:flex" aria-label="Primary">
            {NAV.map((n) => {
              const on = path === n.href || (n.href === "/deposit" && path === "/");
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`relative px-4 text-sm font-medium ${on ? "text-ink" : "text-steel hover:text-ink"}`}
                >
                  <span className="flex h-full items-center">{n.label}</span>
                  {on ? <span className="absolute inset-x-3 bottom-0 h-0.5 bg-ink" /> : null}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            <a
              href="https://docs.vessel.wtf"
              target="_blank"
              rel="noreferrer"
              className="hidden text-sm text-steel hover:text-purple sm:inline"
            >
              Docs↗
            </a>
            {/* Only a read of simulated=false earns the hedged chip; unread, unwired or simulated is SIM. */}
            {engine && !engine.simulated ? <Badge kind="hedged" /> : <Badge kind="sim" />}
            <NetworkPill />
            <SessionChip />
            {v.connected ? (
              <button
                type="button"
                onClick={() => void v.disconnect()}
                className="num min-h-11 max-w-[9.5rem] truncate rounded-lg border border-white/14 px-3 py-1.5 text-[11.5px] text-[#B9C6D4] sm:max-w-none"
              >
                {v.address ? shorten(v.address) : "connected"}
              </button>
            ) : (
              <ConnectButton className="min-h-11 px-3 py-1.5 text-sm" />
            )}
          </div>
        </div>
      </header>

      <div
        role="note"
        className={`border-b px-4 py-2 text-center text-xs leading-snug sm:px-5 md:px-7 ${
          BANNER.tone === "mainnet" ? "border-red/40 bg-red/10 text-red" : "border-amber/25 bg-amber/10 text-amber"
        }`}
      >
        <span data-testid="network-banner" className="font-semibold tracking-[0.06em]">{BANNER.text}</span>
        <span className="hidden sm:inline">
          {engine === null || engine.simulated ? " Strategy engine is simulated on testnet." : ""}
        </span>
        {v.reconnecting ? (
          <span className="ml-2 text-steel">reconnecting…</span>
        ) : (
          <span className="num ml-2 hidden text-steel sm:inline">
            block{" "}
            <Val of={mapLive(v.clock, (c) => c.number)}>{(b) => formatBlock(b)}</Val>
            {v.isMock ? " · mock" : ""}
          </span>
        )}
      </div>

      {v.wrongNetwork ? (
        <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-3 px-4 py-3 sm:px-5 md:px-7">
          <p className="text-sm text-amber">Wrong network — switch</p>
          <button
            type="button"
            onClick={() => void v.switchNetwork()}
            className="min-h-11 rounded-[10px] border border-amber px-3 py-1.5 text-xs text-amber"
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

      <footer className="mt-12 border-t border-white/8 px-4 py-8 pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-xs text-steel sm:mt-16 sm:px-5 sm:pb-8 md:px-7">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-4">
            <Link href="/transparency#contracts" className="hover:text-purple">
              Contracts
            </Link>
            <a href="https://github.com/Lemma-Development-Labs/vessel" className="hover:text-purple">
              GitHub
            </a>
            <a href="https://docs.vessel.wtf" className="hover:text-purple">
              Docs
            </a>
          </div>
          <AddressChip address={V2.TrancheController} href={`https://testnet.monadvision.com/address/${V2.TrancheController}`} />
        </div>
        <p className="mx-auto mt-4 max-w-[1280px] text-[11px] tracking-wide">{COPY.legal}</p>
      </footer>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-white/8 bg-[rgba(7,11,16,0.94)] pb-[env(safe-area-inset-bottom)] backdrop-blur-[14px] sm:hidden"
        aria-label="Primary"
      >
        <div className="grid grid-cols-5">
          {NAV.filter((n) => n.mobile).map((n) => {
            const on = path === n.href || (n.href === "/deposit" && path === "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex min-h-12 items-center justify-center text-xs ${on ? "text-ink" : "text-steel"}`}
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
      <span className="num hidden items-center gap-1.5 rounded-full border border-amber/40 px-3 py-1 text-[11px] text-amber sm:inline-flex">
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
    <span className="num hidden items-center gap-1.5 rounded-full border border-phosphor/40 px-3 py-1 text-[11px] text-phosphor sm:inline-flex">
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
                  ? "border-purple/40 text-[#B9ADFC]"
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
            <a href={t.href} target="_blank" rel="noreferrer" className="num text-xs text-purple underline">
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
      className="hidden min-h-11 items-center rounded-lg border border-white/14 px-2.5 text-[11px] text-ink sm:inline-flex"
      title={`Signed in as ${session.data.address}`}
    >
      signed in
    </Link>
  );
}
