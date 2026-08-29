"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useVessel } from "@/lib/context";
import { COPY, thetaWouldHold, type DeckKind } from "@/lib/provider";
import { MIN_JOIN } from "@/lib/gas";
import { formatBps, formatDusd, parseDusd } from "@/lib/format";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { DeployHedgeCta } from "@/components/hedge-cta";

export function DepositScreen() {
  const v = useVessel();
  const router = useRouter();
  const [amt, setAmt] = useState("250");
  const [deck, setDeck] = useState<DeckKind>("ballast");
  const [done, setDone] = useState<{ amount: bigint; deck: DeckKind } | null>(null);

  const validShape = /^\d+(\.\d{0,6})?$/.test(amt.trim());
  const parsed = validShape ? parseDusd(amt) : 0n;
  const over = parsed > v.dusdBalance;
  const hullAfter = deck === "hull" ? v.deck.hullTvl + parsed : v.deck.hullTvl;
  const balAfter = deck === "ballast" ? v.deck.balTvl + parsed : v.deck.balTvl;
  const floorOk = thetaWouldHold(hullAfter, balAfter);
  const joinOk =
    v.connected &&
    validShape &&
    parsed >= MIN_JOIN &&
    !over &&
    floorOk &&
    !v.paused &&
    !v.wrongNetwork;

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
        <EmptyState
          title="Connect to board"
          action={<Button onClick={() => void v.connect()}>Connect wallet</Button>}
        />
        <p className="mt-4 text-center text-sm text-dim">
          Use a Monad-ready wallet in this browser (Phantom, MetaMask). Demo dollars only.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-5 md:py-14">
      <p className="num text-[10.5px] tracking-[0.18em] text-steel">DEPOSIT</p>
      <h1 className="display mt-3 text-[32px] font-bold leading-[1.04] tracking-[-0.02em] sm:text-[40px] md:text-[44px]">
        Board a deck
      </h1>
      <p className="mt-3 max-w-xl text-base text-dim">
        Deposit demo dollars. Choose how you ride the yield.
      </p>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="num text-[10px] tracking-[0.16em] text-steel">dUSD BALANCE</p>
          <p className="num mt-1 text-3xl">{formatDusd(v.dusdBalance)}</p>
        </div>
        <Button
          variant="ghost"
          onClick={() => void v.faucet()}
          tooltip={v.faucetCooldownSec > 0 ? COPY.cooldown(v.faucetCooldownSec) : undefined}
          disabled={v.faucetCooldownSec > 0}
        >
          Get test dollars
        </Button>
      </div>
      {v.dusdBalance === 0n ? (
        <p className="mt-2 text-sm text-amber">Zero balance — faucet 100 dUSD to board.</p>
      ) : null}

      <div className="mt-8 border-b border-white/12 pb-4">
        <div className="flex items-center justify-between">
          <span className="num text-[10.5px] tracking-[0.16em] text-steel">AMOUNT</span>
          <button
            type="button"
            className="num min-h-11 text-[11px] text-purple"
            onClick={() => setAmt(formatDusd(v.dusdBalance).replace(/,/g, ""))}
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
        <p className="mt-2 text-sm text-dim">
          You&apos;re depositing {validShape ? formatDusd(parsed) : "0.00"} dUSD
        </p>
        {over ? (
          <p className="mt-2 text-sm text-red">Amount exceeds your dUSD balance.</p>
        ) : null}
      </div>

      <div role="radiogroup" aria-label="Deck" className="mt-8 grid gap-4 sm:grid-cols-2">
        <DeckPick
          kind="hull"
          selected={deck === "hull"}
          onSelect={() => setDeck("hull")}
          tvl={v.deck.hullTvl}
          theta={v.deck.thetaBps}
        />
        <DeckPick
          kind="ballast"
          selected={deck === "ballast"}
          onSelect={() => setDeck("ballast")}
          tvl={v.deck.balTvl}
          theta={v.deck.thetaBps}
          leverage={v.deck.balLeveredAprBps}
        />
      </div>

      {done ? (
        <Card className="mt-8 p-6 sm:p-8">
          <p className="num flex items-center gap-2 text-[10.5px] tracking-[0.16em] text-phosphor">
            <span className="h-1.5 w-1.5 rounded-full bg-phosphor" />
            ABOARD
          </p>
          <p className="display mt-4 text-2xl">
            Aboard. {formatDusd(done.amount)} dUSD on the {done.deck === "hull" ? "Hull" : "Ballast"}{" "}
            deck.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => router.push("/portfolio")}>View portfolio</Button>
            <Button variant="ghost" onClick={() => setDone(null)}>
              Deposit again
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="mt-8 p-6">
          <p className="num text-sm text-dim">
            {formatDusd(parsed)} dUSD → {deck === "hull" ? "HULL" : "BALLAST"}
          </p>
          <div className="mt-4">
            <Button
              className="w-full"
              disabled={!joinOk}
              tooltip={
                !floorOk && deck === "hull"
                  ? COPY.hullFull
                  : over
                    ? "Amount exceeds balance"
                    : parsed > 0n && parsed < MIN_JOIN
                      ? "Min join is 1 dUSD"
                      : undefined
              }
              onClick={() => {
                void (async () => {
                  try {
                    await v.deposit(parsed, deck);
                    setDone({ amount: parsed, deck });
                  } catch {
                    /* toast already shown */
                  }
                })();
              }}
            >
              Board {deck === "hull" ? "Hull" : "Ballast"}
            </Button>
          </div>
        </Card>
      )}

      <DeployHedgeCta className="mt-8" />
    </div>
  );
}

function DeckPick({
  kind,
  selected,
  onSelect,
  tvl,
  theta,
  leverage,
}: {
  kind: DeckKind;
  selected: boolean;
  onSelect: () => void;
  tvl: bigint;
  theta: bigint;
  leverage?: bigint;
}) {
  const hull = kind === "hull";
  const thetaN = Number(theta) / 100;
  const cushion =
    thetaN >= 20
      ? `${thetaN.toFixed(1)}% — above the 20% floor`
      : thetaN >= 19
        ? `${thetaN.toFixed(1)}% — near the 20% floor`
        : `${thetaN.toFixed(1)}% — below the 20% floor`;
  const cushionTone = thetaN >= 20 ? "text-phosphor" : thetaN >= 19 ? "text-amber" : "text-red";

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
      className={`relative text-left ${hull ? "" : "ballast-shimmer"} rounded-[var(--radius-card)] border bg-bg2 p-5 sm:p-6 ${
        selected
          ? hull
            ? "border-2 border-steel"
            : "border-2 border-brass"
          : hull
            ? "border-line"
            : "border-brass/30"
      }`}
    >
      {selected ? (
        <span className={`num absolute right-4 top-4 text-[10px] tracking-[0.14em] ${hull ? "text-steel" : "text-brass"}`}>
          ●
        </span>
      ) : null}
      <p className={`num text-[10px] tracking-[0.18em] ${hull ? "text-steel" : "text-brass"}`}>
        {hull ? "SENIOR" : "JUNIOR"}
      </p>
      <h2 className={`display mt-2 text-[26px] font-bold tracking-[0.03em] sm:text-[30px] ${hull ? "text-[#C2D2E0]" : "text-brass"}`}>
        {hull ? "HULL" : "BALLAST"}
      </h2>
      <p className="mt-1 text-sm text-dim">{hull ? "Fixed. Protected." : "Levered. First-loss."}</p>
      <p className="num mt-4 text-[20px] sm:text-[22px]">
        {hull ? "8.00% APR — fixed" : "≈ 19.4% APR — variable, levered residual"}
      </p>
      <ul className="mt-4 space-y-1 text-[13.5px] text-steel">
        {hull ? (
          <>
            <li>Senior — losses reach you last</li>
            <li>Backed by Ballast + reserve</li>
            <li>Demo series: exit anytime today</li>
          </>
        ) : (
          <>
            <li>Absorbs shocks first — and gets paid for it</li>
            <li>Yield = everything above Hull&apos;s rate</li>
            <li>Exit guarded by the 20% floor</li>
          </>
        )}
      </ul>
      <div className="mt-5 flex flex-wrap justify-between gap-2 text-[12px]">
        <span className="num text-dim">
          {hull ? "Hull" : "Bal"} TVL {formatDusd(tvl)}
        </span>
        {hull ? (
          <span className={`num ${cushionTone}`}>{cushion}</span>
        ) : (
          <span className="num text-brass">leverage {leverage ? formatBps(leverage) : "—"}</span>
        )}
      </div>
    </button>
  );
}
