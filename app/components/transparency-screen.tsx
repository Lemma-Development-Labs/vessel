"use client";

import { useState } from "react";
import { useVessel } from "@/lib/context";
import { ADDRESSES } from "@/lib/addresses";
import { formatDusd, formatDusd4, formatTs, formatWmon } from "@/lib/format";
import { useNowSec } from "@/lib/now";
import { map2, mapLive, valueOrForLogic } from "@/lib/live";
import { verificationOf } from "@/lib/verification";
import { AddressChip, Badge, Button, Card, Gauge, Skeleton } from "@/components/ui";
import { ChartUnavailable, SourceChip, Unavailable, Val } from "@/components/live";
import { DeployHedgeCta } from "@/components/hedge-cta";
import { UnwindCard } from "@/components/exit-flow";
import type { WaterfallEvent } from "@/lib/provider";

const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER ?? "https://testnet.monadvision.com";

/** One crank interval. Older reads render dim with an age label. */
const STALE_AFTER_SEC = 300;

export function TransparencyScreen() {
  const v = useVessel();
  const nowSec = useNowSec();
  const [freeze, setFreeze] = useState(false);

  const shortId = valueOrForLogic(v.engine.shortId, 0n);
  const undeployed = shortId === 0n;
  const simulated = valueOrForLogic(v.engine.simulated, true);

  if (v.loading) {
    return (
      <div className="mx-auto max-w-[1080px] px-4 py-10 sm:px-5 md:py-14">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-4 h-12 w-full max-w-xl" />
        <Skeleton className="mt-8 h-56 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1080px] px-4 py-10 sm:px-5 md:py-14">
      <p className="num text-[10.5px] tracking-[0.18em] text-steel">TRANSPARENCY</p>
      <h1 className="display mt-3 text-[28px] font-bold leading-[1.04] tracking-[-0.02em] sm:text-[36px] md:text-[44px]">
        The hedge is public, every block.
      </h1>
      <p className="mt-3 max-w-xl text-base text-dim">
        Everything the engine does, visible and live. Demo dollars. Unaudited.
      </p>
      <p className="mt-3 text-sm text-dim">
        Every number on this page is a chain read. Anything we could not read shows as{" "}
        <span className="num text-steel/60">—</span>, never as a zero.
      </p>

      <Card className="mt-10 p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="display text-lg">{undeployed ? "The hedge, pending" : "The hedge, live"}</h2>
            <p className="num mt-1 text-[11.5px] text-steel">
              last update: block{" "}
              <Val of={v.engine.lastBlock}>{(b) => b.toLocaleString()}</Val> ·{" "}
              <Val of={v.engine.lastCrankTs}>
                {(t) => (t > 0n ? `${Math.max(0, nowSec - Number(t))}s ago` : "no crank yet")}
              </Val>
            </p>
          </div>
          {simulated ? <Badge kind="sim" /> : <Badge kind="hedged" />}
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-white/8">
          <HedgeRow
            label="SPOT LEG"
            a={
              <Val of={v.engine.spotQty} nowSec={nowSec} staleAfterSec={STALE_AFTER_SEC}>
                {(q) => `WMON ${formatWmon(q)}`}
              </Val>
            }
            b={
              <Val of={v.engine.spotValue} nowSec={nowSec} staleAfterSec={STALE_AFTER_SEC}>
                {(x) => `value ${formatDusd(x)} dUSD`}
              </Val>
            }
            c={simulated ? "MockRouter" : "DEX router"}
          />
          <HedgeRow
            label="SHORT LEG"
            a={
              <Val of={v.engine.shortNotional} nowSec={nowSec} staleAfterSec={STALE_AFTER_SEC}>
                {(n) => `notional ${formatDusd(n)} dUSD`}
              </Val>
            }
            b={<Val of={v.engine.venueName}>{(n) => n}</Val>}
            c={
              // SimVenue models no margin account, so we do not invent one.
              // The old screen showed "margin = notional / 2", which was a
              // guess presented in the same style as a reading.
              <span className="text-steel/60" title="SimVenue does not expose a margin balance.">
                margin not exposed by venue
              </span>
            }
            amber={simulated}
          />
          <HedgeRow
            label="FUNDING"
            a={
              <Val of={v.engine.fundingAccrued} nowSec={nowSec} staleAfterSec={STALE_AFTER_SEC}>
                {(f) => `accrued ${f >= 0n ? "+" : ""}${formatDusd4(f)} dUSD`}
              </Val>
            }
            b={
              <Val of={v.engine.fundingRateBps}>
                {(r) => `rate ${(Number(r) / 100).toFixed(2)}% APR`}
              </Val>
            }
            phosphor
          />
        </div>

        <div className="mt-6">
          {/* The gauge previously had ±0.03% of random jitter added to make it
              look alive. On the screen whose argument is "watch the hedge",
              synthetic movement on the risk metric is the worst possible
              flourish. It renders the read, or nothing. */}
          {v.engine.netDeltaBps.status === "ok" ? (
            <Gauge pct={Number(v.engine.netDeltaBps.value) / 100} freeze={freeze} />
          ) : (
            <ChartUnavailable
              className="min-h-[64px]"
              reason={`net delta unavailable — ${v.engine.netDeltaBps.reason}`}
            />
          )}
        </div>
      </Card>

      <DeployHedgeCta className="mt-6" />
      <UnwindCard className="mt-6" />

      <Card className="mt-6 p-5 sm:p-6">
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
        <p className="num mt-2 text-center text-[11px] text-steel">
          {v.engine.keeperActive.status === "ok" && v.engine.keeperActive.value ? (
            <>Hosted keeper is configured — see the status page for its last run.</>
          ) : (
            <Unavailable reason={
              v.engine.keeperActive.status === "unavailable"
                ? v.engine.keeperActive.reason
                : "no hosted keeper"
            } />
          )}
        </p>
      </Card>

      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="display text-lg">Waterfall log</h2>
          <SourceChip source={v.historySource} />
        </div>
        <div className="mt-4 flex flex-col gap-4">
          {v.waterfall.length === 0 ? (
            <Card className="px-4 py-10 text-center text-sm text-dim">
              {v.historySource === "none"
                ? "History unavailable — no stats service and the RPC returned no logs."
                : "No settle yet. Crank to see the split."}
            </Card>
          ) : (
            v.waterfall.map((ev, i) => (
              <WaterfallPlay
                key={ev.txHash}
                ev={ev}
                animate={i === 0 && !freeze}
                hullRateLabel={
                  v.deck.hullRateBps.status === "ok"
                    ? `${(Number(v.deck.hullRateBps.value) / 100).toFixed(0)}% APR × TVL × dt`
                    : null
                }
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
              ["Guardian", ADDRESSES.Guardian],
              ["BlitzVault", ADDRESSES.BlitzVault],
              ["Tranches", ADDRESSES.Tranches],
              ["Hull", ADDRESSES.Hull],
              ["Ballast", ADDRESSES.Ballast],
              ["EngineLite", ADDRESSES.EngineLite],
              ["SimVenue", ADDRESSES.SimVenue],
              ["PerplVenue", ADDRESSES.PerplVenue],
              ["MockRouter", ADDRESSES.MockRouter],
              ["MockWMON", ADDRESSES.MockWMON],
            ] as const
          ).map(([name, addr]) => (
            <div
              key={name}
              className="flex flex-col gap-2 border-b border-white/6 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="num text-[11px] tracking-[0.14em] text-steel">{name}</span>
              <div className="flex min-w-0 items-center gap-3">
                <AddressChip address={addr} href={`${EXPLORER}/address/${addr}`} />
                <VerificationMark name={name} address={addr} />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-dim">
          Verification status is per contract, read from a generated manifest — a row shows
          VERIFIED only where a verification run confirmed it. Anything not checked says so.
        </p>
        <p className="mt-3 text-sm text-dim">
          EngineLite is wired to SimVenue + MockRouter. PerplVenue is deployed but not connected.
          Recompute the reads yourself →{" "}
          <a href="https://docs.vessel.wtf/proof-of-hedge" className="text-purple">
            docs.vessel.wtf/proof-of-hedge
          </a>
        </p>
      </section>
    </div>
  );
}

/**
 * Per-contract verification status.
 *
 * Every row used to carry a VERIFIED badge unconditionally, when only DemoUSD's
 * Sourcify verification had ever been confirmed. The badge is now a read of
 * lib/verification.ts (generated by `pnpm verify:manifest`): the `kind` passed
 * to Badge is the manifest's own state, never a literal, so a contract can only
 * be badged verified by a verification run that wrote that state and its
 * timestamp. Everything else renders dim and says which it is.
 */
function VerificationMark({ name, address }: { name: string; address: string }) {
  const entry = verificationOf(name);
  const explorerHref = `${EXPLORER}/address/${address}`;

  if (entry.state === "verified") {
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <Badge kind={entry.state} />
        <a
          href={entry.url ?? explorerHref}
          className="num text-[11px] text-purple"
          title={entry.checkedAt ? `source verified, checked ${entry.checkedAt}` : "source verified"}
        >
          source ↗
        </a>
      </span>
    );
  }

  const label = entry.state === "unverified" ? "unverified" : "not checked";
  const why =
    entry.state === "unverified"
      ? "A verification run reported this contract as not verified."
      : "We have not checked this contract's source verification. Check the explorer.";

  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="num text-[11px] text-steel/60" title={why}>
        {label}
      </span>
      <a
        href={explorerHref}
        className="num text-[11px] text-purple"
        title="Check verification status on the explorer"
      >
        explorer ↗
      </a>
    </span>
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
  a: React.ReactNode;
  b: React.ReactNode;
  c?: React.ReactNode;
  phosphor?: boolean;
  amber?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-white/6 bg-bg px-4 py-3 last:border-b-0 sm:grid-cols-[7rem_1fr_1fr_1fr] sm:items-center">
      <span className="num text-[11px] tracking-[0.14em] text-steel">{label}</span>
      <span className={`num text-[12.5px] ${phosphor ? "text-phosphor" : "text-ink"}`}>{a}</span>
      <span className={`num text-[12.5px] ${amber ? "text-amber" : "text-[#B9C6D4]"}`}>{b}</span>
      <span className="num text-[12.5px] text-[#B9C6D4]">{c}</span>
    </div>
  );
}

function WaterfallPlay({
  ev,
  animate,
  hullRateLabel,
}: {
  ev: WaterfallEvent;
  animate: boolean;
  hullRateLabel: string | null;
}) {
  const negative = ev.gross < 0n;
  const mag = ev.gross < 0n ? -ev.gross : ev.gross;
  const hullShare = mag === 0n ? 0 : Number((ev.hullAccrual * 100n) / mag);

  if (negative) {
    // Width is the real Ballast share of the loss, not a fixed 62% bar.
    const absorbed = ev.fromBallast + ev.fromReserve;
    const balPct = absorbed === 0n ? 0 : Number((ev.fromBallast * 100n) / absorbed);
    return (
      <Card className="overflow-hidden p-4">
        <div className={`h-8 rounded-md bg-red/20 ${animate ? "waterfall-gross" : ""}`}>
          <span className="num px-3 text-[12px] leading-8 text-red">GROSS −{formatDusd4(mag)} dUSD</span>
        </div>
        <div className="mt-3 h-6 overflow-hidden rounded-md bg-brass/40">
          <div className="h-full bg-brass" style={{ width: `${Math.max(2, balPct)}%` }} />
        </div>
        <p className="num mt-2 text-[11px] text-brass">
          absorbed by Ballast {formatDusd4(ev.fromBallast)}
          {ev.fromReserve > 0n ? ` · reserve ${formatDusd4(ev.fromReserve)}` : ""}
        </p>
        <Row ev={ev} />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-4">
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
          style={{ width: `${Math.max(2, hullShare)}%` }}
        />
      </div>
      <p className="num mt-1 text-[11px] text-steel">
        HULL ACCRUAL +{formatDusd4(ev.hullAccrual)}
        {hullRateLabel ? ` (${hullRateLabel})` : ""}
      </p>
      <div className={`mt-2 h-7 rounded-md bg-brass/80 ${animate ? "waterfall-ballast" : ""}`}>
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
      <span>bal {formatDusd4(ev.toBallast > 0n ? ev.toBallast : ev.fromBallast)}</span>
      {ev.txHash ? (
        <a href={`${EXPLORER}/tx/${ev.txHash}`} className="text-purple">
          {ev.blockNumber !== undefined ? `#${ev.blockNumber.toString()}` : "tx"} ↗
        </a>
      ) : null}
    </div>
  );
}

export { map2, mapLive };
