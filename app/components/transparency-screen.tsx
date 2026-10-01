"use client";

import { useBook } from "@/lib/book/context";
import { RELEASE, ROLES, V2 } from "@/lib/book/release";
import { RULES, type BookState } from "@/lib/book/types";
import { formatBlock, formatBps, formatDusd, formatDusd4 } from "@/lib/format";
import { mapLive, type Live } from "@/lib/live";
import { verificationOf } from "@/lib/verification";
import { EXPLORER } from "@/lib/wagmi";
import { AddressChip, Badge, Card } from "@/components/ui";
import { Val } from "@/components/live";
import { MockNotice, PageHead, SectionLabel, TxLink, formatDuration } from "@/components/book-ui";

export function TransparencyScreen() {
  const v = useBook();
  return (
    <div className="mx-auto max-w-[1080px] px-4 py-10 sm:px-5 md:py-14">
      <PageHead eyebrow="TRANSPARENCY" title="The book, block by block">
        Every number on this page is read from the chain at one block. An independent checker
        recomputes the same book without our API — and you can run it yourself.
      </PageHead>
      <MockNotice />
      <p className="num mt-4 text-[12px] text-steel">
        block <Val of={mapLive(v.clock, (c) => c.number)}>{(n) => formatBlock(n)}</Val> · release{" "}
        {RELEASE.environment} · {RELEASE.status}
      </p>

      <section className="mt-10">
        <h2 className="display text-lg">Book</h2>
        <Card className="mt-4 grid grid-cols-2 gap-px overflow-hidden md:grid-cols-4">
          <Cell label="HULL" tone="text-steel" of={mapLive(v.book, (b) => formatDusd4(b.hullNav))} />
          <Cell label="BALLAST" tone="text-brass" of={mapLive(v.book, (b) => formatDusd4(b.ballastNav))} />
          <Cell label="RESERVE" of={mapLive(v.book, (b) => formatDusd4(b.reserveNav))} />
          <Cell label="TREASURY OWED" of={mapLive(v.book, (b) => formatDusd4(b.treasuryLiability))} />
          <Cell label="RECORDED ASSETS (A)" of={mapLive(v.book, (b) => formatDusd4(b.recordedActive))} />
          <Cell label="LOSS CARRYFORWARD" of={mapLive(v.book, (b) => formatDusd4(b.lossCarry))} />
          <Cell label="EPOCH" of={mapLive(v.book, (b) => b.epoch.toString())} />
          <Cell
            label="STATE"
            of={mapLive(v.book, (b) => (b.impaired ? "IMPAIRED" : "normal"))}
            tone={v.book.status === "ok" && v.book.value.impaired ? "text-red" : undefined}
          />
        </Card>
        <Val of={v.book}>{(b) => <Cover b={b} />}</Val>
      </section>

      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="display text-lg">Strategy engine</h2>
          <Card className="mt-4 p-5">
            <Val of={v.engine}>
              {(e) =>
                e === null ? (
                  <p className="text-sm text-dim">
                    No engine is wired yet. Governance wires it through the Safe and the{" "}
                    {formatDuration(RELEASE.timelockDelaySeconds)} timelock.
                  </p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <SectionLabel>MODE</SectionLabel>
                      <div className="mt-1.5">{e.simulated ? <Badge kind="sim" /> : <Badge kind="hedged" />}</div>
                    </div>
                    <div>
                      <SectionLabel>VALUE</SectionLabel>
                      <p className="num mt-1">{formatDusd4(e.value)}</p>
                    </div>
                    <div>
                      <SectionLabel>FUNDING RATE</SectionLabel>
                      <p className={`num mt-1 ${e.fundingRateBps < 0n ? "text-red" : ""}`}>{formatBps(e.fundingRateBps)} APR</p>
                    </div>
                  </div>
                )
              }
            </Val>
            <p className="mt-4 text-[12.5px] text-dim">
              On testnet the short leg is a labelled simulation: its funding rate is set by governance, not
              earned on a venue. Real venue custody is not live (gate G01).
            </p>
          </Card>
        </div>
        <div>
          <h2 className="display text-lg">Beta caps</h2>
          <Card className="mt-4 p-5">
            <Val of={v.book}>
              {(b) => (
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <SectionLabel>STAGE CAP</SectionLabel>
                    <p className="num mt-1">{formatDusd(b.stageCap)}</p>
                  </div>
                  <div>
                    <SectionLabel>ADMITTED</SectionLabel>
                    <p className="num mt-1">{formatDusd(b.lifetimeAdmitted)}</p>
                  </div>
                  <div>
                    <SectionLabel>PENDING</SectionLabel>
                    <p className="num mt-1">{formatDusd(b.pendingReserved)}</p>
                  </div>
                </div>
              )}
            </Val>
            <p className="mt-4 text-[12.5px] text-dim">
              Hard ceiling {formatDusd(RULES.ABSOLUTE_LIFETIME_CAP)} dUSD for the whole beta, fixed in the contract.
            </p>
          </Card>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="display text-lg">Independent check</h2>
        <Card className="mt-4 p-5">
          {v.evidence.status !== "ok" ? (
            <p className="num text-[12.5px] text-steel" data-live="unavailable">
              Not shown here: {v.evidence.reason}.
            </p>
          ) : null}
          <Val of={v.evidence} className={v.evidence.status !== "ok" ? "hidden" : ""}>
            {(ev) => (
              <>
                <p className="num text-sm">
                  <span
                    className={
                      ev.status === "MISMATCH" ? "text-red" : ev.status === "SIMULATED" ? "text-amber" : ev.status === "LIVE" ? "text-phosphor" : "text-steel"
                    }
                  >
                    {ev.status}
                  </span>
                  {ev.blockNumber ? <span className="text-steel"> · finalized block {formatBlock(BigInt(ev.blockNumber))}</span> : null}
                </p>
                <ul className="mt-4 grid gap-2">
                  {ev.checks.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-baseline gap-3 text-sm">
                      <span
                        className={`num w-20 shrink-0 text-[11px] tracking-[0.1em] ${
                          c.verdict === "PASS" ? "text-phosphor" : c.verdict === "MISMATCH" ? "text-red" : c.verdict === "SIMULATED" ? "text-amber" : "text-steel"
                        }`}
                      >
                        {c.verdict}
                      </span>
                      <span className="num text-[12px] text-steel">{c.id}</span>
                      <span className="text-dim">{c.summary}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Val>
          <p className="mt-5 text-[12.5px] text-dim">Run the same checks yourself, against any RPC:</p>
          <pre className="num mt-2 overflow-x-auto rounded-lg border border-line bg-bg px-3 py-2 text-[11.5px] text-ink">
            {`cd tools/verify-cli && pnpm verify --manifest ../../deployments/${RELEASE.environment}-v2.json --rpc https://testnet-rpc.monad.xyz`}
          </pre>
        </Card>
      </section>

      <section className="mt-10">
        <h2 className="display text-lg">Event history</h2>
        <Card className="mt-4 overflow-x-auto">
          {v.history.status !== "ok" ? (
            <p className="num p-5 text-[12.5px] text-steel" data-live="unavailable">
              Not shown here: {v.history.reason}.
            </p>
          ) : null}
          <Val of={v.history} className={v.history.status !== "ok" ? "hidden" : ""}>
            {(rows) =>
              rows.length === 0 ? (
                <p className="p-5 text-sm text-dim">No events yet.</p>
              ) : (
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      {["BLOCK", "EVENT", "TX", "FINALITY"].map((h) => (
                        <th key={h} className="num px-4 py-3 text-[10px] font-normal tracking-[0.14em] text-steel">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.txHash}-${r.logIndex}`} className="border-b border-line/60 last:border-0">
                        <td className="num px-4 py-2.5 text-steel">{formatBlock(BigInt(r.blockNumber))}</td>
                        <td className="px-4 py-2.5">{r.event}</td>
                        <td className="px-4 py-2.5">
                          <TxLink hash={r.txHash} />
                        </td>
                        <td className={`num px-4 py-2.5 text-[12px] ${r.finalized ? "text-phosphor" : "text-steel"}`}>
                          {r.finalized ? "finalized" : "pending"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </Val>
        </Card>
        <p className="mt-3 text-[12.5px] text-dim">
          History comes from an indexer that rebuilds from chain events and survives reorgs. It is a projection —
          balances above are read from the contracts directly.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="display text-lg">Governance</h2>
        <Card className="mt-4 divide-y divide-white/6">
          <Role name="Governance Safe" addr={ROLES.governanceSafe} note="2-of-3 multisig; proposes and executes through the timelock" />
          <Role
            name="Timelock"
            addr={V2.TimelockController}
            note={`${formatDuration(RELEASE.timelockDelaySeconds)} delay on testnet (48h on mainnet) — every parameter change waits in public`}
          />
          <Role name="Guardian" addr={ROLES.guardian} note="can pause; only governance can resume" />
          <Role name="Operator (keeper)" addr={ROLES.operator} note="admits queues, moves idle cash, settles — allowlisted calls only" />
        </Card>
      </section>

      <section id="contracts" className="mt-12">
        <h2 className="display text-lg">Contracts</h2>
        <div className="mt-4 overflow-hidden rounded-2xl border border-line">
          {(Object.entries(V2) as [string, string][]).map(([name, addr]) => (
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
          Verification status is per contract, read from a generated manifest — a row shows VERIFIED only where a
          verification run confirmed it. Anything not checked says so.
        </p>
      </section>
    </div>
  );
}

function Cell({ label, of, tone }: { label: string; of: Live<string>; tone?: string }) {
  return (
    <div className="flex flex-col gap-1.5 bg-bg2 px-5 py-4">
      <span className="num text-[10px] tracking-[0.16em] text-steel">{label}</span>
      <span className={`num text-lg ${tone ?? ""}`}>
        <Val of={of}>{(x) => x}</Val>
      </span>
    </div>
  );
}

/** Junior cover B / (H + B) against the 20% floor and the 30% projected target. */
function Cover({ b }: { b: BookState }) {
  const pct = Math.min(100, Number(b.coverBps) / 100);
  const tone = b.coverBps >= RULES.COVER_TARGET_BPS ? "bg-phosphor" : b.coverBps >= RULES.COVER_FLOOR_BPS ? "bg-amber" : "bg-red";
  const empty = b.hullNav + b.ballastNav === 0n;
  return (
    <Card className="mt-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel>JUNIOR COVER — BALLAST ÷ (HULL + BALLAST)</SectionLabel>
        <span className="num text-sm">{empty ? "no capital yet" : formatBps(b.coverBps)}</span>
      </div>
      <div className="relative mt-3 h-3 overflow-hidden rounded-full border border-line bg-bg">
        {!empty ? <div className={`absolute inset-y-0 left-0 ${tone}`} style={{ width: `${pct}%` }} /> : null}
        <div className="absolute inset-y-0 w-px bg-red/70" style={{ left: "20%" }} title="20% floor" />
        <div className="absolute inset-y-0 w-px bg-white/60" style={{ left: "30%" }} title="30% projected target" />
      </div>
      <p className="num mt-2 text-[11px] text-steel">floor 20% · new Hull and Ballast exits must keep 30% projected cover</p>
    </Card>
  );
}

function Role({ name, addr, note }: { name: string; addr: string; note: string }) {
  return (
    <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm">{name}</p>
        <p className="text-[12.5px] text-dim">{note}</p>
      </div>
      <AddressChip address={addr} href={`${EXPLORER}/address/${addr}`} />
    </div>
  );
}

/**
 * Per-contract verification status, read from lib/verification.ts (generated
 * by `pnpm verify:manifest`). The `kind` passed to Badge is the manifest's own
 * state, never a literal, so a contract is badged verified only by a run that
 * wrote that state with its timestamp.
 */
function VerificationMark({ name, address }: { name: string; address: string }) {
  const entry = verificationOf(name);
  const explorerHref = `${EXPLORER}/address/${address}`;
  if (entry.state === "verified" && entry.address.toLowerCase() === address.toLowerCase()) {
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
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="num text-[11px] text-steel/60" title="We have not confirmed this contract's source verification.">
        {label}
      </span>
      <a href={explorerHref} className="num text-[11px] text-purple" title="Check verification status on the explorer">
        explorer ↗
      </a>
    </span>
  );
}

