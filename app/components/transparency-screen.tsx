"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useVessel } from "@/lib/context";
import { ADDRESSES } from "@/lib/addresses";
import { formatDusd, formatDusd4, formatTs, formatWmon } from "@/lib/format";
import { useNowSec } from "@/lib/now";
import { unavailable, valueOrForLogic, type Live } from "@/lib/live";
import { verificationOf } from "@/lib/verification";
import { netDeltaCastBlock } from "@/lib/cast-verify";
import { bigintEq, compareLive } from "@/lib/disagree";
import { fetchCrankTape, type CrankTapeRow } from "@/lib/envio-tape";
import { fetchKeeperHealth, type KeeperHealth } from "@/lib/keeper-health";
import { defaultSandboxLoss, projectNegativeFunding } from "@/lib/sandbox";
import { AddressChip, Badge, Button, Card, Gauge, Skeleton } from "@/components/ui";
import { ChartUnavailable, SourceChip, Unavailable, Val } from "@/components/live";
import { DeployHedgeCta } from "@/components/hedge-cta";
import { UnwindCard } from "@/components/exit-flow";
import type { WaterfallEvent } from "@/lib/provider";

const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER ?? "https://testnet.monadvision.com";
/** Perpl MON market id (testnet). Documented in Perpl api-docs. */
const PERPL_MON_MARKET_ID = 64;
/** One crank interval — older reads render amber with age. */
const STALE_AFTER_SEC = 300;

export function TransparencyScreen() {
  const v = useVessel();
  const nowSec = useNowSec();
  const search = useSearchParams();
  const accountParam = search.get("account");
  const [freeze, setFreeze] = useState(false);
  const [sandboxOn, setSandboxOn] = useState(false);
  const [copiedCast, setCopiedCast] = useState(false);
  const [keeper, setKeeper] = useState<
    { status: "ok"; value: KeeperHealth } | { status: "unavailable"; reason: string } | null
  >(null);
  const [envioTape, setEnvioTape] = useState<Live<CrankTapeRow[]> | null>(null);

  const shortId = valueOrForLogic(v.engine.shortId, 0n);
  const undeployed = shortId === 0n;
  const simulated = valueOrForLogic(v.engine.simulated, true);

  // Public Perpl position API is not wired for anonymous account reads yet.
  // Surface that honestly so on-chain vs API can disagree when it is.
  const apiNotional: Live<bigint> = unavailable(
    accountParam
      ? `Perpl API position for account ${accountParam} — not wired (no verified public position endpoint)`
      : "Perpl API position — pass ?account= to target a Perpl account; endpoint not verified",
  );
  const disagreement = compareLive(
    v.engine.shortNotional,
    apiNotional,
    bigintEq,
    (n) => formatDusd(n),
  );

  const castBlock = useMemo(() => netDeltaCastBlock(), []);

  useEffect(() => {
    let cancelled = false;
    const pullTape = () => {
      void fetchCrankTape(32).then((tape) => {
        if (!cancelled) setEnvioTape(tape);
      });
    };
    pullTape();
    const id = window.setInterval(pullTape, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      void fetchKeeperHealth().then((h) => {
        if (!cancelled) setKeeper(h);
      });
    };
    pull();
    const id = setInterval(pull, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const sandbox = useMemo(() => {
    if (!sandboxOn) return null;
    // Status guards sit immediately above each .value read (Rule 0).
    if (v.deck.hullTvl.status !== "ok") return null;
    const hull = v.deck.hullTvl.value;
    if (v.deck.balTvl.status !== "ok") return null;
    const bal = v.deck.balTvl.value;
    if (v.deck.reserve.status !== "ok") return null;
    const reserve = v.deck.reserve.value;
    const loss = defaultSandboxLoss(bal);
    return {
      loss,
      live: { hull, bal, reserve },
      projected: projectNegativeFunding({ hullTvl: hull, balTvl: bal, reserve, loss }),
    };
  }, [sandboxOn, v.deck.hullTvl, v.deck.balTvl, v.deck.reserve]);

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
        If you can&apos;t verify the hedge, you don&apos;t own the yield. Demo dollars. Unaudited.
        {accountParam ? (
          <>
            {" "}
            Viewing Perpl account <span className="num text-ink">{accountParam}</span>.
          </>
        ) : (
          <>
            {" "}
            Pass <span className="num">?account=</span> for a standalone Perpl account view.
          </>
        )}
      </p>
      <p className="mt-3 text-sm text-dim">
        Every number on this page is a <span className="num">Live&lt;T&gt;</span> chain or indexer
        read. Anything we could not read shows as{" "}
        <span className="num text-steel/60">—</span>, never as a zero.
      </p>

      {/* 1. Position */}
      <Card className="mt-10 p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="display text-lg">
              {undeployed ? "Position — pending" : "Position — live"}
            </h2>
            <p className="num mt-1 text-[11.5px] text-steel">
              market MON · id {PERPL_MON_MARKET_ID} · block{" "}
              <Val of={v.engine.lastBlock}>{(b) => b.toLocaleString()}</Val> ·{" "}
              <Val of={v.engine.lastCrankTs}>
                {(t) => (t > 0n ? `${Math.max(0, nowSec - Number(t))}s ago` : "no crank yet")}
              </Val>
            </p>
          </div>
          {simulated ? (
            <Badge kind="sim" />
          ) : (
            <Badge kind="hedged" venue={valueOrForLogic(v.engine.venueName, "")} />
          )}
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-white/8">
          <HedgeRow
            label="SPOT"
            a={
              <Val of={v.engine.spotQty} nowSec={nowSec} staleAfterSec={STALE_AFTER_SEC}>
                {(q) => `WMON ${formatWmon(q)}`}
              </Val>
            }
            b={
              <Val of={v.engine.spotValue} nowSec={nowSec} staleAfterSec={STALE_AFTER_SEC}>
                {(x) => `mark ${formatDusd(x)} dUSD`}
              </Val>
            }
            c={
              <span className="text-steel/70">
                source: EngineLite @ {ADDRESSES.EngineLite.slice(0, 8)}…
              </span>
            }
          />
          <HedgeRow
            label="SHORT"
            a={
              <Val of={v.engine.shortNotional} nowSec={nowSec} staleAfterSec={STALE_AFTER_SEC}>
                {(n) => `notional ${formatDusd(n)} dUSD`}
              </Val>
            }
            b={<Val of={v.engine.venueName}>{(n) => n}</Val>}
            c={
              <span className="text-steel/60" title="SimVenue does not expose margin.">
                margin not exposed by venue · shortId{" "}
                <Val of={v.engine.shortId}>{(id) => id.toString()}</Val>
              </span>
            }
            amber={simulated}
          />
          <HedgeRow
            label="FUNDING"
            a={
              <Val of={v.engine.fundingAccrued} nowSec={nowSec} staleAfterSec={STALE_AFTER_SEC}>
                {(f) => `on-chain ${f >= 0n ? "+" : ""}${formatDusd4(f)} dUSD`}
              </Val>
            }
            b={
              <Val of={v.engine.fundingRateBps}>
                {(r) => `rate ${(Number(r) / 100).toFixed(2)}% APR`}
              </Val>
            }
            c={
              <span className="text-steel/60">
                indexer cumulative:{" "}
                <Unavailable reason="Cumulative funding from Envio FundingPrint — UI widget not wired yet; crank tape uses GraphQL. See indexer/schema.graphql." />
              </span>
            }
            phosphor
          />
        </div>

        {disagreement.kind === "disagree" ? (
          <p className="mt-4 rounded-md border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amber">
            On-chain and API disagree: {disagreement.message}. Neither side is silently preferred.
          </p>
        ) : disagreement.kind === "incomplete" ? (
          <p className="mt-4 text-sm text-dim">
            Position cross-check incomplete — {disagreement.reason}
          </p>
        ) : (
          <p className="mt-4 text-sm text-phosphor">On-chain and API notional agree.</p>
        )}

        {/* 2. Net delta */}
        <div className="mt-6">
          <p className="num mb-2 text-[10.5px] tracking-[0.14em] text-steel">NET DELTA</p>
          {v.engine.netDeltaBps.status === "ok" ? (
            <Gauge pct={Number(v.engine.netDeltaBps.value) / 100} freeze={freeze} />
          ) : (
            <ChartUnavailable
              className="min-h-[64px]"
              reason={`net delta unavailable — ${v.engine.netDeltaBps.reason}`}
            />
          )}
          <p className="num mt-2 text-[11px] text-steel">
            absolute:{" "}
            <Val of={v.engine.netDelta} nowSec={nowSec} staleAfterSec={STALE_AFTER_SEC}>
              {(d) => `${formatDusd(d)} dUSD`}
            </Val>
            {" · "}
            published band ±1.00%
          </p>
        </div>

        <p className="mt-4 text-sm text-dim">
          Liquidation band:{" "}
          <span className="text-steel/80">
            not shown — Perpl docs do not publish a liquidation band for this market. Inventing one
            would be the worst failure on a risk page.
          </span>
        </p>
      </Card>

      <Card className="mt-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="display text-lg">Verify net delta</h2>
          <Button
            className="px-3 py-2 text-[12px] tracking-[0.08em]"
            onClick={() => {
              void navigator.clipboard.writeText(castBlock).then(() => {
                setCopiedCast(true);
                setTimeout(() => setCopiedCast(false), 2000);
              });
            }}
          >
            {copiedCast ? "COPIED" : "COPY CAST"}
          </Button>
        </div>
        <p className="mt-2 text-sm text-dim">
          A stranger reproducing the number from two terminal commands is the product.
        </p>
        <pre className="num mt-4 overflow-x-auto rounded-xl border border-line bg-bg2 p-4 text-[11px] leading-relaxed text-steel whitespace-pre-wrap">
          {castBlock}
        </pre>
      </Card>

      {/* 6. Capacity */}
      <Card className="mt-6 p-5 sm:p-6">
        <h2 className="display text-lg">Capacity</h2>
        <p className="mt-2 text-sm text-dim">
          Kuru MON-USDC depth probes (2026-09-04) found an empty ask book — genesis AUM for a live
          spot path is zero until makers return. Utilisation vs the ≤10–20% rule is undefined while
          depth is zero. See{" "}
          <a
            href="https://github.com/Lemma-Development-Labs/vessel/blob/main/docs/CAPACITY.md"
            className="text-purple"
          >
            docs/CAPACITY.md
          </a>
          .
        </p>
        <div className="num mt-4 grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
          <div>
            <p className="text-steel">emptyBook</p>
            <p className="text-amber">true</p>
          </div>
          <div>
            <p className="text-steel">bestAsk</p>
            <p className="text-ink">0</p>
          </div>
          <div>
            <p className="text-steel">1k USDC slip</p>
            <p className="text-steel/60">—</p>
          </div>
          <div>
            <p className="text-steel">genesis AUM</p>
            <p className="text-ink">0</p>
          </div>
        </div>
        <p className="num mt-3 text-[11px] text-steel">
          our short notional:{" "}
          <Val of={v.engine.shortNotional}>{(n) => `${formatDusd(n)} dUSD`}</Val>
          {" · "}
          utilisation:{" "}
          <Unavailable reason="utilisation undefined while Kuru ask book is empty" />
        </p>
      </Card>

      {/* 7. Forced-negative sandbox */}
      <Card className="mt-6 border-amber/40 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="num text-[10.5px] tracking-[0.16em] text-amber">
              SANDBOX — simulated venue, not the live book
            </p>
            <h2 className="display mt-2 text-lg">Forced-negative funding</h2>
            <p className="mt-2 max-w-xl text-sm text-dim">
              Project a negative funding settle against SimVenue maths. Hull principal stays flat;
              Ballast absorbs. Owner-only on chain — this toggle never writes.
            </p>
          </div>
          <Button
            className="px-3 py-2 text-[12px] tracking-[0.08em]"
            onClick={() => setSandboxOn((x) => !x)}
          >
            {sandboxOn ? "HIDE SANDBOX" : "RUN SANDBOX"}
          </Button>
        </div>
        {sandboxOn && !sandbox ? (
          <p className="mt-4 text-sm text-dim">
            Sandbox needs live Hull / Ballast / reserve reads —{" "}
            <Unavailable reason="deck TVL unavailable for sandbox projection" />
          </p>
        ) : null}
        {sandbox ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line p-4">
              <p className="num text-[10.5px] tracking-[0.14em] text-steel">LIVE</p>
              <p className="num mt-3 text-[12px]">Hull {formatDusd(sandbox.live.hull)} dUSD</p>
              <p className="num mt-1 text-[12px]">Ballast {formatDusd(sandbox.live.bal)} dUSD</p>
              <p className="num mt-1 text-[12px]">Reserve {formatDusd(sandbox.live.reserve)} dUSD</p>
            </div>
            <div className="rounded-xl border border-amber/30 bg-amber/5 p-4">
              <p className="num text-[10.5px] tracking-[0.14em] text-amber">
                AFTER −{formatDusd(sandbox.loss)} dUSD FUNDING
              </p>
              <p className="num mt-3 text-[12px] text-phosphor">
                Hull {formatDusd(sandbox.projected.hullTvl)} dUSD (unchanged)
              </p>
              <p className="num mt-1 text-[12px] text-amber">
                Ballast {formatDusd(sandbox.projected.balTvl)} dUSD
              </p>
              <p className="num mt-1 text-[12px]">
                Reserve {formatDusd(sandbox.projected.reserve)} dUSD
              </p>
              <p className="num mt-2 text-[11px] text-steel">
                from Ballast {formatDusd4(sandbox.projected.fromBallast)} · from reserve{" "}
                {formatDusd4(sandbox.projected.fromReserve)}
              </p>
            </div>
          </div>
        ) : null}
      </Card>

      <DeployHedgeCta className="mt-6" />
      <UnwindCard className="mt-6" />

      <Card className="mt-6 p-5 sm:p-6">
        <Button
          className="w-full py-5 text-[15px] tracking-[0.12em]"
          loading={freeze}
          disabled={
            !v.connected ||
            v.wrongNetwork ||
            (v.paused.status === "ok" && v.paused.value)
          }
          tooltip={
            !v.connected
              ? "Connect to crank"
              : v.wrongNetwork
                ? "Switch to Monad testnet first"
                : v.paused.status === "ok" && v.paused.value
                  ? "Guardian pause is on"
                  : undefined
          }
          onClick={() => {
            setFreeze(true);
            void v.crank().finally(() => setFreeze(false));
          }}
        >
          CRANK — settle the waterfall
        </Button>
        <p className="mt-3 text-center text-sm text-dim">
          Anyone can crank when unpaused. Settlement is a public function.
        </p>
      </Card>

      {/* 5. Keeper / CRE health */}
      <Card className="mt-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="display text-lg">Keeper health</h2>
          <span className="num text-[10px] tracking-[0.1em] text-steel">SOURCE · CRE VS KEEPER</span>
        </div>
        <p className="mt-2 text-sm text-dim">
          Polled from <span className="num">NEXT_PUBLIC_KEEPER_URL</span>
          /health — never inferred from silence. A visible halt is trust. CRE
          decisions show source <span className="num">CRE</span>; a CRE halt
          latches the keeper kill switch end-to-end.
        </p>
        {!keeper ? (
          <p className="num mt-4 text-sm text-steel">Reading keeper…</p>
        ) : keeper.status === "unavailable" ? (
          <p className="mt-4 text-sm">
            <Unavailable reason={keeper.reason} />
          </p>
        ) : (
          <div className="num mt-4 grid gap-3 text-[12px] sm:grid-cols-2">
            <div>
              <p className="text-steel">state</p>
              <p className={keeper.value.ok ? "text-phosphor" : "text-amber"}>
                {keeper.value.ok ? "running" : "halted"} — {keeper.value.detail}
              </p>
            </div>
            <div>
              <p className="text-steel">endpoint</p>
              <p className="truncate text-ink">{keeper.value.source}</p>
            </div>
            <div>
              <p className="text-steel">last decision (policy)</p>
              {keeper.value.lastDecision ? (
                <p className="text-ink">
                  <span
                    className={
                      keeper.value.lastDecision.source === "CRE" ? "text-phosphor" : "text-steel"
                    }
                  >
                    [{keeper.value.lastDecision.source ?? "keeper"}]
                  </span>{" "}
                  {keeper.value.lastDecision.kind}: {keeper.value.lastDecision.reason}
                  {keeper.value.lastDecision.dryRun ? " · dry-run" : ""}
                </p>
              ) : (
                <Unavailable reason="no decision recorded yet" />
              )}
            </div>
            <div>
              <p className="text-steel">CRE halt latch</p>
              <p className="text-ink">
                {keeper.value.creHaltLatched ? "armed (killSwitch)" : "clear"}
              </p>
            </div>
            <div>
              <p className="text-steel">uptime / heartbeat</p>
              <p className="text-ink">
                {keeper.value.uptimeMs != null
                  ? `${Math.floor(keeper.value.uptimeMs / 1000)}s`
                  : "—"}
              </p>
            </div>
          </div>
        )}
        <p className="num mt-3 text-[11px] text-steel">
          Provider keeperActive:{" "}
          {v.engine.keeperActive.status === "ok" ? (
            <span className="text-phosphor">{v.engine.keeperActive.value ? "true" : "false"}</span>
          ) : (
            <Unavailable reason={v.engine.keeperActive.reason} />
          )}
        </p>
      </Card>

      {/* 4. Envio crank tape — GraphQL only, never keeper JSON */}
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="display text-lg">Envio crank tape</h2>
          <span className="num text-[10px] tracking-[0.1em] text-steel">GRAPHQL · NOT KEEPER JSON</span>
        </div>
        <Card className="mt-4 px-4 py-6">
          {envioTape == null ? (
            <p className="text-sm text-dim">Loading HyperIndex…</p>
          ) : envioTape.status === "ok" ? (
            envioTape.value.length === 0 ? (
              <p className="text-sm text-dim">
                Indexer reachable — no Crank rows yet (empty tape is honest; not a fabricated zero).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="num text-[10px] tracking-[0.1em] text-steel">
                    <tr>
                      <th className="pb-2 pr-3 font-normal">BLOCK</th>
                      <th className="pb-2 pr-3 font-normal">DECISION</th>
                      <th className="pb-2 pr-3 font-normal">GAS LIMIT</th>
                      <th className="pb-2 pr-3 font-normal">Δ BEFORE</th>
                      <th className="pb-2 pr-3 font-normal">Δ AFTER</th>
                      <th className="pb-2 font-normal">TX</th>
                    </tr>
                  </thead>
                  <tbody>
                    {envioTape.value.map((row) => (
                      <tr key={`${row.txHash}-${row.block}`} className="border-t border-white/6">
                        <td className="num py-2 pr-3">{row.block.toString()}</td>
                        <td className="py-2 pr-3 text-dim">{row.decision}</td>
                        <td className="num py-2 pr-3">{row.gasLimit.toString()}</td>
                        <td className="num py-2 pr-3">{row.deltaBefore.toString()}</td>
                        <td className="num py-2 pr-3">{row.deltaAfter.toString()}</td>
                        <td className="py-2">
                          <a
                            className="num text-phosphor underline-offset-2 hover:underline"
                            href={`${EXPLORER}/tx/${row.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {row.txHash.slice(0, 10)}…
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <Unavailable reason={envioTape.reason} />
          )}
        </Card>
      </div>

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
          Verification status is per contract, read from a generated manifest — a row shows VERIFIED
          only where a verification run confirmed it. Anything not checked says so.
        </p>
        <p className="mt-3 text-sm text-dim">
          EngineLite is wired to SimVenue + MockRouter. PerplVenue is deployed but not connected.
          Explorer: {EXPLORER}
        </p>
      </section>
    </div>
  );
}

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
      <a href={explorerHref} className="num text-[11px] text-purple" title="Check verification on explorer">
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
        <WaterfallMeta ev={ev} />
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
      <WaterfallMeta ev={ev} />
    </Card>
  );
}

function WaterfallMeta({ ev }: { ev: WaterfallEvent }) {
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
