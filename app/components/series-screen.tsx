"use client";

import Link from "next/link";
import { useBook } from "@/lib/book/context";
import { SERIES_LABEL } from "@/lib/book/plan";
import { RULES, type Series } from "@/lib/book/types";
import { formatBps, formatDusd, formatTs } from "@/lib/format";
import { Card, EmptyState, Skeleton } from "@/components/ui";
import { Val } from "@/components/live";
import { MockNotice, PageHead, SectionLabel, formatDuration, useNow } from "@/components/book-ui";

const STEPS = [
  ["Subscription window", "72 hours. Anyone on the allowlist can subscribe; up to 25 subscribers. You can cancel until it closes."],
  ["Activation", "All subscriptions are admitted together on identical terms — only those that keep Ballast cover at 30% and the 2% reserve funded."],
  ["Term", "28 days at the fixed rate. Ballast absorbs losses first; the reserve second."],
  ["Maturity", "The coupon is funded into escrow from the book, and each holder claims principal plus coupon."],
] as const;

export function SeriesScreen() {
  const v = useBook();
  const now = useNow();

  if (v.loading) {
    return (
      <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-5 md:py-14">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-10 w-56" />
        <Skeleton className="mt-8 h-56 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-5 md:py-14">
      <PageHead eyebrow="SERIES" title="Hull series">
        Hull is sold in dated 28-day series at a fixed rate, set by governance and published
        with a terms hash before the window opens.
      </PageHead>
      <MockNotice />

      <ol className="mt-8 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line sm:grid-cols-4">
        {STEPS.map(([t, d], i) => (
          <li key={t} className="bg-bg2 p-4">
            <p className="num text-[10px] tracking-[0.16em] text-steel">0{i + 1}</p>
            <p className="display mt-1 text-[15px]">{t}</p>
            <p className="mt-1 text-[12.5px] text-dim">{d}</p>
          </li>
        ))}
      </ol>

      <section className="mt-10">
        <Val of={v.series}>
          {(xs) =>
            xs.length === 0 ? (
              <EmptyState
                title="No series yet"
                action={
                  <p className="max-w-sm text-sm text-dim">
                    Governance opens the first series through the Safe and timelock once Ballast and the
                    reserve can cover it.
                  </p>
                }
              />
            ) : (
              <div className="grid gap-4">
                {[...xs].reverse().map((s) => (
                  <SeriesCard key={s.id.toString()} s={s} now={now} />
                ))}
              </div>
            )
          }
        </Val>
      </section>
    </div>
  );
}

function SeriesCard({ s, now }: { s: Series; now: bigint }) {
  const open = s.state === "SUBSCRIPTION_OPEN" && now < s.subscriptionEnd;
  const timeline =
    s.state === "SUBSCRIPTION_OPEN"
      ? now < s.subscriptionEnd
        ? `window closes in ${formatDuration(s.subscriptionEnd - now)} (${formatTs(s.subscriptionEnd)})`
        : "window closed — awaiting activation"
      : s.state === "ACTIVE"
        ? `matures ${formatTs(s.maturity)}${s.maturity > now ? ` · in ${formatDuration(s.maturity - now)}` : ""}`
        : s.maturity
          ? `matured ${formatTs(s.maturity)}`
          : "";
  return (
    <Card accent="steel" className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="num text-[10px] tracking-[0.18em] text-steel">SERIES #{s.id.toString()}</p>
          <p className="display mt-1 text-2xl text-[#C2D2E0]">{formatBps(s.rateBps)} fixed</p>
          <p className="num mt-1 text-[12.5px] text-dim">{timeline}</p>
        </div>
        <span
          className={`num rounded-[7px] border px-2.5 py-1 text-[10.5px] tracking-[0.12em] ${
            s.state === "IMPAIRED" ? "border-red/50 text-red" : open ? "border-purple/50 text-purple" : "border-white/14 text-steel"
          }`}
        >
          {SERIES_LABEL[s.state].toUpperCase()}
        </span>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        <div>
          <SectionLabel>PRINCIPAL</SectionLabel>
          <p className="num mt-1">{s.principal > 0n ? formatDusd(s.principal) : "set at activation"}</p>
        </div>
        <div>
          <SectionLabel>COUPON RECOGNIZED</SectionLabel>
          <p className="num mt-1">{formatDusd(s.recognizedCoupon)}</p>
        </div>
        <div>
          <SectionLabel>SUBSCRIBERS</SectionLabel>
          <p className="num mt-1">
            {s.subscriptions.toString()}/{RULES.MAX_SUBSCRIBERS.toString()}
          </p>
        </div>
        <div>
          <SectionLabel>YOURS</SectionLabel>
          <p className="num mt-1">{s.myUnits > 0n ? formatDusd(s.myUnits) : "—"}</p>
        </div>
      </div>
      <p className="num mt-4 break-all text-[11px] text-steel/80" title="keccak256 of the published series terms">
        terms {s.termsHash}
      </p>
      {open ? (
        <Link href="/deposit" className="mt-4 inline-flex text-sm text-purple hover:underline">
          Subscribe on Deposit →
        </Link>
      ) : null}
    </Card>
  );
}
