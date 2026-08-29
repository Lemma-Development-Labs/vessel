"use client";

import { useEffect, useState } from "react";
import { useVessel } from "@/lib/context";
import { ADDRESSES } from "@/lib/addresses";
import { formatDusd, formatDusd4, formatTs, formatWmon, shorten } from "@/lib/format";
import { AddressChip, Badge, Button, Card, Gauge } from "@/components/ui";
import type { WaterfallEvent } from "@/lib/provider";

const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER ?? "https://testnet.monadvision.com";

export function TransparencyScreen() {
  const v = useVessel();
  const [freeze, setFreeze] = useState(false);
  const [lastAnimated, setLastAnimated] = useState<string | null>(null);
  const pct = Number(v.engine.netDeltaBps) / 100;
  const [jitter, setJitter] = useState(0);

  useEffect(() => {
    if (freeze) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;
    const id = window.setInterval(() => {
      setJitter((Math.random() * 2 - 1) * 0.03);
    }, 2000);
    return () => window.clearInterval(id);
  }, [freeze]);

  const latest = v.waterfall[0];
  useEffect(() => {
    if (latest && latest.txHash !== lastAnimated) setLastAnimated(latest.txHash);
  }, [latest, lastAnimated]);

  return (
    <div className="mx-auto max-w-[1080px] px-5 py-10 md:py-14">
      <p className="num text-[10.5px] tracking-[0.18em] text-steel">TRANSPARENCY</p>
      <h1 className="display mt-3 text-[36px] font-bold leading-[1.04] tracking-[-0.02em] md:text-[44px]">
        The hedge is public, every block.
      </h1>
      <p className="mt-3 max-w-xl text-base text-dim">
        Everything the engine does, visible and live. Demo dollars. Unaudited.
      </p>

      <Card className="mt-10 p-6 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="display text-lg">The hedge, live</h2>
            <p className="num mt-1 text-[11.5px] text-steel">
              last update: block {v.engine.lastBlock.toLocaleString()} ·{" "}
              {v.engine.lastCrankTs
                ? `${Math.max(0, Math.floor(Date.now() / 1000 - Number(v.engine.lastCrankTs)))}s ago`
                : "—"}
            </p>
          </div>
          {v.engine.simulated ? <Badge kind="sim" /> : <Badge kind="hedged" />}
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-white/8">
          <HedgeRow
            label="SPOT LEG"
            a={`WMON ${formatWmon(v.engine.spotQty)}`}
            b={`value ${formatDusd(v.engine.spotValue)} dUSD`}
            c="via PuddleSwap"
          />
          <HedgeRow
            label="SHORT LEG"
            a={`notional ${formatDusd(v.engine.shortNotional)} dUSD`}
            b={v.engine.simulated ? "SimVenue" : v.engine.venueName}
            c={`margin ${formatDusd(v.engine.shortNotional / 2n)}`}
            amber={v.engine.simulated}
          />
          <HedgeRow
            label="FUNDING"
            a={`accrued today ${v.engine.fundingAccrued >= 0n ? "+" : ""}${formatDusd4(v.engine.fundingAccrued)} dUSD`}
            b="rate 12.00% APR"
            phosphor
          />
        </div>

        <div className="mt-6">
          <Gauge pct={pct + jitter} freeze={freeze} />
        </div>
      </Card>

      <Card className="mt-6 p-6">
        <Button
          className="w-full py-5 text-[15px] tracking-[0.12em]"
          loading={freeze}
          onClick={() => {
            setFreeze(true);
            void v.crank().finally(() => setFreeze(false));
          }}
        >
          CRANK — settle the waterfall
        </Button>
        <p className="mt-3 text-center text-sm text-dim">
          Anyone can crank. Settlement is a public function.
        </p>
        {v.engine.keeperActive ? (
          <p className="num mt-2 text-center text-[11px] text-steel">
            Auto-crank every 5 min — last by {v.engine.lastCrankBy ? shorten(v.engine.lastCrankBy) : "keeper"}
          </p>
        ) : null}
      </Card>

      <div className="mt-6">
        <h2 className="display text-lg">Waterfall log</h2>
        <div className="mt-4 flex flex-col gap-4">
          {v.waterfall.length === 0 ? (
            <Card className="px-4 py-10 text-center text-sm text-dim">
              No settle yet. Crank to see the split.
            </Card>
          ) : (
            v.waterfall.map((ev, i) => (
              <WaterfallPlay
                key={ev.txHash}
                ev={ev}
                animate={i === 0 && lastAnimated === ev.txHash && !freeze}
              />
            ))
          )}
        </div>
      </div>

      <section id="contracts" className="mt-12">
        <h2 className="display text-lg">Contracts</h2>
        <div className="mt-4 overflow-hidden rounded-2xl border border-line">
          {(
            [
              ["DemoUSD", ADDRESSES.DemoUSD],
              ["BlitzVault", ADDRESSES.BlitzVault],
              ["Tranches", ADDRESSES.Tranches],
              ["Hull", ADDRESSES.Hull],
              ["Ballast", ADDRESSES.Ballast],
              ["EngineLite", ADDRESSES.EngineLite],
              ["SimVenue", ADDRESSES.SimVenue],
            ] as const
          ).map(([name, addr]) => (
            <div
              key={name}
              className="flex flex-col gap-2 border-b border-white/6 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="num text-[11px] tracking-[0.14em] text-steel">{name}</span>
              <div className="flex items-center gap-3">
                <AddressChip address={addr} href={`${EXPLORER}/address/${addr}`} />
                <a href={`${EXPLORER}/address/${addr}`} className="text-phosphor">
                  <Badge kind="verified" />
                </a>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-dim">
          Recompute everything yourself — the exact reads are in the docs →{" "}
          <a href="https://docs.vessel.wtf/proof-of-hedge" className="text-purple">
            docs.vessel.wtf/proof-of-hedge
          </a>
        </p>
      </section>
    </div>
  );
}

function HedgeRow({
  label,
  a,
  b,
  c,
  phosphor,
  amber,
}: {
  label: string;
  a: string;
  b: string;
  c?: string;
  phosphor?: boolean;
  amber?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-white/6 bg-bg px-4 py-3 sm:grid-cols-[7rem_1fr_1fr_1fr] sm:items-center">
      <span className="num text-[11px] tracking-[0.14em] text-steel">{label}</span>
      <span className={`num text-[12.5px] ${phosphor ? "text-phosphor" : "text-ink"}`}>{a}</span>
      <span className={`num text-[12.5px] ${amber ? "text-amber" : "text-[#B9C6D4]"}`}>{b}</span>
      <span className="num text-[12.5px] text-[#B9C6D4]">{c}</span>
    </div>
  );
}

function WaterfallPlay({ ev, animate }: { ev: WaterfallEvent; animate: boolean }) {
  const negative = ev.gross < 0n;
  const mag = ev.gross < 0n ? -ev.gross : ev.gross;
  const hullShare =
    mag === 0n ? 0 : Number((ev.hullAccrual * 100n) / (mag === 0n ? 1n : mag));
  const cls = animate ? "" : "";

  if (negative) {
    return (
      <Card className="overflow-hidden p-4">
        <div className={`h-8 rounded-md bg-red/20 ${animate ? "waterfall-gross" : ""}`}>
          <span className="num px-3 text-[12px] leading-8 text-red">
            GROSS −{formatDusd4(mag)} dUSD
          </span>
        </div>
        <div className="mt-3 h-6 overflow-hidden rounded-md bg-brass/40">
          <div
            className="h-full bg-brass"
            style={{ width: "62%" }}
          />
        </div>
        <p className="num mt-2 text-[11px] text-brass">absorbed by Ballast</p>
        <Row ev={ev} />
      </Card>
    );
  }

  return (
    <Card className={`overflow-hidden p-4 ${cls}`}>
      <div className={`relative h-9 overflow-hidden rounded-md bg-phosphor/20 ${animate ? "waterfall-gross" : ""}`}>
        <span className="num px-3 text-[12px] leading-9">GROSS +{formatDusd4(mag)} dUSD</span>
      </div>
      <div className={`mt-2 flex justify-end ${animate ? "waterfall-fee" : ""}`}>
        <span className="num rounded-md border border-white/10 bg-bg px-2 py-1 text-[11px] text-steel">
          FEE {formatDusd4(ev.fee)} · RESERVE {formatDusd4(ev.toReserve)}
        </span>
      </div>
      <div className="mt-3 h-7 overflow-hidden rounded-md bg-white/5">
        <div
          className={`h-full bg-steel/80 ${animate ? "waterfall-hull" : ""}`}
          style={{ width: `${Math.max(6, hullShare)}%` }}
        />
      </div>
      <p className="num mt-1 text-[11px] text-steel">
        HULL ACCRUAL +{formatDusd4(ev.hullAccrual)} (8% APR × TVL × dt)
      </p>
      <div
        className={`mt-2 h-7 rounded-md bg-brass/80 ${animate ? "waterfall-ballast" : ""}`}
      >
        <span className="num px-3 text-[12px] leading-7 text-[#0A0A14]">
          TO BALLAST +{formatDusd4(ev.toBallast)}
        </span>
      </div>
      <Row ev={ev} />
    </Card>
  );
}

function Row({ ev }: { ev: WaterfallEvent }) {
  return (
    <div className="num mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-steel">
      <span>{formatTs(ev.ts)}</span>
      <span>G {formatDusd4(ev.gross < 0n ? -ev.gross : ev.gross)}</span>
      <span>fee {formatDusd4(ev.fee)}</span>
      <span>hull {formatDusd4(ev.hullAccrual)}</span>
      <span>bal {formatDusd4(ev.toBallast || ev.fromBallast)}</span>
      {ev.txHash ? (
        <a href={`${EXPLORER}/tx/${ev.txHash}`} className="text-purple">
          {ev.blockNumber ? `#${ev.blockNumber.toString()}` : "tx"} ↗
        </a>
      ) : null}
    </div>
  );
}
