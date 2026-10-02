"use client";

import Link from "next/link";
import { useState } from "react";
import { useBook } from "@/lib/book/context";
import { SERIES_LABEL, canCancelDeposit, depositLabel } from "@/lib/book/plan";
import type { DepositRequest, Series } from "@/lib/book/types";
import { formatBps, formatDusd, formatDusd4, formatShares, formatTs } from "@/lib/format";
import { map2, mapLive, type Live } from "@/lib/live";
import { Button, Card, EmptyState, Skeleton, StatBlock } from "@/components/ui";
import { Unavailable, Val } from "@/components/live";
import { ConnectButton } from "@/components/connect";
import { MockNotice, PageHead, SectionLabel, TrancheTag, useNow } from "@/components/book-ui";

export function PortfolioScreen() {
  const v = useBook();
  const now = useNow();

  if (v.loading) {
    return (
      <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-5 md:py-14">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-10 w-56" />
        <Skeleton className="mt-8 h-28 w-full" />
        <Skeleton className="mt-6 h-48 w-full" />
      </div>
    );
  }
  if (!v.connected) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16 sm:px-5">
        <EmptyState title="Connect to see your position" action={<ConnectButton />} />
      </div>
    );
  }

  const hullHeld = mapLive(v.series, (xs) => xs.filter((s) => s.myUnits > 0n || s.myClaimable > 0n));
  const hullPrincipal = mapLive(v.series, (xs) =>
    xs.filter((s) => s.state === "ACTIVE" || s.state === "SUBSCRIPTION_OPEN" || s.state === "MATURED_UNWINDING").reduce((a, s) => a + s.myUnits, 0n),
  );
  const claimable = map2(
    map2(v.series, v.myExits, (xs, es) => xs.reduce((a, s) => a + s.myClaimable, 0n) + es.reduce((a, e) => a + e.claimable, 0n)),
    v.myDeposits,
    (sum, ds) => sum + ds.filter((d) => d.status === "REFUNDABLE").reduce((a, d) => a + d.assets, 0n),
  );
  const pending = mapLive(v.wallet, (w) => w.reserved);

  return (
    <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-5 md:py-14">
      <PageHead eyebrow="PORTFOLIO" title="Your position">
        Everything below is read from the chain for this wallet at one block.
      </PageHead>
      <MockNotice />

      <Card className="mt-8 grid grid-cols-2 gap-px overflow-hidden md:grid-cols-4">
        <Stat label="WALLET dUSD" of={mapLive(v.wallet, (w) => formatDusd(w.dusd))} />
        <Stat label="BALLAST VALUE" of={mapLive(v.wallet, (w) => formatDusd(w.ballastValue))} tone="brass" />
        <Stat label="HULL PRINCIPAL" of={mapLive(hullPrincipal, (x) => formatDusd(x))} tone="steel" />
        <Stat label="READY TO CLAIM" of={mapLive(claimable, (x) => formatDusd(x))} tone="phosphor" />
      </Card>
      <p className="num mt-3 text-[12px] text-dim">
        Waiting for admission: <Val of={pending}>{(x) => `${formatDusd(x)} dUSD`}</Val>
      </p>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="display text-xl">Ballast</h2>
          <Link href="/withdraw" className="text-sm text-purple hover:underline">
            Withdraw →
          </Link>
        </div>
        <Card accent="brass" className="mt-4 p-5">
          <Val of={v.wallet}>
            {(w) =>
              w.ballastUnits === 0n ? (
                <p className="text-sm text-dim">No Ballast units yet.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="UNITS">{formatShares(w.ballastUnits)}</Field>
                  <Field label="LOCKED IN EXITS">{formatShares(w.ballastLocked)}</Field>
                  <Field label="VALUE NOW">{formatDusd4(w.ballastValue)} dUSD</Field>
                </div>
              )
            }
          </Val>
        </Card>
      </section>

      <section className="mt-10">
        <h2 className="display text-xl">Hull series</h2>
        <Val of={hullHeld}>
          {(xs) =>
            xs.length === 0 ? (
              <Card className="mt-4 p-5">
                <p className="text-sm text-dim">
                  No Hull positions. <Link href="/series" className="text-purple hover:underline">See series</Link>
                </p>
              </Card>
            ) : (
              <div className="mt-4 grid gap-4">
                {xs.map((s) => (
                  <HullRow key={s.id.toString()} s={s} />
                ))}
              </div>
            )
          }
        </Val>
      </section>

      <section className="mt-10">
        <h2 className="display text-xl">Requests</h2>
        <Val of={map2(v.myDeposits, v.series, (ds, xs) => ({ ds, xs }))}>
          {({ ds, xs }) =>
            ds.length === 0 ? (
              <Card className="mt-4 p-5">
                <p className="text-sm text-dim">
                  No deposit requests. <Link href="/deposit" className="text-purple hover:underline">Board a deck</Link>
                </p>
              </Card>
            ) : (
              <Card className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      {["#", "DECK", "AMOUNT", "STATUS", "DEADLINE", ""].map((h) => (
                        <th key={h} className="num px-4 py-3 text-[10px] font-normal tracking-[0.14em] text-steel">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ds.map((d) => (
                      <RequestRow key={d.id.toString()} d={d} canCancel={canCancelDeposit(d, xs, now)} />
                    ))}
                  </tbody>
                </table>
              </Card>
            )
          }
        </Val>
      </section>
    </div>
  );
}

function Stat({ label, of, tone = "ink" }: { label: string; of: Live<string>; tone?: "ink" | "phosphor" | "brass" | "steel" }) {
  if (of.status !== "ok") {
    return (
      <div className="flex flex-col gap-1.5 bg-bg2 px-5 py-4">
        <span className="num text-[10px] uppercase tracking-[0.16em] text-steel">{label}</span>
        <Unavailable reason={of.reason} className="text-lg" />
      </div>
    );
  }
  return <StatBlock label={label} value={of.value} tone={tone} />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <p className="num mt-1 text-[15px]">{children}</p>
    </div>
  );
}

function HullRow({ s }: { s: Series }) {
  const v = useBook();
  const [busy, setBusy] = useState(false);
  return (
    <Card accent="steel" className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="grid flex-1 gap-4 sm:grid-cols-4">
        <Field label="SERIES">#{s.id.toString()} · {formatBps(s.rateBps)}</Field>
        <Field label="STATE">{SERIES_LABEL[s.state]}</Field>
        <Field label="YOUR PRINCIPAL">{formatDusd(s.myUnits)}</Field>
        <Field label="MATURITY">{s.maturity ? formatTs(s.maturity) : "at activation + 28d"}</Field>
      </div>
      {s.myClaimable > 0n ? (
        <Button
          loading={busy}
          onClick={() => {
            setBusy(true);
            void v.claimHull(s.id).finally(() => setBusy(false));
          }}
        >
          Claim {formatDusd(s.myClaimable)}
        </Button>
      ) : null}
    </Card>
  );
}

function RequestRow({ d, canCancel }: { d: DepositRequest; canCancel: boolean }) {
  const v = useBook();
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<boolean>) => {
    setBusy(true);
    void fn().finally(() => setBusy(false));
  };
  const tone = d.status === "ADMITTED" ? "text-phosphor" : d.status === "REFUNDABLE" ? "text-amber" : "text-ink";
  return (
    <tr className="border-b border-line/60 last:border-0">
      <td className="num px-4 py-3 text-steel">{d.id.toString()}</td>
      <td className="px-4 py-3">
        <TrancheTag kind={d.tranche} />
        {d.tranche === "hull" ? <span className="num ml-2 text-[11px] text-steel">#{d.seriesId.toString()}</span> : null}
      </td>
      <td className="num px-4 py-3">{formatDusd4(d.assets)}</td>
      <td className={`px-4 py-3 ${tone}`}>{depositLabel(d)}</td>
      <td className="num px-4 py-3 text-dim">{d.status === "ESCROWED" ? formatTs(d.deadline) : "—"}</td>
      <td className="px-4 py-2 text-right">
        {d.status === "REFUNDABLE" ? (
          <Button variant="ghost" loading={busy} onClick={() => run(() => v.claimRefund(d.id))}>
            Claim refund
          </Button>
        ) : canCancel ? (
          <Button variant="ghost" loading={busy} onClick={() => run(() => v.cancelDeposit(d.id))}>
            Cancel
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

