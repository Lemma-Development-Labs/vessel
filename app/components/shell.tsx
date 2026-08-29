"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useVessel } from "@/lib/context";
import { COPY } from "@/lib/provider";
import { USE_MOCK } from "@/lib/providers";
import { formatBlock, shorten } from "@/lib/format";
import { ADDRESSES } from "@/lib/addresses";
import { AddressChip, Badge } from "@/components/ui";

function Wordmark() {
  return (
    <Link href="/deposit" className="flex items-center gap-2.5 text-ink">
      <svg width="18" height="18" viewBox="0 0 32 32" fill="none" aria-hidden>
        <circle cx="16" cy="16" r="12" stroke="#8FA6BC" strokeWidth="2.5" />
        <line x1="6" y1="16" x2="26" y2="16" stroke="#EAEEF3" strokeWidth="2.5" />
      </svg>
      <span className="display text-[15px] font-bold tracking-[0.22em]">VESSEL</span>
    </Link>
  );
}

const NAV = [
  { href: "/deposit", label: "Deposit" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/transparency", label: "Transparency" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const v = useVessel();
  const path = usePathname();
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
    <div className="flex min-h-full flex-col">
      <nav className="sticky top-0 z-50 border-b border-white/8 bg-[rgba(7,11,16,0.88)] backdrop-blur-[14px]">
        <div className="mx-auto flex h-[60px] max-w-[1280px] items-center gap-6 px-5 md:px-7">
          <Wordmark />
          <div className="hidden h-full items-stretch gap-1 sm:flex">
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
          </div>
          <div className="ml-auto flex items-center gap-3">
            <a
              href="https://docs.vessel.wtf"
              target="_blank"
              rel="noreferrer"
              className="hidden text-sm text-steel hover:text-purple sm:inline"
            >
              Docs↗
            </a>
            {v.engine.simulated ? <Badge kind="sim" /> : <Badge kind="hedged" />}
            <NetworkPill />
            {v.connected ? (
              <button
                type="button"
                onClick={() => void v.disconnect()}
                className="num rounded-lg border border-white/14 px-3 py-1.5 text-[11.5px] text-[#B9C6D4]"
              >
                {v.address ? shorten(v.address) : "connected"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void v.connect()}
                className="rounded-[10px] bg-purple px-3 py-1.5 text-sm font-semibold text-[#0A0A14] hover:bg-[#957FFF]"
              >
                Connect
              </button>
            )}
          </div>
        </div>
        <div className="flex sm:hidden border-t border-white/8">
          {NAV.map((n) => {
            const on = path === n.href || (n.href === "/deposit" && path === "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex-1 py-2 text-center text-xs ${on ? "text-ink" : "text-steel"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-b border-amber/25 bg-amber/10 px-5 py-2 text-center text-xs text-amber md:px-7">
        {COPY.banner}
        {v.engine.simulated ? " Sim badge visible when SimVenue is active." : ""}
        {v.reconnecting ? (
          <span className="ml-2 text-steel">reconnecting…</span>
        ) : (
          <span className="num ml-2 text-steel">
            block {formatBlock(v.engine.lastBlock || 0)}
            {USE_MOCK ? " · mock" : ""}
          </span>
        )}
      </div>

      {v.wrongNetwork ? (
        <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-3 px-5 py-3 md:px-7">
          <p className="text-sm text-amber">Wrong network — switch</p>
          <button
            type="button"
            onClick={() => void v.switchNetwork()}
            className="rounded-[10px] border border-amber px-3 py-1.5 text-xs text-amber"
          >
            Switch
          </button>
        </div>
      ) : null}

      {v.impaired ? (
        <div role="alert" className="border-b border-red/40 bg-red/10 px-5 py-3 text-center text-sm text-red">
          {COPY.impair}
        </div>
      ) : null}

      {v.paused ? (
        <div className="border-b border-amber/30 bg-amber/5 px-5 py-2 text-center text-sm text-amber">
          Guardian pause is on. Views still work; mutative paths are frozen.
        </div>
      ) : null}

      <main className="mx-auto w-full flex-1">{children}</main>

      <footer className="mt-16 border-t border-white/8 px-5 py-8 text-xs text-steel md:px-7">
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
          <AddressChip address={ADDRESSES.EngineLite} href={`https://testnet.monadvision.com/address/${ADDRESSES.EngineLite}`} />
        </div>
        <p className="mx-auto mt-4 max-w-[1280px] text-[11px] tracking-wide">{COPY.legal}</p>
      </footer>

      <ToastHost />
    </div>
  );
}

function NetworkPill() {
  const v = useVessel();
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
        className="num inline-flex items-center gap-1.5 rounded-full border border-amber px-3 py-1 text-[11px] text-amber"
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
  const { toasts, dismissToast } = useVessel();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-20 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto border bg-panel px-3 py-2 text-sm ${
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
                <span className="spin h-3 w-3 rounded-full border-2 border-current/30 border-t-current" />
              ) : null}
              {t.text}
            </p>
            <button type="button" className="text-steel" onClick={() => dismissToast(t.id)}>
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
