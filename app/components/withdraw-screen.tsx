"use client";

import Link from "next/link";
import { useState } from "react";
import { useBook } from "@/lib/book/context";
import { exitPhase, freeBallastUnits, previewAssets, previewUnits, withSlippage } from "@/lib/book/plan";
import { PAUSE, RULES, type ExitRequest } from "@/lib/book/types";
import { COPY } from "@/lib/copy";
import { formatDusd, formatDusd4, formatShares, formatTs, parseDusd } from "@/lib/format";
import { mapLive } from "@/lib/live";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { Val } from "@/components/live";
import { ConnectButton } from "@/components/connect";
import { MockNotice, PageHead, SectionLabel, formatDuration, useNow } from "@/components/book-ui";

export function WithdrawScreen() {
  const v = useBook();
  const now = useNow();
  const [amt, setAmt] = useState("");
  const [all, setAll] = useState(false);

  if (v.loading) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-5 md:py-14">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-10 w-56" />
        <Skeleton className="mt-8 h-40 w-full" />
      </div>
    );
  }
  if (!v.connected) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16 sm:px-5">
        <EmptyState title="Connect to withdraw" action={<ConnectButton />} />
      </div>
    );
  }

  const w = v.wallet.status === "ok" ? v.wallet.value : null;
  const b = v.book.status === "ok" ? v.book.value : null;
  const validShape = /^\d+(\.\d{0,6})?$/.test(amt.trim());
  const assets = validShape ? parseDusd(amt) : 0n;
  // Units to lock: everything free when MAX was chosen, else the units this dUSD amount buys back.
  let units = 0n;
  const free = w ? freeBallastUnits(w) : 0n;
  if (w && b) units = all ? free : assets > 0n ? previewUnits(assets, b) : 0n;
  if (units > free) units = free;
  const expected = b ? previewAssets(units, b) : 0n;

  const blocked = !w || !b
    ? (v.wallet.status !== "ok" ? v.wallet.reason : v.book.status !== "ok" ? v.book.reason : "reading…")
    : units === 0n
      ? "Enter an amount"
      : b.impaired
        ? COPY.impair
        : v.wrongNetwork
          ? "Switch to Monad testnet first"
          : null;

  return (
    <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-5 md:py-14">
      <PageHead eyebrow="03 — WITHDRAW" title="Leave" accent="Ballast." tone="ballast">
        An exit locks your units and starts a 48-hour cooldown. After that it is filled in
        request order as idle liquidity and Hull&apos;s 30% cover allow — possibly in parts.
        Units stay exposed to profit and loss until they are filled.
      </PageHead>
      <MockNotice />

      <Card accent="ballast" className="mt-8 grid gap-4 p-5 sm:grid-cols-3">
        <div>
          <SectionLabel>FREE UNITS</SectionLabel>
          <p className="num mt-1 text-lg">
            <Val of={mapLive(v.wallet, freeBallastUnits)}>{(u) => formatShares(u)}</Val>
          </p>
        </div>
        <div>
          <SectionLabel>LOCKED IN EXITS</SectionLabel>
          <p className="num mt-1 text-lg">
            <Val of={mapLive(v.wallet, (x) => x.ballastLocked)}>{(u) => formatShares(u)}</Val>
          </p>
        </div>
        <div>
          <SectionLabel>TOTAL VALUE NOW</SectionLabel>
          <p className="num mt-1 text-lg">
            <Val of={mapLive(v.wallet, (x) => x.ballastValue)}>{(x) => `${formatDusd(x)} dUSD`}</Val>
          </p>
        </div>
      </Card>

      <div className="mt-8 border-b border-ink/12 pb-4">
        <div className="flex items-center justify-between">
          <SectionLabel>AMOUNT (dUSD)</SectionLabel>
          <button
            type="button"
            className="num min-h-11 text-[11px] text-hull disabled:opacity-40"
            disabled={free === 0n}
            onClick={() => {
              setAll(true);
              if (b) setAmt(formatDusd(previewAssets(free, b)).replace(/,/g, ""));
            }}
          >
            MAX
          </button>
        </div>
        <input
          value={amt}
          onChange={(e) => {
            setAll(false);
            setAmt(e.target.value);
          }}
          inputMode="decimal"
          placeholder="0.00"
          aria-label="Exit amount in dUSD"
          className="num mt-2 w-full bg-transparent text-[clamp(1.75rem,10vw,2.5rem)] tracking-[-0.01em] outline-none"
        />
        <p className="num mt-2 text-sm text-dim">
          Locks {formatShares(units)} units · worth ≈ {formatDusd(expected)} dUSD today · minimum accepted{" "}
          {formatDusd(withSlippage(expected))} dUSD
        </p>
      </div>

      <Card className="mt-6 p-6">
        {b && b.pausedMask & PAUSE.SETTLEMENT ? (
          <p className="mb-3 text-sm text-amber">Settlement is paused — exits can be requested but will not fill until it resumes.</p>
        ) : null}
        <Button
          className="w-full"
          disabled={blocked !== null}
          tooltip={blocked ?? undefined}
          onClick={() => {
            void v.requestRedeem(units, withSlippage(expected)).then((sent) => {
              if (sent) {
                setAmt("");
                setAll(false);
              }
            });
          }}
        >
          Request exit
        </Button>
        {b && b.hullNav > 0n && b.coverBps < RULES.COVER_TARGET_BPS ? (
          <p className="mt-3 text-[12.5px] text-amber">{COPY.ballastExit}</p>
        ) : null}
      </Card>

      <section className="mt-10">
        <h2 className="display text-xl">Your exits</h2>
        <Val of={v.myExits}>
          {(es) =>
            es.length === 0 ? (
              <Card className="mt-4 p-5">
                <p className="text-sm text-dim">No exit requests.</p>
              </Card>
            ) : (
              <div className="mt-4 grid gap-3">
                {es.map((e) => (
                  <ExitRow key={e.id.toString()} e={e} now={now} />
                ))}
              </div>
            )
          }
        </Val>
      </section>

      <Card accent="hull" className="mt-10 p-5">
        <p className="text-sm text-dim">
          <span className="text-hull">Hull</span> has no early exit: each series pays principal and coupon at
          maturity, and you claim it from escrow on the{" "}
          <Link href="/portfolio" className="text-hull hover:underline">
            Portfolio
          </Link>{" "}
          page.
        </p>
      </Card>
    </div>
  );
}

function ExitRow({ e, now }: { e: ExitRequest; now: bigint }) {
  const v = useBook();
  const [busy, setBusy] = useState(false);
  const phase = exitPhase(e, now);
  const run = (fn: () => Promise<boolean>) => {
    setBusy(true);
    void fn().finally(() => setBusy(false));
  };
  const label =
    phase.kind === "cooling"
      ? `Cooling down — ${formatDuration(phase.secondsLeft)} left`
      : phase.kind === "queued"
        ? phase.partial
          ? "Partly filled — rest waits for liquidity and cover"
          : "In queue — fills as liquidity and cover allow"
        : phase.kind === "claimable"
          ? "Filled — ready to claim"
          : phase.kind === "done"
            ? "Paid out"
            : "Cancelled";
  const tone = phase.kind === "claimable" ? "text-phosphor" : phase.kind === "cancelled" ? "text-steel" : "text-ink";
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="num text-sm">Exit #{e.id.toString()}</p>
        <p className={`text-sm ${tone}`}>{label}</p>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <SectionLabel>REQUESTED</SectionLabel>
          <p className="num mt-1 text-[13px]">{formatTs(e.requestedAt)}</p>
        </div>
        <div>
          <SectionLabel>UNITS LEFT</SectionLabel>
          <p className="num mt-1 text-[13px]">{formatShares(e.units)}</p>
        </div>
        <div>
          <SectionLabel>PAID SO FAR</SectionLabel>
          <p className="num mt-1 text-[13px]">{formatDusd4(e.funded)}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2 empty:hidden">
        {phase.kind === "claimable" ? (
          <Button loading={busy} onClick={() => run(() => v.claimExit(e.id))}>
            Claim {formatDusd(phase.amount)}
          </Button>
        ) : null}
        {e.status === "COOLING" && e.units > 0n ? (
          <Button variant="ghost" loading={busy} onClick={() => run(() => v.cancelRedeem(e.id))}>
            Cancel
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
