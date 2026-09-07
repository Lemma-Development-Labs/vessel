import {
  EngineLite,
  Tranches,
  BlitzVault,
  SimVenue,
  Guardian,
} from "generated";
import type {
  Crank,
  CrankCursor,
  Deposit,
  Withdrawal,
  FundingPrint,
  FundingCursor,
  DeltaSnapshot,
  TrancheNav,
  Halt,
} from "generated";

const CRANK_CURSOR_ID = "engine-net-delta";
const FUNDING_CURSOR_ID = "simvenue-funding";
const OPEN_HALT_ID = "open-halt";

function idOf(chainId: number, block: number, logIndex: number): string {
  return `${chainId}_${block}_${logIndex}`;
}

function gasLimitOf(event: { transaction: { gas?: bigint | null } }): bigint {
  // Monad bills gas_limit. Prefer transaction.gas; never invent from gasUsed.
  return event.transaction.gas ?? 0n;
}

function txHashOf(event: { transaction: { hash?: string | null } }): string {
  return event.transaction.hash ?? "";
}

function tsOf(event: { block: { timestamp: number } }): bigint {
  return BigInt(event.block.timestamp);
}

function blockOf(event: { block: { number: number } }): bigint {
  return BigInt(event.block.number);
}

// ─── EngineLite ─────────────────────────────────────────────────────────────

EngineLite.Cranked.handler(async ({ event, context }) => {
  const cursor = await context.CrankCursor.get(CRANK_CURSOR_ID);
  const deltaBefore = cursor?.deltaAfter ?? 0n;
  const deltaAfter = event.params.netDeltaBps;

  const crank: Crank = {
    id: idOf(event.chainId, event.block.number, event.logIndex),
    block: blockOf(event),
    ts: tsOf(event),
    actor: event.params.caller,
    decision: "crank",
    gasLimit: gasLimitOf(event),
    deltaBefore,
    deltaAfter,
    txHash: txHashOf(event),
  };
  context.Crank.set(crank);

  const next: CrankCursor = { id: CRANK_CURSOR_ID, deltaAfter };
  context.CrankCursor.set(next);

  // Do NOT invent spotInventory/shortNotional = 0 on crank — that fabricates
  // inventory on the highest-trust tape. DeltaSnapshot for inventory only on
  // LiquidityDeployed / Unwound where event params carry real amounts.
  // netDelta lives on Crank (+ CrankCursor) from the event.
});

EngineLite.LiquidityDeployed.handler(async ({ event, context }) => {
  const snap: DeltaSnapshot = {
    id: idOf(event.chainId, event.block.number, event.logIndex) + "_deploy",
    block: blockOf(event),
    ts: tsOf(event),
    spotInventory: event.params.wmonOut,
    shortNotional: event.params.toSpot,
    netDelta: 0n,
    deviationBps: 0n,
    txHash: txHashOf(event),
  };
  context.DeltaSnapshot.set(snap);

  const crank: Crank = {
    id: idOf(event.chainId, event.block.number, event.logIndex) + "_deploy",
    block: blockOf(event),
    ts: tsOf(event),
    actor: event.transaction.from ?? "",
    decision: "deployLiquidity",
    gasLimit: gasLimitOf(event),
    deltaBefore: 0n,
    deltaAfter: 0n,
    txHash: txHashOf(event),
  };
  context.Crank.set(crank);
});

EngineLite.Unwound.handler(async ({ event, context }) => {
  const crank: Crank = {
    id: idOf(event.chainId, event.block.number, event.logIndex) + "_unwind",
    block: blockOf(event),
    ts: tsOf(event),
    actor: event.transaction.from ?? "",
    decision: "unwind",
    gasLimit: gasLimitOf(event),
    deltaBefore: 0n,
    deltaAfter: 0n,
    txHash: txHashOf(event),
  };
  context.Crank.set(crank);
});

EngineLite.Wired.handler(async ({ event, context }) => {
  const crank: Crank = {
    id: idOf(event.chainId, event.block.number, event.logIndex) + "_wired",
    block: blockOf(event),
    ts: tsOf(event),
    actor: event.transaction.from ?? "",
    decision: "wire",
    gasLimit: gasLimitOf(event),
    deltaBefore: 0n,
    deltaAfter: 0n,
    txHash: txHashOf(event),
  };
  context.Crank.set(crank);
});

EngineLite.SpotPnlCapped.handler(async () => {
  // Informational — no separate entity; Cranked row already lands for the same tx.
});

// ─── Tranches ───────────────────────────────────────────────────────────────

Tranches.JoinedHull.handler(async ({ event, context }) => {
  const row: Deposit = {
    id: idOf(event.chainId, event.block.number, event.logIndex),
    block: blockOf(event),
    ts: tsOf(event),
    actor: event.params.user,
    tranche: "hull",
    assets: event.params.assets,
    shares: event.params.shares,
    txHash: txHashOf(event),
  };
  context.Deposit.set(row);
});

Tranches.JoinedBallast.handler(async ({ event, context }) => {
  const row: Deposit = {
    id: idOf(event.chainId, event.block.number, event.logIndex),
    block: blockOf(event),
    ts: tsOf(event),
    actor: event.params.user,
    tranche: "ballast",
    assets: event.params.assets,
    shares: event.params.shares,
    txHash: txHashOf(event),
  };
  context.Deposit.set(row);
});

Tranches.ExitedHull.handler(async ({ event, context }) => {
  const row: Withdrawal = {
    id: idOf(event.chainId, event.block.number, event.logIndex),
    block: blockOf(event),
    ts: tsOf(event),
    actor: event.params.user,
    tranche: "hull",
    assets: event.params.assets,
    shares: event.params.shares,
    txHash: txHashOf(event),
  };
  context.Withdrawal.set(row);
});

Tranches.ExitedBallast.handler(async ({ event, context }) => {
  const row: Withdrawal = {
    id: idOf(event.chainId, event.block.number, event.logIndex),
    block: blockOf(event),
    ts: tsOf(event),
    actor: event.params.user,
    tranche: "ballast",
    assets: event.params.assets,
    shares: event.params.shares,
    txHash: txHashOf(event),
  };
  context.Withdrawal.set(row);
});

Tranches.Waterfall.handler(async ({ event, context }) => {
  const nav: TrancheNav = {
    id: idOf(event.chainId, event.block.number, event.logIndex),
    block: blockOf(event),
    ts: BigInt(event.params.ts),
    hullNav: event.params.hullTvl,
    ballastNav: event.params.balTvl,
    reserveNav: event.params.reserve,
    txHash: txHashOf(event),
  };
  context.TrancheNav.set(nav);
});

// ─── BlitzVault (raw 4626 — only Tranches should call; still tape the surface) ─

BlitzVault.Deposit.handler(async ({ event, context }) => {
  const row: Deposit = {
    id: idOf(event.chainId, event.block.number, event.logIndex) + "_vault",
    block: blockOf(event),
    ts: tsOf(event),
    actor: event.params.owner,
    tranche: "vault",
    assets: event.params.assets,
    shares: event.params.shares,
    txHash: txHashOf(event),
  };
  context.Deposit.set(row);
});

BlitzVault.Withdraw.handler(async ({ event, context }) => {
  const row: Withdrawal = {
    id: idOf(event.chainId, event.block.number, event.logIndex) + "_vault",
    block: blockOf(event),
    ts: tsOf(event),
    actor: event.params.owner,
    tranche: "vault",
    assets: event.params.assets,
    shares: event.params.shares,
    txHash: txHashOf(event),
  };
  context.Withdrawal.set(row);
});

// ─── SimVenue funding (PerplVenue live events GATE-0) ────────────────────────

SimVenue.RateSet.handler(async ({ event, context }) => {
  const cursor = await context.FundingCursor.get(FUNDING_CURSOR_ID);
  const next: FundingCursor = {
    id: FUNDING_CURSOR_ID,
    cumulative: cursor?.cumulative ?? 0n,
    lastRateBps: event.params.rateBps,
  };
  context.FundingCursor.set(next);
});

SimVenue.FundingSwept.handler(async ({ event, context }) => {
  const cursor = await context.FundingCursor.get(FUNDING_CURSOR_ID);
  const realized = event.params.realized;
  const prev = cursor?.cumulative ?? 0n;
  const cumulative = prev + realized;
  const rateBps = cursor?.lastRateBps ?? 0n;
  const sign = realized < 0n ? -1 : realized > 0n ? 1 : 0;

  const print: FundingPrint = {
    id: idOf(event.chainId, event.block.number, event.logIndex),
    block: blockOf(event),
    ts: tsOf(event),
    market: `simvenue:${event.params.id.toString()}`,
    rateBps: rateBps < 0n ? -rateBps : rateBps,
    sign,
    cumulative,
    txHash: txHashOf(event),
  };
  context.FundingPrint.set(print);

  context.FundingCursor.set({
    id: FUNDING_CURSOR_ID,
    cumulative,
    lastRateBps: rateBps,
  });
});

// ─── Guardian halt ──────────────────────────────────────────────────────────

Guardian.Paused.handler(async ({ event, context }) => {
  const halt: Halt = {
    id: OPEN_HALT_ID,
    block: blockOf(event),
    ts: tsOf(event),
    reason: `paused by ${event.params.account}`,
    clearedAtBlock: undefined,
    txHash: txHashOf(event),
  };
  context.Halt.set(halt);
});

Guardian.Unpaused.handler(async ({ event, context }) => {
  const open = await context.Halt.get(OPEN_HALT_ID);
  if (open) {
    context.Halt.set({
      ...open,
      clearedAtBlock: blockOf(event),
    });
  }
});
