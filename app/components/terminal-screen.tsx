"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBook } from "@/lib/book/context";
import { SERIES_LABEL } from "@/lib/book/plan";
import { RELEASE, V2 } from "@/lib/book/release";
import { PAUSE, RULES, type BookState, type EngineState } from "@/lib/book/types";
import { formatBlock, formatBps, formatDusd, formatDusd4, formatTs } from "@/lib/format";
import { map2, mapLive } from "@/lib/live";
import { Unavailable, Val } from "@/components/live";
import { MockNotice, TxLink, formatDuration, useNow } from "@/components/book-ui";

/** Contract constant (TrancheController.MIN_IDLE_BPS): idle cash kept against A. */
const MIN_IDLE_BPS = 1_000n;

const PANELS = ["book", "hedge", "carry", "risk", "series", "tape", "opportunities"] as const;

/**
 * Terminal (spec §16): the operator-grade view of the same Live<T> reads the
 * app uses. Panels that need venue data (HEDGE, CARRY, OPPORTUNITIES) state
 * what is missing and why — on testnet the engine is a labelled simulation
 * and real venue custody is gate G01 — rather than rendering zeros.
 */
export function TerminalScreen() {
  const v = useBook();
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-5 md:px-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="num text-[10.5px] tracking-[0.18em] text-steel">TERMINAL</p>
          <h1 className="display mt-2 text-[28px] font-bold tracking-[-0.02em] sm:text-[34px]">The book, instrumented</h1>
          <p className="num mt-2 text-[12px] text-steel">
            block <Val of={mapLive(v.clock, (c) => c.number)}>{(n) => formatBlock(n)}</Val> · {RELEASE.environment} ·{" "}
            {RELEASE.status}
          </p>
          <MockNotice />
        </div>
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="num min-h-11 rounded-lg border border-white/14 px-3 text-[11.5px] text-steel hover:text-ink"
        >
          commands <span className="ml-1 rounded border border-white/14 px-1.5 py-0.5 text-[10px]">⌘K</span>
        </button>
      </div>

      <nav className="mt-6 flex flex-wrap gap-1" aria-label="Terminal panels">
        {PANELS.map((p) => (
          <a key={p} href={`#${p}`} className="num rounded-md px-2.5 py-1.5 text-[11px] tracking-[0.14em] text-steel hover:text-ink">
            {p.toUpperCase()}
          </a>
        ))}
      </nav>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <BookPanel />
        <RiskPanel />
        <HedgePanel />
        <CarryPanel />
        <SeriesPanel />
        <TapePanel />
        <div className="lg:col-span-2">
          <OpportunitiesPanel />
        </div>
      </div>

      {palette ? <CommandPalette onClose={() => setPalette(false)} /> : null}
    </div>
  );
}

function Panel({ id, title, tag, children }: { id: string; title: string; tag?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-[var(--radius-card)] border border-line bg-bg2">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="num text-[11px] tracking-[0.18em] text-ink">{title}</h2>
        {tag}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Row({ k, children, tone }: { k: string; children: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/6 py-1.5 last:border-0">
      <span className="text-[12.5px] text-dim">{k}</span>
      <span className={`num text-[12.5px] ${tone ?? ""}`}>{children}</span>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[12px] leading-relaxed text-steel">{children}</p>;
}

function SimTag() {
  return <span className="num rounded-[7px] border border-amber/50 px-2 py-0.5 text-[10px] tracking-[0.12em] text-amber">SIMULATED</span>;
}

/** BOOK: reconcile what the book holds against what it owes. */
function BookPanel() {
  const v = useBook();
  const both = map2(v.book, v.engine, (b, e) => ({ b, e }));
  return (
    <Panel id="book" title="BOOK">
      <Val of={both}>
        {({ b, e }) => {
          const engineValue = e?.value ?? 0n; // rule0-ok: no engine wired is a read of address(0), not a failed read
          const recomputed = b.activeIdle + engineValue - b.treasuryLiability;
          const unsettled = recomputed - b.recordedActive;
          return (
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="num mb-1 text-[10px] tracking-[0.16em] text-steel">HOLDS</p>
                <Row k="Idle cash (custody)">{formatDusd4(b.activeIdle)}</Row>
                <Row k="Engine value">{e ? formatDusd4(e.value) : "no engine"}</Row>
                <Row k="Pending deposits (not in A)">{formatDusd4(b.custodyPending)}</Row>
                <Row k="Escrow funded (owed out)">{formatDusd4(b.escrowFunded)}</Row>
              </div>
              <div>
                <p className="num mb-1 text-[10px] tracking-[0.16em] text-steel">OWES</p>
                <Row k="Hull" tone="text-steel">{formatDusd4(b.hullNav)}</Row>
                <Row k="Ballast" tone="text-brass">{formatDusd4(b.ballastNav)}</Row>
                <Row k="Reserve">{formatDusd4(b.reserveNav)}</Row>
                <Row k="Treasury fee owed">{formatDusd4(b.treasuryLiability)}</Row>
              </div>
              <div className="sm:col-span-2">
                <Row k="Recomputed A = idle + engine − treasury">{formatDusd4(recomputed)}</Row>
                <Row k="Recorded A (H + B + R at last flow)">{formatDusd4(b.recordedActive)}</Row>
                <Row k="Unsettled result (next settlement's G)" tone={unsettled < 0n ? "text-red" : unsettled > 0n ? "text-phosphor" : undefined}>
                  {unsettled >= 0n ? "+" : "−"}
                  {formatDusd4(unsettled < 0n ? -unsettled : unsettled)}
                </Row>
              </div>
            </div>
          );
        }}
      </Val>
    </Panel>
  );
}

function engineAge(e: EngineState | null, now: bigint): bigint | null {
  return e ? (now > e.observedAt ? now - e.observedAt : 0n) : null;
}

/** RISK: each limit, its current value, and the mode. */
function RiskPanel() {
  const v = useBook();
  const now = useNow();
  const both = map2(v.book, v.engine, (b, e) => ({ b, e }));
  return (
    <Panel id="risk" title="RISK">
      <Val of={both}>
        {({ b, e }) => {
          const paused = ([
            [PAUSE.ADMISSION, "admission"],
            [PAUSE.RISK_INCREASE, "risk increase"],
            [PAUSE.SETTLEMENT, "settlement"],
            [PAUSE.CLAIMS, "claims"],
          ] as const).filter(([bit]) => b.pausedMask & bit);
          const mode = b.impaired ? "IMPAIRED" : paused.length ? "PAUSED" : "NORMAL";
          const hasCapital = b.hullNav + b.ballastNav > 0n;
          const a = b.recordedActive;
          const idleBps = a > 0n ? (b.activeIdle * 10_000n) / a : null;
          const age = engineAge(e, now);
          return (
            <>
              <Row k="Mode" tone={mode === "NORMAL" ? "text-phosphor" : mode === "PAUSED" ? "text-amber" : "text-red"}>
                {mode}
                {paused.length ? ` (${paused.map(([, n]) => n).join(", ")})` : ""}
              </Row>
              <Row
                k="Junior cover — floor 20%, target 30%"
                tone={!hasCapital ? undefined : b.coverBps >= RULES.COVER_TARGET_BPS ? "text-phosphor" : b.coverBps >= RULES.COVER_FLOOR_BPS ? "text-amber" : "text-red"}
              >
                {hasCapital ? formatBps(b.coverBps) : "no capital"}
              </Row>
              <Row k={`Idle cash vs A — floor ${formatBps(MIN_IDLE_BPS)}`}>{idleBps === null ? "no capital" : formatBps(idleBps)}</Row>
              <Row k="Stage cap used">
                {formatDusd(b.lifetimeAdmitted + b.pendingReserved)} / {formatDusd(b.stageCap)}
              </Row>
              <Row k="Beta ceiling (immutable)">{formatDusd(RULES.ABSOLUTE_LIFETIME_CAP)}</Row>
              <Row k="Stressed close cost">{formatDusd4(b.closeCost)}</Row>
              <Row
                k={`Engine valuation age — max ${b.maxValuationAge.toString()}s`}
                tone={age === null ? undefined : age > b.maxValuationAge ? "text-amber" : "text-phosphor"}
              >
                {age === null ? "no engine" : `${age.toString()}s`}
              </Row>
              <Row k="Loss carryforward">{formatDusd4(b.lossCarry)}</Row>
              <Note>
                Intervention history (keeper decisions, pauses) is not published by this deployment yet; pauses
                themselves are on chain and shown above.
              </Note>
            </>
          );
        }}
      </Val>
    </Panel>
  );
}

/** HEDGE: quantities and delta. On testnet there is no venue position to show. */
function HedgePanel() {
  const v = useBook();
  return (
    <Panel id="hedge" title="HEDGE" tag={<SimTag />}>
      <Row k="Spot quantity">
        <Unavailable reason="no venue position — the testnet engine is a labelled simulation (G01 blocked)" />
      </Row>
      <Row k="Signed perp quantity">
        <Unavailable reason="no venue position — the testnet engine is a labelled simulation (G01 blocked)" />
      </Row>
      <Row k="Net delta">
        <Unavailable reason="no venue position — the testnet engine is a labelled simulation (G01 blocked)" />
      </Row>
      <Row k="Margin / open orders">
        <Unavailable reason="no venue account — real venue custody is gate G01" />
      </Row>
      <Row k="Engine book value">
        <Val of={v.engine}>{(e) => (e ? formatDusd4(e.value) : "no engine")}</Val>
      </Row>
      <Note>
        The testnet book is valued by a governance-parameterised simulator, not a hedged position. Hedge evidence
        appears here only when a real venue adapter passes gate G01.
      </Note>
    </Panel>
  );
}

/** CARRY: funding vs costs vs realized. Only the simulated rate exists on testnet. */
function CarryPanel() {
  const v = useBook();
  return (
    <Panel id="carry" title="CARRY" tag={<SimTag />}>
      <Row k="Funding rate (set by governance, not earned)">
        <Val of={v.engine}>{(e) => (e ? `${formatBps(e.fundingRateBps)} APR` : "no engine")}</Val>
      </Row>
      <Row k="Marked spot / perp PnL">
        <Unavailable reason="no venue position on testnet (G01)" />
      </Row>
      <Row k="FX, fees, slippage">
        <Unavailable reason="no executed trades on testnet (G01)" />
      </Row>
      <Row k="Realized return">
        <Unavailable reason="needs settled epochs from a real venue; simulated accrual is not a return" />
      </Row>
    </Panel>
  );
}

function SeriesPanel() {
  const v = useBook();
  const now = useNow();
  return (
    <Panel id="series" title="SERIES">
      <Val of={v.series}>
        {(xs) =>
          xs.length === 0 ? (
            <p className="text-[12.5px] text-dim">No series opened yet.</p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr>
                  {["#", "RATE", "STATE", "PRINCIPAL", "CLOCK"].map((h) => (
                    <th key={h} className="num pb-2 pr-3 text-[10px] font-normal tracking-[0.14em] text-steel">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...xs].reverse().map((s) => (
                  <tr key={s.id.toString()} className="border-t border-white/6">
                    <td className="num py-1.5 text-[12.5px] pr-3">{s.id.toString()}</td>
                    <td className="num py-1.5 text-[12.5px] text-steel pr-3">{formatBps(s.rateBps)}</td>
                    <td className="py-1.5 text-[12.5px] pr-3">{SERIES_LABEL[s.state]}</td>
                    <td className="num py-1.5 text-[12.5px] pr-3">{formatDusd(s.principal)}</td>
                    <td className="num py-1.5 text-[12px] text-dim">
                      {s.state === "SUBSCRIPTION_OPEN" && now < s.subscriptionEnd
                        ? `closes ${formatDuration(s.subscriptionEnd - now)}`
                        : s.maturity
                          ? `matures ${formatTs(s.maturity)}`
                          : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Val>
      <Note>
        Rate derivation: series rates are set by governance with a published terms hash. A derived rate needs 30
        days of observed carry, which does not exist yet — the derivation is shown here once it does.
      </Note>
    </Panel>
  );
}

function TapePanel() {
  const v = useBook();
  return (
    <Panel id="tape" title="TAPE">
      {v.history.status !== "ok" ? (
        <p className="num text-[12px] text-steel">Chain tape not shown here: {v.history.reason}.</p>
      ) : null}
      <Val of={v.history} className={v.history.status !== "ok" ? "hidden" : ""}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-[12.5px] text-dim">No chain events yet.</p>
          ) : (
            <ul className="grid gap-1">
              {rows.slice(0, 12).map((r) => (
                <li key={`${r.txHash}-${r.logIndex}`} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="num w-14 shrink-0 text-[10px] tracking-[0.12em] text-phosphor">CHAIN</span>
                  <span className="flex-1 truncate">{r.event}</span>
                  <span className="num text-[11px] text-steel">{formatBlock(BigInt(r.blockNumber))}</span>
                  <TxLink hash={r.txHash} />
                </li>
              ))}
            </ul>
          )
        }
      </Val>
      <Note>
        CHAIN rows are confirmed events from the indexer. Operational decisions (OPS rows from the keeper journal)
        are not published by this deployment yet, so none are mixed in.
      </Note>
    </Panel>
  );
}

/** OPPORTUNITIES: refuses honestly when the inputs do not exist. */
function OpportunitiesPanel() {
  const v = useBook();
  const capacity = mapLive(v.book, (b: BookState) => (b.stageCap > b.lifetimeAdmitted + b.pendingReserved ? b.stageCap - b.lifetimeAdmitted - b.pendingReserved : 0n));
  return (
    <Panel id="opportunities" title="OPPORTUNITIES">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <Row k="Gross funding estimate">
            <Unavailable reason="no observed venue funding window — testnet funding is simulated (G01)" />
          </Row>
          <Row k="Observation window">
            <Unavailable reason="no venue funding history recorded" />
          </Row>
          <Row k="Expected trading + conversion cost">
            <Unavailable reason="no venue depth observed" />
          </Row>
          <Row k="Net book-equity carry">
            <Unavailable reason="depends on the three inputs above" />
          </Row>
          <Row k="Usable capacity (stage cap left)">
            <Val of={capacity}>{(c) => formatDusd(c)}</Val>
          </Row>
        </div>
        <div className="rounded-xl border border-amber/30 bg-amber/5 p-4">
          <p className="num text-[10.5px] tracking-[0.16em] text-amber">VERDICT · ENTRY REFUSED</p>
          <p className="mt-2 text-[13px] text-dim">
            Net carry cannot be estimated without an observed funding window on an approved venue, so the engine
            does not recommend new capital. Missing data is not ranked as a zero-yield opportunity, and this panel
            never selects new assets or routes deposits.
          </p>
        </div>
      </div>
    </Panel>
  );
}

type Command = { id: string; group: "navigate" | "read" | "verify" | "prepare"; label: string; run: () => void };

/**
 * Typed command palette (spec §16): read, verify, navigate and prepare. No
 * free-text interpretation — input only filters the fixed command list, and
 * prepare commands open the app's own flows, where the wallet authorizes.
 */
function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const v = useBook();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [out, setOut] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      onClose();
      router.push(href);
    };
    const jump = (id: string) => () => {
      onClose();
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    };
    return [
      ...PANELS.map((p) => ({ id: `read.${p}`, group: "read" as const, label: `Show ${p.toUpperCase()}`, run: jump(p) })),
      {
        id: "verify.book",
        group: "verify",
        label: "Independent check of the book",
        run: () =>
          setOut(
            v.evidence.status === "ok"
              ? `${v.evidence.value.status} at finalized block ${v.evidence.value.blockNumber ?? "?"} — ${v.evidence.value.checks
                  .map((c) => `${c.id}: ${c.verdict}`)
                  .join(", ")}`
              : `Not available here (${v.evidence.reason}). Run it yourself: cd tools/verify-cli && pnpm verify --manifest ../../deployments/${RELEASE.environment}-v2.json --rpc https://testnet-rpc.monad.xyz`,
          ),
      },
      { id: "verify.contracts", group: "verify", label: "Contract source verification", run: go("/transparency#contracts") },
      { id: "verify.address", group: "verify", label: `Controller address ${V2.TrancheController}`, run: () => setOut(V2.TrancheController) },
      { id: "prepare.ballast", group: "prepare", label: "Prepare a Ballast deposit request", run: go("/deposit") },
      { id: "prepare.hull", group: "prepare", label: "Prepare a Hull subscription", run: go("/deposit") },
      { id: "prepare.exit", group: "prepare", label: "Prepare a Ballast exit request", run: go("/withdraw") },
      { id: "prepare.claim", group: "prepare", label: "Claim refunds and payouts", run: go("/portfolio") },
      { id: "nav.series", group: "navigate", label: "Series", run: go("/series") },
      { id: "nav.transparency", group: "navigate", label: "Transparency", run: go("/transparency") },
      { id: "nav.portfolio", group: "navigate", label: "Portfolio", run: go("/portfolio") },
    ];
  }, [onClose, router, v.evidence]);

  const shown = commands.filter((c) => `${c.group} ${c.label}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]" role="dialog" aria-modal aria-label="Commands" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-[var(--radius-modal)] border border-line bg-panel" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
            setOut(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, shown.length - 1));
            if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
            if (e.key === "Enter") shown[sel]?.run();
          }}
          placeholder="Type a command — read, verify, prepare, navigate"
          aria-label="Filter commands"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-sm outline-none"
        />
        <ul className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
          {shown.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === sel}>
              <button
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={c.run}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${i === sel ? "bg-white/[0.05]" : ""}`}
              >
                <span className="num w-16 shrink-0 text-[10px] tracking-[0.12em] text-steel">{c.group.toUpperCase()}</span>
                <span className="truncate">{c.label}</span>
              </button>
            </li>
          ))}
          {shown.length === 0 ? <li className="px-4 py-3 text-sm text-dim">No command matches.</li> : null}
        </ul>
        {out ? <p className="num break-all border-t border-line px-4 py-3 text-[12px] text-dim">{out}</p> : null}
      </div>
    </div>
  );
}
