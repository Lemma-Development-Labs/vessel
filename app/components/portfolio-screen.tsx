"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useVessel } from "@/lib/context";
import { COPY, thetaWouldHold } from "@/lib/provider";
import { formatDusd, formatDusd4, formatTs } from "@/lib/format";
import { useNowSec } from "@/lib/now";
import { Button, Card, EmptyState, Modal, Skeleton, Tooltip } from "@/components/ui";

export function PortfolioScreen() {
  const v = useVessel();
  const nowSec = useNowSec();
  const empty = v.hullShares === 0n && v.balShares === 0n;
  const last = Number(v.deck.lastSettle);
  const recent = last > 0 && nowSec - last < 60;

  if (v.loading) {
    return (
      <div className="mx-auto max-w-[1080px] px-4 py-10 sm:px-5 md:py-14">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-4 h-10 w-48" />
        <Skeleton className="mt-8 h-48 w-full" />
      </div>
    );
  }

  if (!v.connected) {
    return (
      <div className="mx-auto max-w-[1080px] px-4 py-16 sm:px-5">
        <EmptyState
          title="Connect to see your decks"
          action={<Button onClick={() => void v.connect()}>Connect</Button>}
        />
      </div>
    );
  }

  if (empty) {
    return (
      <div className="mx-auto max-w-[1080px] px-4 py-16 sm:px-5">
        <EmptyState
          title="No position yet — board a deck"
          action={
            <Link href="/deposit">
              <Button>Board a deck</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const tvl = v.deck.hullTvl + v.deck.balTvl;
  const reservePct = tvl === 0n ? 0 : Number((v.deck.reserve * 10_000n) / tvl) / 100;
  const targetPct = Number(v.deck.reserveTargetBps) / 100;

  return (
    <div className="mx-auto max-w-[1080px] px-4 py-10 sm:px-5 md:py-14">
      <p className="num text-[10.5px] tracking-[0.18em] text-steel">PORTFOLIO</p>
      <h1 className="display mt-3 text-[32px] font-bold tracking-[-0.02em] sm:text-[40px]">
        Your decks
      </h1>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <PositionCard
          name="HULL"
          steel
          shares={v.hullShares}
          tvl={v.deck.hullTvl}
          supply={v.deck.hullSupply}
          meta={v.hullMeta}
          onExit={(s) => void v.withdraw(s, "hull")}
        />
        <PositionCard
          name="BALLAST"
          steel={false}
          shares={v.balShares}
          tvl={v.deck.balTvl}
          supply={v.deck.balSupply}
          meta={v.balMeta}
          onExit={(s) => void v.withdraw(s, "ballast")}
          exitBlocked={
            v.balShares > 0n &&
            v.deck.balSupply > 0n &&
            !thetaWouldHold(
              v.deck.hullTvl,
              v.deck.balTvl - (v.balShares * v.deck.balTvl) / v.deck.balSupply,
            )
          }
        />
      </div>

      <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-line sm:grid-cols-3">
        <div className="bg-bg2 px-5 py-4">
          <p className="num text-[10px] tracking-[0.16em] text-steel">PROTOCOL TVL</p>
          <p className="num mt-1 text-lg">{formatDusd(tvl)} dUSD</p>
        </div>
        <div className="bg-bg2 px-5 py-4">
          <p className="num text-[10px] tracking-[0.16em] text-steel">RESERVE vs TARGET</p>
          <p className="num mt-1 text-lg">
            {reservePct.toFixed(1)}% of {targetPct.toFixed(1)}% target
          </p>
          <div className="mt-2 h-px bg-white/10">
            <div
              className="h-px bg-phosphor"
              style={{ width: `${Math.min(100, (reservePct / Math.max(targetPct, 0.01)) * 100)}%` }}
            />
          </div>
        </div>
        <div className="bg-bg2 px-5 py-4">
          <p className="num text-[10px] tracking-[0.16em] text-steel">LAST CRANK</p>
          <p className="num mt-1 flex flex-wrap items-center gap-2 text-lg">
            {formatTs(v.deck.lastSettle)}
            {recent ? <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-phosphor" /> : null}
          </p>
        </div>
      </div>
    </div>
  );
}

function Spark({ points }: { points: number[] }) {
  const path = useMemo(() => {
    if (!points.length) return "";
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    return points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * 120;
        const y = 28 - ((p - min) / span) * 24;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }, [points]);
  return (
    <svg viewBox="0 0 120 32" className="h-8 w-full" aria-hidden>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function PositionCard({
  name,
  steel,
  shares,
  tvl,
  supply,
  meta,
  onExit,
  exitBlocked,
}: {
  name: string;
  steel: boolean;
  shares: bigint;
  tvl: bigint;
  supply: bigint;
  meta: { boardedAt: number; principal: bigint; spark: number[] };
  onExit: (shares: bigint) => void;
  exitBlocked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (shares === 0n) return null;
  const value = supply === 0n ? 0n : (shares * tvl) / supply;
  const knownPrincipal = meta.principal > 0n;
  const accrued = knownPrincipal && value > meta.principal ? value - meta.principal : 0n;
  return (
    <Card accent={steel ? "steel" : "brass"} className="p-5 sm:p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className={`display text-xl tracking-[0.04em] ${steel ? "text-[#C2D2E0]" : "text-brass"}`}>
          {name}
        </h2>
        <p className="num text-[11px] leading-snug text-steel">
          {meta.boardedAt ? `Boarded ${formatTs(meta.boardedAt)}` : "On-chain position"}
        </p>
      </div>
      {knownPrincipal ? (
        <div className="mt-5 grid grid-cols-2 gap-4">
          <div>
            <p className="num text-[10px] tracking-[0.14em] text-steel">PRINCIPAL</p>
            <p className="num mt-1 text-lg">{formatDusd(meta.principal)}</p>
          </div>
          <div>
            <p className="num text-[10px] tracking-[0.14em] text-steel">ACCRUED</p>
            <p className="num mt-1 text-lg text-phosphor">{formatDusd4(accrued)}</p>
          </div>
        </div>
      ) : (
        <div className="mt-5">
          <p className="num text-[10px] tracking-[0.14em] text-steel">VALUE</p>
          <p className="num mt-1 text-lg">{formatDusd(value)} dUSD</p>
        </div>
      )}
      {knownPrincipal ? (
        <p className="num mt-4 text-sm text-dim">value {formatDusd(value)} dUSD</p>
      ) : null}
      {meta.spark.length ? (
        <div className={`mt-4 ${steel ? "text-steel" : "text-brass"}`}>
          <Spark points={meta.spark} />
        </div>
      ) : null}
      {exitBlocked ? (
        <Tooltip content={COPY.ballastExit}>
          <div className="mt-5">
            <Button variant="ghost" className="w-full" disabled tooltip={COPY.ballastExit}>
              Exit deck
            </Button>
          </div>
        </Tooltip>
      ) : (
        <Button variant="ghost" className="mt-5 w-full" onClick={() => setOpen(true)}>
          Exit deck
        </Button>
      )}
      <Modal open={open} title={`Exit ${name}`} onClose={() => setOpen(false)}>
        <p className="text-sm text-dim">MAX is selected. This exits the full position.</p>
        <p className="num mt-4 text-2xl">{formatDusd(value)} dUSD</p>
        <Button
          className="mt-6 w-full"
          onClick={() => {
            onExit(shares);
            setOpen(false);
          }}
        >
          Confirm exit
        </Button>
      </Modal>
    </Card>
  );
}
