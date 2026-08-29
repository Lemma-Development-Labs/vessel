"use client";

import { useVessel } from "@/lib/context";
import { Button, Card } from "@/components/ui";

export function DeployHedgeCta({ className = "" }: { className?: string }) {
  const v = useVessel();
  const tvl = v.deck.hullTvl + v.deck.balTvl;
  if (v.engine.shortId !== 0n) return null;

  const can = v.connected && tvl > 0n && !v.paused && !v.impaired && !v.wrongNetwork;
  const tooltip = !v.connected
    ? "Connect to deploy"
    : tvl === 0n
      ? "Board a deck first — the engine needs TVL"
      : v.paused
        ? "Guardian pause is on"
        : v.impaired
          ? "HULL IMPAIRMENT — halted"
          : undefined;

  return (
    <Card className={`p-6 ${className}`}>
      <p className="num text-[10.5px] tracking-[0.16em] text-amber">HEDGE</p>
      <p className="display mt-2 text-xl">Deploy the hedge</p>
      <p className="mt-2 text-sm text-dim">
        Engine sends 90% of vault assets: half into WMON through MockRouter, half as venue
        margin, then opens a {v.engine.simulated ? "SimVenue" : v.engine.venueName} short.
        Not PuddleSwap.
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
