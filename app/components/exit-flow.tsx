"use client";

import { useState } from "react";
import { useVessel } from "@/lib/context";
import { COPY, planExit, type DeckKind, type ExitPlan } from "@/lib/provider";
import { formatDusd } from "@/lib/format";
import { Button, Card, Modal } from "@/components/ui";
import { Unavailable } from "@/components/live";

/**
 * PHASE 0.1 — the exit path that used to dead-end.
 *
 * After deployLiquidity() roughly 90% of vault cash sits at the engine.
 * Tranches settles an exit with vault.withdraw(), which pays from the vault's
 * own dUSD balance, so a large exit reverts with a bare ERC-20 balance error
 * that a holder has no way to act on. The only recovery — unwind() — existed
 * solely in the e2e script.
 *
 * Here we check liquidity BEFORE asking the user to sign, name the exact
 * shortfall, and offer the unwind inline.
 */
export function ExitFlow({
  open,
  onClose,
  deck,
  shares,
}: {
  open: boolean;
  onClose: () => void;
  deck: DeckKind;
  shares: bigint;
}) {
  const v = useVessel();
  const [busy, setBusy] = useState<"none" | "unwinding" | "exiting">("none");

  const isHull = deck === "hull";
  const plan: ExitPlan = planExit({
    shares,
    deckTvl: isHull ? v.deck.hullTvl : v.deck.balTvl,
    deckSupply: isHull ? v.deck.hullSupply : v.deck.balSupply,
    otherTvl: isHull ? v.deck.balTvl : v.deck.hullTvl,
    idle: v.vault.idle,
    thetaMinBps: v.deck.thetaMinBps,
    exitingBallast: !isHull,
  });

  const name = isHull ? "HULL" : "BALLAST";

  return (
    <Modal open={open} title={`Exit ${name}`} onClose={onClose}>
      {plan.kind === "unknown" ? (
        <div>
          <p className="text-sm text-dim">
            We can&apos;t check whether this exit can be settled right now, so we won&apos;t ask you
            to sign a transaction that might revert.
          </p>
          <p className="num mt-3 rounded-lg border border-white/10 bg-bg px-3 py-2 text-[11.5px] text-steel">
            {plan.reason}
          </p>
          <Button variant="ghost" className="mt-6 w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : null}

      {plan.kind === "blocked-floor" ? (
        <div>
          <p className="num text-2xl">{formatDusd(plan.assetsOut)} dUSD</p>
          <p className="mt-4 text-sm text-amber">{COPY.ballastExit}</p>
          <Button variant="ghost" className="mt-6 w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : null}

      {plan.kind === "ready" ? (
        <div>
          <p className="text-sm text-dim">MAX is selected. This exits the full position.</p>
          <p className="num mt-4 text-2xl">{formatDusd(plan.assetsOut)} dUSD</p>
          <p className="num mt-2 text-[11.5px] text-steel">
            Vault holds{" "}
            {v.vault.idle.status === "ok" ? (
              `${formatDusd(v.vault.idle.value)} dUSD idle`
            ) : (
              <Unavailable reason={v.vault.idle.reason} />
            )}{" "}
            — enough to settle this exit.
          </p>
          <Button
            className="mt-6 w-full"
            loading={busy === "exiting"}
            onClick={() => {
              setBusy("exiting");
              void v
                .withdraw(shares, deck)
                .finally(() => {
                  setBusy("none");
                  onClose();
                });
            }}
          >
            Confirm exit
          </Button>
        </div>
      ) : null}

      {plan.kind === "needs-unwind" ? (
        <div>
          <p className="num text-2xl">{formatDusd(plan.assetsOut)} dUSD</p>

          <Card className="mt-4 border-amber/30 p-4">
            <p className="num text-[10.5px] tracking-[0.16em] text-amber">NOT ENOUGH IDLE CASH</p>
            <p className="mt-2 text-sm text-ink">
              Exit needs {formatDusd(plan.assetsOut)} dUSD; vault holds {formatDusd(plan.idle)} idle.
              The hedge must be unwound first.
            </p>
            <p className="num mt-2 text-[11.5px] text-steel">
              short by {formatDusd(plan.shortfall)} dUSD
              {v.vault.deployed.status === "ok"
                ? ` · ${formatDusd(v.vault.deployed.value)} dUSD is deployed to the engine`
                : null}
            </p>
          </Card>

          <p className="mt-4 text-sm text-dim">{COPY.unwindWhat}</p>
          <p className="mt-2 text-sm text-amber">{COPY.unwindScope}</p>

          <Button
            className="mt-5 w-full"
            loading={busy === "unwinding"}
            disabled={busy !== "none"}
            onClick={() => {
              setBusy("unwinding");
              void v.unwind().finally(() => setBusy("none"));
            }}
          >
            Unwind the hedge
          </Button>
          <Button
            variant="ghost"
            className="mt-2 w-full"
            disabled
            tooltip="Available once the vault holds enough idle dUSD to settle this exit."
          >
            Confirm exit
          </Button>
          <p className="num mt-3 text-center text-[11px] text-steel">
            Unwind is permissionless — you can call it yourself.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

/**
 * Operational unwind control for the transparency screen. Unlike the exit
 * flow this is not tied to a position — it is the public lever, shown as one.
 */
export function UnwindCard({ className = "" }: { className?: string }) {
  const v = useVessel();
  const [busy, setBusy] = useState(false);

  const shortId = v.engine.shortId;
  const deployed = v.vault.deployed;

  // Nothing to unwind is a state we only claim when we could actually read it.
  if (shortId.status === "ok" && shortId.value === 0n) {
    if (deployed.status === "ok" && deployed.value === 0n) return null;
  }

  const blocked =
    !v.connected
      ? "Connect to unwind"
      : v.wrongNetwork
        ? "Switch to Monad testnet first"
        : v.paused.status === "ok" && v.paused.value
          ? "Guardian pause is on"
          : undefined;

  return (
    <Card className={`p-6 ${className}`}>
      <p className="num text-[10.5px] tracking-[0.16em] text-amber">UNWIND</p>
      <p className="display mt-2 text-xl">Close the hedge</p>
      <p className="mt-2 text-sm text-dim">{COPY.unwindWhat}</p>
      <p className="num mt-3 text-[11.5px] text-steel">
        deployed to engine:{" "}
        {deployed.status === "ok" ? (
          `${formatDusd(deployed.value)} dUSD`
        ) : (
          <Unavailable reason={deployed.reason} />
        )}
        {" · "}
        idle in vault:{" "}
        {v.vault.idle.status === "ok" ? (
          `${formatDusd(v.vault.idle.value)} dUSD`
        ) : (
          <Unavailable reason={v.vault.idle.reason} />
        )}
      </p>
      <Button
        variant="ghost"
        className="mt-5 w-full"
        loading={busy}
        disabled={Boolean(blocked)}
        tooltip={blocked}
        onClick={() => {
          setBusy(true);
          void v.unwind().finally(() => setBusy(false));
        }}
      >
        Unwind hedge
      </Button>
      <p className="num mt-3 text-center text-[11px] text-steel">
        Permissionless — anyone can call unwind(). No owner gate.
      </p>
    </Card>
  );
}
