"use client";

import { useVessel } from "@/lib/context";
import { map2, valueOrForLogic } from "@/lib/live";
import { Button, Card } from "@/components/ui";
import { Val } from "@/components/live";

export function DeployHedgeCta({ className = "" }: { className?: string }) {
  const v = useVessel();

  const shortId = v.engine.shortId;
  // Only hide the CTA when we actually know a position is open. If the read
  // failed we still show it, disabled, with the reason — hiding a control
  // because a read failed silently removes an action the user may need.
  if (shortId.status === "ok" && shortId.value !== 0n) return null;

  const tvl = map2(v.deck.hullTvl, v.deck.balTvl, (h, b) => h + b);
  const tvlN = valueOrForLogic(tvl, 0n);
  const paused = valueOrForLogic(v.paused, false);
  const simulated = valueOrForLogic(v.engine.simulated, true);

  const can =
    v.connected &&
    shortId.status === "ok" &&
    tvl.status === "ok" &&
    tvlN > 0n &&
    !paused &&
    !v.impaired &&
    !v.wrongNetwork;

  const tooltip = !v.connected
    ? "Connect to deploy"
    : v.wrongNetwork
      ? "Switch to Monad testnet first"
      : shortId.status !== "ok"
        ? `Position state unavailable — ${shortId.reason}`
        : tvl.status !== "ok"
          ? `Deck TVL unavailable — ${tvl.reason}`
          : tvlN === 0n
            ? "Board a deck first — the engine needs TVL"
            : paused
              ? "Guardian pause is on"
              : v.impaired
                ? "HULL IMPAIRMENT — halted"
                : undefined;

  return (
    <Card className={`p-6 ${className}`}>
      <p className="num text-[10.5px] tracking-[0.16em] text-amber">HEDGE</p>
      <p className="display mt-2 text-xl">Deploy the hedge</p>
      <p className="mt-2 text-sm text-dim">
        Engine sends 90% of vault assets: half into WMON through{" "}
        {simulated ? "MockRouter" : "the DEX router"}, half as venue margin, then opens a{" "}
        <Val of={v.engine.venueName}>{(n) => n}</Val> short. Not PuddleSwap.
      </p>
      <p className="num mt-3 text-[11.5px] text-steel">
        After this, most vault cash sits at the engine — a large exit will need an unwind first.
      </p>
      <Button
        className="mt-5 w-full"
        disabled={!can}
        tooltip={tooltip}
        onClick={() => void v.deployLiquidity()}
      >
        Deploy hedge
      </Button>
    </Card>
  );
}
