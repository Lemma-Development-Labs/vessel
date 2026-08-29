"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useVessel } from "@/lib/context";
import { type DeckKind, type PositionMeta } from "@/lib/provider";
import { formatDusd, formatDusd4, formatTs } from "@/lib/format";
import { useNowSec } from "@/lib/now";
import { map2, map3, mapLive, valueOrForLogic, type Live } from "@/lib/live";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { ChartUnavailable, Unavailable, Val } from "@/components/live";
import { ExitFlow } from "@/components/exit-flow";
import { ConnectButton } from "@/components/connect";

/** A read older than this renders dim with an age label. One crank interval. */
const STALE_AFTER_SEC = 300;

export function PortfolioScreen() {
  const v = useVessel();
  const nowSec = useNowSec();

  const hullSharesN = valueOrForLogic(v.hullShares, 0n);
  const balSharesN = valueOrForLogic(v.balShares, 0n);
  const empty = hullSharesN === 0n && balSharesN === 0n;

  const lastSettleN = valueOrForLogic(v.deck.lastSettle, 0n);
  const recent = lastSettleN > 0n && nowSec - Number(lastSettleN) < 60;

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
        <EmptyState title="Connect to see your decks" action={<ConnectButton />} />
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

  const tvl = map2(v.deck.hullTvl, v.deck.balTvl, (h, b) => h + b);
  const reservePct = map3(v.deck.reserve, v.deck.hullTvl, v.deck.balTvl, (r, h, b) => {
    const sum = h + b;
    return sum === 0n ? 0 : Number((r * 10_000n) / sum) / 100;
  });
  const targetPct = mapLive(v.deck.reserveTargetBps, (t) => Number(t) / 100);

  return (
    <div className="mx-auto max-w-[1080px] px-4 py-10 sm:px-5 md:py-14">
      <p className="num text-[10.5px] tracking-[0.18em] text-steel">PORTFOLIO</p>
      <h1 className="display mt-3 text-[32px] font-bold tracking-[-0.02em] sm:text-[40px]">
        Your decks
      </h1>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <PositionCard
          deck="hull"
          name="HULL"
          steel
          shares={hullSharesN}
          tvl={v.deck.hullTvl}
          supply={v.deck.hullSupply}
          meta={v.hullMeta}
          nowSec={nowSec}
        />
        <PositionCard
          deck="ballast"
          name="BALLAST"
          steel={false}
          shares={balSharesN}
          tvl={v.deck.balTvl}
          supply={v.deck.balSupply}
          meta={v.balMeta}
          nowSec={nowSec}
        />
      </div>

      <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-line sm:grid-cols-3">
        <div className="bg-bg2 px-5 py-4">
          <p className="num text-[10px] tracking-[0.16em] text-steel">PROTOCOL TVL</p>
          <p className="num mt-1 text-lg">
            <Val of={tvl} nowSec={nowSec} staleAfterSec={STALE_AFTER_SEC}>
              {(x) => `${formatDusd(x)} dUSD`}
            </Val>
          </p>
        </div>
        <div className="bg-bg2 px-5 py-4">
          <p className="num text-[10px] tracking-[0.16em] text-steel">RESERVE vs TARGET</p>
          <p className="num mt-1 text-lg">
            <Val of={map2(reservePct, targetPct, (r, t) => ({ r, t }))}>
              {({ r, t }) => `${r.toFixed(1)}% of ${t.toFixed(1)}% target`}
            </Val>
          </p>
          <div className="mt-2 h-px bg-white/10">
            <Val of={map2(reservePct, targetPct, (r, t) => ({ r, t }))}>
              {({ r, t }) => (
                <span
                  className="block h-px bg-phosphor"
                  style={{ width: `${Math.min(100, (r / Math.max(t, 0.01)) * 100)}%` }}
                />
              )}
            </Val>
          </div>
        </div>
        <div className="bg-bg2 px-5 py-4">
          <p className="num text-[10px] tracking-[0.16em] text-steel">LAST CRANK</p>
          <p className="num mt-1 flex flex-wrap items-center gap-2 text-lg">
            <Val of={v.deck.lastSettle}>{(t) => formatTs(t)}</Val>
            {recent ? <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-phosphor" /> : null}
          </p>
        </div>
      </div>
    </div>
  );
}

function Spark({ points }: { points: number[] }) {
  const path = useMemo(() => {
    if (points.length < 2) return "";
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
  if (!path) return null;
  return (
    <svg viewBox="0 0 120 32" className="h-8 w-full" aria-hidden>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function PositionCard({
  deck,
  name,
  steel,
  shares,
  tvl,
  supply,
  meta,
  nowSec,
}: {
  deck: DeckKind;
  name: string;
  steel: boolean;
  shares: bigint;
  tvl: Live<bigint>;
  supply: Live<bigint>;
  meta: PositionMeta;
  nowSec: number;
}) {
  const [open, setOpen] = useState(false);
  if (shares === 0n) return null;

  const value = map2(tvl, supply, (t, s) => (s === 0n ? 0n : (shares * t) / s));
  const accrued = map2(value, meta.principal, (val, p) => (val > p ? val - p : 0n));

  return (
    <Card accent={steel ? "steel" : "brass"} className="p-5 sm:p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className={`display text-xl tracking-[0.04em] ${steel ? "text-[#C2D2E0]" : "text-brass"}`}>
          {name}
        </h2>
        <p className="num text-[11px] leading-snug text-steel">
          {meta.boardedAt.status === "ok" && meta.boardedAt.value > 0
            ? `Boarded ${formatTs(meta.boardedAt.value)}`
            : "On-chain position"}
        </p>
      </div>

      <div className="mt-5">
        <p className="num text-[10px] tracking-[0.14em] text-steel">VALUE</p>
        <p className="num mt-1 text-lg">
          <Val of={value} nowSec={nowSec} staleAfterSec={STALE_AFTER_SEC}>
            {(x) => `${formatDusd(x)} dUSD`}
          </Val>
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="num text-[10px] tracking-[0.14em] text-steel">PRINCIPAL</p>
          <p className="num mt-1 text-lg">
            <Val of={meta.principal}>{(p) => formatDusd(p)}</Val>
          </p>
        </div>
        <div>
          <p className="num text-[10px] tracking-[0.14em] text-steel">ACCRUED</p>
          <p className="num mt-1 text-lg text-phosphor">
            <Val of={accrued}>{(a) => formatDusd4(a)}</Val>
          </p>
        </div>
      </div>

      <div className={`mt-4 ${steel ? "text-steel" : "text-brass"}`}>
        {meta.spark.status === "ok" ? (
          <Spark points={meta.spark.value} />
        ) : (
          <ChartUnavailable reason={meta.spark.reason} />
        )}
      </div>

      <Button variant="ghost" className="mt-5 w-full" onClick={() => setOpen(true)}>
        Exit deck
      </Button>

      <ExitFlow open={open} onClose={() => setOpen(false)} deck={deck} shares={shares} />
    </Card>
  );
}

export { Unavailable };
