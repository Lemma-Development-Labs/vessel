"use client";

import { useVessel } from "@/lib/context";
import { COPY } from "@/lib/provider";
import { formatBps, formatDelta, formatDusd, formatShares, formatTs, parseDusd, shorten } from "@/lib/format";
import { USE_MOCK } from "@/lib/providers";
import { CHAIN_ID } from "@/lib/addresses";
import { useEffect, useState } from "react";

export function Dashboard() {
  const v = useVessel();
  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-6 px-5 py-6">
      <Header />
      {v.wrongNetwork && <WrongNetwork />}
      {v.impaired && (
        <div
          role="alert"
          className="border border-impair/40 bg-impair/10 px-4 py-3 text-sm text-impair"
        >
          {COPY.impair}
        </div>
      )}
      {v.paused && (
        <div className="border border-sim/30 bg-sim/10 px-4 py-2 text-sm text-sim">
          Guardian pause is on. Views still work; mutative paths are frozen.
        </div>
      )}
      <Hero />
      <Honesty />
      <Stats />
      <div className="grid gap-4 lg:grid-cols-2">
        <Deck
          role="Hull"
          color="hull"
          tvl={v.deck.hullTvl}
          shares={v.hullShares}
          onJoin={(n) => v.joinHull(n)}
          onExit={(s) => v.exitHull(s)}
          hint="Senior. Target 8% from the waterfall. Do not join until Ballast is ≥ 20% of deck TVL."
        />
        <Deck
          role="Ballast"
          color="ballast"
          tvl={v.deck.balTvl}
          shares={v.balShares}
          onJoin={(n) => v.joinBallast(n)}
          onExit={(s) => v.exitBallast(s)}
          hint={COPY.floor}
        />
      </div>
      <EnginePanel />
      <Waterfall />
      <Toasts />
    </div>
  );
}

function Header() {
  const v = useVessel();
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
      <div>
        <p className="text-[11px] tracking-[0.28em] text-muted uppercase">Vessel</p>
        <p className="text-sm text-muted">testnet.vessel.wtf</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`num text-xs ${v.reconnecting ? "text-sim" : "text-real"}`}>
          {v.reconnecting ? "reconnecting…" : `block · chain ${v.chainId || CHAIN_ID}`}
        </span>
        <NetworkPill />
        {v.connected ? (
          <button
            type="button"
            onClick={() => v.disconnect()}
            className="num border border-line px-3 py-1.5 text-xs text-muted hover:border-ink"
          >
            {v.address ? shorten(v.address) : "connected"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => v.connect()}
            className="border border-hull bg-hull/10 px-3 py-1.5 text-xs text-hull"
          >
            Connect
          </button>
        )}
      </div>
    </header>
  );
}

function NetworkPill() {
  const v = useVessel();
  const label = USE_MOCK
    ? "mock · stage"
    : v.wrongNetwork
      ? "wrong network"
      : v.chainId === 10143
        ? "Monad Testnet"
        : v.chainId === 31337
          ? "Anvil"
          : `chain ${v.chainId}`;
  return (
    <button
      type="button"
      onClick={() => {
        if (v.wrongNetwork) v.switchNetwork();
      }}
      className={`num rounded-full border px-3 py-1 text-[11px] ${
        v.wrongNetwork
          ? "border-impair text-impair"
          : USE_MOCK
            ? "border-sim/50 text-sim"
            : "border-real/40 text-real"
      }`}
    >
      {label}
    </button>
  );
}

function WrongNetwork() {
  const v = useVessel();
  return (
    <div className="flex items-center justify-between gap-3 border border-impair/40 bg-impair/10 px-4 py-3">
      <p className="text-sm">Wallet is on the wrong chain. Switch to the Vessel network to transact.</p>
      <button
        type="button"
        onClick={() => v.switchNetwork()}
        className="border border-impair px-3 py-1 text-xs text-impair"
      >
        Switch network
      </button>
    </div>
  );
}

function Hero() {
  const v = useVessel();
  return (
    <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="max-w-xl text-3xl font-semibold tracking-tight md:text-4xl">
          The dollar leverage pays for.
        </h1>
        <p className="mt-2 max-w-lg text-sm text-muted">
          Hull takes a senior 8%. Ballast eats first loss. The short leg is behind{" "}
          <span className="num text-sim">IVenue</span> — today that is SimVenue.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => v.faucet()}
          className="border border-line px-4 py-2 text-sm hover:border-hull hover:text-hull"
        >
          Faucet 100 dUSD
        </button>
        <button
          type="button"
          onClick={() => v.crank()}
          className="border border-real/40 bg-real/10 px-4 py-2 text-sm text-real"
        >
          Crank
        </button>
      </div>
    </section>
  );
}

function Honesty() {
  const v = useVessel();
  return (
    <div className="flex flex-wrap items-center gap-3 border border-line bg-panel px-4 py-3 text-sm">
      <span
        className={`num rounded-full border px-2 py-0.5 text-[11px] ${
          v.engine.simulated ? "border-sim text-sim" : "border-real text-real"
        }`}
      >
        {v.engine.simulated ? "SIMULATED VENUE" : "LIVE VENUE"}
      </span>
      <span className="num text-muted">{v.engine.venueName}</span>
      <span className="text-muted">
        Spot + vault + waterfall accounting are on-chain. Short-leg funding is a transparent
        simulation until PerplVenue is wired.
      </span>
      <span className="num ml-auto text-xs text-muted" title={COPY.floor}>
        floor {formatBps(v.deck.thetaBps)} / 20.00%
      </span>
    </div>
  );
}

function Stats() {
  const v = useVessel();
  const tvl = v.deck.hullTvl + v.deck.balTvl;
  const floorPct = tvl === 0n ? 0 : Number((v.deck.balTvl * 10_000n) / tvl) / 100;
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <Stat label="Wallet dUSD" value={formatDusd(v.dusdBalance)} />
      <Stat label="Deck TVL" value={formatDusd(tvl)} />
      <Stat label="Reserve" value={formatDusd(v.deck.reserve)} />
      <Stat label="Last settle" value={formatTs(v.deck.lastSettle)} />
      <div className="sm:col-span-4">
        <div className="mb-1 flex justify-between text-[11px] uppercase tracking-wider text-muted">
          <span title={COPY.floor}>Subordination</span>
          <span className="num">{floorPct.toFixed(2)}% Ballast</span>
        </div>
        <div className="h-1.5 overflow-hidden bg-line">
          <div
            className={`h-full ${floorPct >= 20 ? "bg-ballast" : "bg-impair"}`}
            style={{ width: `${Math.min(100, floorPct)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line bg-panel px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className="num mt-1 text-lg">{value}</p>
    </div>
  );
}

function Deck({
  role,
  color,
  tvl,
  shares,
  onJoin,
  onExit,
  hint,
}: {
  role: "Hull" | "Ballast";
  color: "hull" | "ballast";
  tvl: bigint;
  shares: bigint;
  onJoin: (assets: bigint) => Promise<void>;
  onExit: (shares: bigint) => Promise<void>;
  hint: string;
}) {
  const [amt, setAmt] = useState("20");
  const accent = color === "hull" ? "border-l-hull" : "border-l-ballast";
  const text = color === "hull" ? "text-hull" : "text-ballast";
  return (
    <section className={`border border-line border-l-4 ${accent} bg-panel p-4`}>
      <div className="flex items-baseline justify-between">
        <h2 className={`text-lg ${text}`}>{role}</h2>
        <p className="num text-sm">{formatDusd(tvl)} dUSD</p>
      </div>
      <p className="mt-2 text-xs text-muted" title={hint}>
        {hint}
      </p>
      <p className="num mt-3 text-xs text-muted">your shares {formatShares(shares)}</p>
      <div className="mt-4 flex gap-2">
        <input
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          inputMode="decimal"
          aria-label={`${role} amount`}
          className="num w-28 border border-line bg-bg px-2 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => onJoin(parseDusd(amt))}
          className={`border px-3 py-2 text-sm ${color === "hull" ? "border-hull/50 text-hull" : "border-ballast/50 text-ballast"}`}
        >
          Join
        </button>
        <button
          type="button"
          onClick={() => onExit(shares)}
          disabled={shares === 0n}
          className="border border-line px-3 py-2 text-sm text-muted disabled:opacity-40"
        >
          Exit all
        </button>
      </div>
    </section>
  );
}

function EnginePanel() {
  const v = useVessel();
  return (
    <section className="border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm uppercase tracking-wider text-muted">Engine</h2>
          <p className="num mt-1 text-lg">
            net Δ {formatDelta(v.engine.netDelta)} dUSD{" "}
            <span className="text-sm text-muted">{v.engine.netDeltaBps.toString()} bps</span>
          </p>
          <p className="num mt-1 text-xs text-muted">
            short #{v.engine.shortId.toString()} · {USE_MOCK ? "mock book" : "on-chain"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => v.deployLiquidity()}
          disabled={v.engine.shortId !== 0n}
          className="border border-line px-3 py-2 text-sm disabled:opacity-40"
        >
          Deploy hedge
        </button>
      </div>
    </section>
  );
}

function Waterfall() {
  const { waterfall } = useVessel();
  const latest = waterfall[0];

  if (!latest) {
    return (
      <section className="border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
        No waterfall yet. Join Ballast, then Hull, deploy the hedge, and crank.
      </section>
    );
  }

  const rows: [string, bigint, string][] = [
    ["gross", latest.gross < 0n ? -latest.gross : latest.gross, latest.gross < 0n ? "impair" : "real"],
    ["fee", latest.fee, "muted"],
    ["toReserve", latest.toReserve, "muted"],
    ["toTreasury", latest.toTreasury, "muted"],
    ["hullAccrual", latest.hullAccrual, "hull"],
    ["toBallast", latest.toBallast, "ballast"],
    ["fromBallast", latest.fromBallast, "impair"],
    ["fromReserve", latest.fromReserve, "impair"],
  ];
  const max = rows.reduce((m, [, n]) => (n > m ? n : m), 1n);

  return (
    <section className="border border-line bg-panel p-4 waterfall-play" key={latest.txHash}>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm uppercase tracking-wider text-muted">Waterfall</h2>
        <p className="num text-xs text-muted">
          {waterfall.length} crank{waterfall.length === 1 ? "" : "s"} · {formatTs(latest.ts)}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map(([label, n, tone]) => (
          <div key={label} className="grid grid-cols-[7rem_1fr_6rem] items-center gap-3 text-sm">
            <span className="num text-muted">{label}</span>
            <div className="h-2 bg-line">
              <div
                className={`bar-fill h-full ${
                  tone === "hull"
                    ? "bg-hull"
                    : tone === "ballast"
                      ? "bg-ballast"
                      : tone === "impair"
                        ? "bg-impair"
                        : tone === "real"
                          ? "bg-real"
                          : "bg-muted/40"
                }`}
                style={{ width: `${Number((n * 100n) / max)}%` }}
              />
            </div>
            <span className="num text-right">
              {label === "gross" && latest.gross < 0n ? "−" : ""}
              {formatDusd(n)}
            </span>
          </div>
        ))}
      </div>
      <ol className="mt-4 space-y-1 text-xs text-muted">
        {waterfall.slice(0, 8).map((ev) => (
          <li key={ev.txHash} className="num flex justify-between">
            <span>
              {formatTs(ev.ts)} · G {formatDelta(ev.gross)}
            </span>
            <span>H {formatDusd(ev.hullAccrual)} · B {formatDusd(ev.toBallast)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useVessel();
  useEffect(() => {
    const timers = toasts
      .filter((t) => t.kind !== "pending")
      .map((t) => setTimeout(() => dismissToast(t.id), 5_000));
    return () => {
      for (const id of timers) clearTimeout(id);
    };
  }, [toasts, dismissToast]);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto border bg-panel px-3 py-2 text-sm ${
            t.kind === "error"
              ? "border-impair/50 text-impair"
              : t.kind === "success"
                ? "border-real/40 text-real"
                : t.kind === "pending"
                  ? "border-sim/40 text-sim"
                  : "border-line"
          }`}
        >
          <div className="flex justify-between gap-2">
            <p>{t.text}</p>
            <button type="button" className="text-muted" onClick={() => dismissToast(t.id)}>
              ×
            </button>
          </div>
          {t.href && (
            <a href={t.href} target="_blank" rel="noreferrer" className="num text-xs underline">
              explorer
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
