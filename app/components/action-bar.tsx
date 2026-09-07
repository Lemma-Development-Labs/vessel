"use client";

/**
 * Global action strip — Deposit · Withdraw · Crank · Unwind always reachable.
 * Disabled buttons carry an explicit reason (never hide Unwind).
 */
import Link from "next/link";
import { useState } from "react";
import { useVessel } from "@/lib/context";
import { formatDusd } from "@/lib/format";
import { Button } from "@/components/ui";
import { Unavailable } from "@/components/live";

export function ActionBar({ className = "" }: { className?: string }) {
  const v = useVessel();
  const [busy, setBusy] = useState<"none" | "crank" | "unwind">("none");

  const paused = v.paused.status === "ok" && v.paused.value;
  const deployed =
    v.vault.deployed.status === "ok" ? v.vault.deployed.value : null;
  const nothingDeployed = deployed === 0n;

  const gate =
    !v.connected
      ? "Connect a wallet first"
      : v.wrongNetwork
        ? "Switch to Monad testnet (10143)"
        : undefined;

  const ingressGate =
    gate ??
    (paused ? "Guardian pause is on — deposits / deploy / crank frozen" : undefined);

  const unwindReason =
    gate ??
    (v.vault.deployed.status !== "ok"
      ? `Deployed balance unknown — ${v.vault.deployed.reason}`
      : nothingDeployed
        ? "Nothing deployed — vault cash is already idle"
        : undefined);

  const crankReason = ingressGate;

  return (
    <section
      aria-label="Protocol actions"
      className={`rounded-[var(--radius-card)] border border-line bg-bg2 p-4 sm:p-5 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="num text-[10px] tracking-[0.16em] text-steel">ACTIONS</p>
        <p className="num text-[11px] text-steel">
          deployed:{" "}
          {v.vault.deployed.status === "ok" ? (
            `${formatDusd(v.vault.deployed.value)} dUSD`
          ) : (
            <Unavailable reason={v.vault.deployed.reason} />
          )}
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Link href="/deposit" className="block">
          <Button variant="ghost" className="w-full">
            Deposit
          </Button>
        </Link>
        <Link href="/portfolio" className="block">
          <Button variant="ghost" className="w-full" tooltip="Exit from Book after you board">
            Withdraw
          </Button>
        </Link>
        <Button
          variant="ghost"
          className="w-full"
          loading={busy === "crank"}
          disabled={Boolean(crankReason) || busy !== "none"}
          tooltip={crankReason}
          onClick={() => {
            setBusy("crank");
            void v.crank().finally(() => setBusy("none"));
          }}
        >
          Crank
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          loading={busy === "unwind"}
          disabled={Boolean(unwindReason) || busy !== "none"}
          tooltip={unwindReason}
          onClick={() => {
            setBusy("unwind");
            void v.unwind().finally(() => setBusy("none"));
          }}
        >
          Unwind
        </Button>
      </div>
      {unwindReason && nothingDeployed ? (
        <p className="num mt-2 text-[11px] text-steel">{unwindReason}</p>
      ) : null}
      {paused ? (
        <p className="mt-2 text-xs text-amber">
          Pause freezes joins / deploy / crank. Unwind and exits stay available (emergency egress).
        </p>
      ) : null}
    </section>
  );
}
