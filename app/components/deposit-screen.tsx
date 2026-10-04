"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBook } from "@/lib/book/context";
import { depositDeadline, planDeposit, previewUnits } from "@/lib/book/plan";
import { RULES, type Series, type TrancheKind } from "@/lib/book/types";
import { COPY } from "@/lib/copy";
import { formatBps, formatDusd, formatShares, formatTs, parseDusd } from "@/lib/format";
import { map2, mapLive, valueOrForLogic, type Live } from "@/lib/live";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { Val } from "@/components/live";
import { ConnectButton, GasFirstCard } from "@/components/connect";
import { MockNotice, PageHead, SectionLabel, formatDuration, useNow } from "@/components/book-ui";
import { WC_ENABLED } from "@/lib/wagmi";

export function DepositScreen() {
  const v = useBook();
  const router = useRouter();
  const now = useNow();
  const [amt, setAmt] = useState("100");
  const [deck, setDeck] = useState<TrancheKind>("ballast");
  const [done, setDone] = useState<{ amount: bigint; deck: TrancheKind } | null>(null);

  const openSeries: Live<Series | null> = mapLive(
    v.series,
    (xs) => xs.find((s) => s.state === "SUBSCRIPTION_OPEN" && now < s.subscriptionEnd) ?? null,
  );
  const series = valueOrForLogic(openSeries, null);

  const validShape = /^\d+(\.\d{0,6})?$/.test(amt.trim());
  const parsed = validShape ? parseDusd(amt) : 0n;
  const plan = planDeposit({
    tranche: deck,
    seriesId: deck === "hull" ? (series?.id ?? 0n) : 0n,
    assets: parsed,
    now,
    book: v.book,
    wallet: v.wallet,
    series: v.series,
  });
  const canSubmit = plan.kind === "ok" && !v.wrongNetwork;

  const cooldown = v.wallet.status === "ok" ? v.wallet.value.faucetCooldownSec : 0;
  const capReached = v.wallet.status === "ok" && v.wallet.value.faucetRemaining === 0n;

  if (v.loading) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-5 md:py-14">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-10 w-56" />
        <Skeleton className="mt-8 h-40 w-full" />
      </div>
    );
  }

  if (!v.connected) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16 sm:px-5">
        <EmptyState title="Connect to board" action={<ConnectButton />} />
        <p className="mt-4 text-center text-sm text-dim">
          {WC_ENABLED
            ? "Use a Monad-ready wallet. On a phone, use WalletConnect. Demo dollars only."
            : "Use a Monad-ready browser wallet. WalletConnect is not configured on this deployment, so phones need an in-wallet browser. Demo dollars only."}
        </p>
      </div>
    );
  }

  const submit = () => {
    if (plan.kind !== "ok") return;
    const sid = deck === "hull" ? (series?.id ?? 0n) : 0n;
    void (async () => {
      const sent = await v.requestDeposit({
        tranche: deck,
        seriesId: sid,
        assets: parsed,
        minOut: plan.minOut,
        deadline: depositDeadline(deck, now, series ?? undefined),
      });
      if (sent) setDone({ amount: parsed, deck });
    })();
  };

  return (
    <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-5 md:py-14">
      <PageHead eyebrow="01 — DEPOSIT" title="Board a" accent="deck.">
        A deposit is a request. Your dUSD waits in custody until it is admitted — Ballast in
        queue order, Hull together when its subscription window closes. Anything not admitted
        becomes a refund you can claim.
      </PageHead>
      <MockNotice />

      <GasFirstCard className="mt-8" />

      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionLabel>dUSD BALANCE</SectionLabel>
          <p className="num mt-1 text-3xl">
            <Val of={mapLive(v.wallet, (w) => w.dusd)}>{(b) => formatDusd(b)}</Val>
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => void v.faucet()}
          tooltip={
            capReached
              ? "Lifetime faucet cap reached for this address (1,000 dUSD)."
              : cooldown > 0
                ? COPY.cooldown(cooldown)
                : v.wallet.status !== "ok"
                  ? `Cooldown unknown — ${v.wallet.reason}`
                  : undefined
          }
          disabled={cooldown > 0 || capReached}
        >
          Get test dollars
        </Button>
      </div>
      {cooldown > 0 ? <p className="num mt-2 text-sm text-steel">{COPY.cooldown(cooldown)}</p> : null}

      <Eligibility />

      <div className="mt-8 border-b border-ink/12 pb-4">
        <div className="flex items-center justify-between">
          <SectionLabel>AMOUNT</SectionLabel>
          <button
            type="button"
            className="num min-h-11 text-[11px] text-hull disabled:opacity-40"
            disabled={v.wallet.status !== "ok"}
            onClick={() => v.wallet.status === "ok" && setAmt(formatDusd(v.wallet.value.dusd).replace(/,/g, ""))}
          >
            MAX
          </button>
        </div>
        <input
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          inputMode="decimal"
          aria-label="Deposit amount in dUSD"
          className="num mt-2 w-full bg-transparent text-[clamp(1.75rem,10vw,2.5rem)] tracking-[-0.01em] outline-none"
        />
        <p className="mt-2 text-sm text-dim">You&apos;re requesting {validShape ? formatDusd(parsed) : "0.00"} dUSD</p>
      </div>

      <div role="radiogroup" aria-label="Deck" className="mt-8 grid gap-4 sm:grid-cols-2">
        <DeckPick kind="hull" selected={deck === "hull"} onSelect={() => setDeck("hull")}>
          <Val of={openSeries}>
            {(s) =>
              s ? (
                <>
                  <p className="num text-[19px]">{formatBps(s.rateBps)} fixed · 28 days</p>
                  <p className="num mt-2 text-[12.5px] text-dim">
                    Series #{s.id.toString()} · window closes in {formatDuration(s.subscriptionEnd - now)} ·{" "}
                    {s.subscriptions.toString()}/{RULES.MAX_SUBSCRIBERS.toString()} subscribers
                  </p>
                </>
              ) : (
                <p className="text-sm text-dim">
                  No series is open right now. A new 28-day series opens when Ballast cover allows.
                </p>
              )
            }
          </Val>
          <ul className="mt-4 space-y-1 text-[13.5px] text-steel">
            <li>Senior — losses reach you last</li>
            <li>Fixed rate for the whole 28-day term</li>
            <li>Paid out at maturity, claimed from escrow</li>
          </ul>
        </DeckPick>
        <DeckPick kind="ballast" selected={deck === "ballast"} onSelect={() => setDeck("ballast")}>
          <p className="num text-[17px]">
            <Val of={v.book}>{(b) => `residual after Hull's coupon · ${formatBps(b.coverBps)} cover`}</Val>
          </p>
          <ul className="mt-4 space-y-1 text-[13.5px] text-steel">
            <li>Absorbs losses first — and earns what is left</li>
            <li>Admitted by the keeper in request order</li>
            <li>Exits wait a 48-hour cooldown, then fill as liquidity and cover allow</li>
          </ul>
          {deck === "ballast" && parsed > 0n ? (
            <p className="num mt-4 text-[12px] text-dim">
              ≈ <Val of={mapLive(v.book, (b) => previewUnits(parsed, b))}>{(u) => formatShares(u)}</Val> units at today&apos;s price
            </p>
          ) : null}
        </DeckPick>
      </div>

      {done ? (
        <Card className="mt-8 p-6 sm:p-8">
          <p className="num flex items-center gap-2 text-[10.5px] tracking-[0.16em] text-phosphor">
            <span className="h-1.5 w-1.5 rounded-full bg-phosphor" />
            REQUEST SENT
          </p>
          <p className="display mt-4 text-2xl">
            {formatDusd(done.amount)} dUSD requested for {done.deck === "hull" ? "Hull" : "Ballast"}.
          </p>
          <p className="mt-3 text-sm text-dim">
            {done.deck === "hull"
              ? `Subscriptions are admitted together when the window closes${series ? ` (${formatTs(series.subscriptionEnd)})` : ""}. If yours is not admitted, the full amount becomes a refund.`
              : "The keeper admits Ballast requests in order. If it is not admitted before its deadline, the full amount becomes a refund."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => router.push("/portfolio")}>Track it in Portfolio</Button>
            <Button variant="ghost" onClick={() => setDone(null)}>
              Deposit again
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="mt-8 p-6">
          <p className="num text-sm text-dim">
            {formatDusd(parsed)} dUSD → {deck === "hull" ? `HULL${series ? ` SERIES #${series.id}` : ""}` : "BALLAST QUEUE"}
          </p>
          {plan.kind === "blocked" ? <p className="mt-3 text-sm text-amber">{plan.reason}</p> : null}
          {plan.kind === "ok" && plan.needsApprove ? (
            <p className="mt-3 text-[12.5px] text-dim">Your wallet will ask twice: approve dUSD, then send the request.</p>
          ) : null}
          <div className="mt-4">
            <Button
              className="w-full"
              disabled={!canSubmit}
              tooltip={plan.kind === "ok" ? (v.wrongNetwork ? "Switch to Monad testnet first" : undefined) : plan.reason}
              onClick={submit}
            >
              {deck === "hull" ? "Subscribe to Hull" : "Request Ballast"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Beta allowance and stage capacity — what this wallet can still request. */
function Eligibility() {
  const v = useBook();
  const mine = mapLive(v.wallet, (w) => ({
    allowance: w.betaAllowance,
    used: w.admitted + w.reserved,
  }));
  const stage = mapLive(v.book, (b) => ({
    cap: b.stageCap,
    used: b.lifetimeAdmitted + b.pendingReserved,
  }));
  const both = map2(mine, stage, (m, s) => ({ m, s }));
  return (
    <Card className="mt-8 grid gap-px overflow-hidden sm:grid-cols-2">
      <div className="bg-bg2 px-5 py-4">
        <SectionLabel>YOUR BETA ALLOWANCE</SectionLabel>
        <p className="num mt-1.5 text-lg">
          <Val of={mine}>
            {(m) =>
              m.allowance === 0n ? (
                <span className="text-amber">not invited yet</span>
              ) : (
                `${formatDusd(m.allowance > m.used ? m.allowance - m.used : 0n)} left of ${formatDusd(m.allowance)}`
              )
            }
          </Val>
        </p>
      </div>
      <div className="bg-bg2 px-5 py-4">
        <SectionLabel>BETA STAGE CAPACITY</SectionLabel>
        <p className="num mt-1.5 text-lg">
          <Val of={both}>
            {({ s }) =>
              s.cap === 0n ? (
                <span className="text-amber">not open yet</span>
              ) : (
                `${formatDusd(s.cap > s.used ? s.cap - s.used : 0n)} left of ${formatDusd(s.cap)}`
              )
            }
          </Val>
        </p>
      </div>
    </Card>
  );
}

function DeckPick({
  kind,
  selected,
  onSelect,
  children,
}: {
  kind: TrancheKind;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  const hull = kind === "hull";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`relative flex flex-col text-left ${hull ? "" : "ballast-shimmer"} rounded-[var(--radius-card)] border p-6 sm:p-7 ${
        hull
          ? "bg-[linear-gradient(180deg,rgba(244,241,234,0.07),rgba(244,241,234,0.02))]"
          : "bg-[linear-gradient(180deg,rgba(255,91,41,0.12),rgba(255,91,41,0.02))]"
      } ${selected ? (hull ? "border-hull" : "border-ballast") : hull ? "border-ink/15" : "border-ballast/30"}`}
    >
      <div className={`num mb-7 flex justify-between text-[9.5px] tracking-[0.2em] ${hull ? "text-steel" : "text-[#C89486]"}`}>
        <span>{hull ? "SENIOR" : "JUNIOR"}</span>
        <span className={selected ? (hull ? "text-hull" : "text-ballast") : ""}>{selected ? "● SELECTED" : hull ? "A-DECK" : "B-DECK"}</span>
      </div>
      <h2 className="display text-[44px] leading-[0.9] tracking-[-0.04em] text-ink [font-variation-settings:'wdth'_115] sm:text-[52px]">
        {hull ? "HULL" : "BALLAST"}
      </h2>
      <p className={`num mt-2 mb-6 text-[11.5px] tracking-[0.14em] ${hull ? "text-hull" : "text-ballast"}`}>
        {hull ? "FIXED · PROTECTED" : "LEVERED · FIRST-LOSS"}
      </p>
      {children}
    </button>
  );
}
