/**
 * Decision → Change order (docs: use Change instead of Post + Cancel).
 */
import type { Decision } from "./types.ts";
import type { RequestBudget } from "./budget.ts";

export type ChangeOrder = {
  mt: 22;
  sn: number;
  rq: number;
  mkt: number;
  acc: number;
  oid: number;
  t: 7; // Change
  p: number;
  s: number;
  fl: number;
  lv: number;
  lb: number;
};

export type ExecuteResult =
  | { kind: "skipped"; reason: string }
  | { kind: "queued"; reason: string }
  | { kind: "dry_run"; order: ChangeOrder }
  | { kind: "sent"; order: ChangeOrder };

export type ExecuteCtx = {
  dryRun: boolean;
  budget: RequestBudget;
  marketId: number;
  accountId: number;
  /** Resting order to amend (Change requires oid). */
  restingOrderId: number | null;
  headBlock: number;
  orderTtlBlocks: number;
  nextSn: () => number;
  nextRq: () => number;
  send: (frame: object) => void;
};

/**
 * Map a reduce decision into a Change that shrinks size toward target.
 * Size here is Perpl scaled integer; caller converts notional → size.
 */
export function buildChange(args: {
  oid: number;
  marketId: number;
  accountId: number;
  newSize: number;
  price: number;
  headBlock: number;
  orderTtlBlocks: number;
  sn: number;
  rq: number;
}): ChangeOrder {
  return {
    mt: 22,
    sn: args.sn,
    rq: args.rq,
    mkt: args.marketId,
    acc: args.accountId,
    oid: args.oid,
    t: 7,
    p: args.price,
    s: args.newSize,
    fl: 0,
    lv: 0,
    lb: args.headBlock + args.orderTtlBlocks,
  };
}

export function executeDecision(
  decision: Decision,
  ctx: ExecuteCtx,
  sizeForNotional: (n: bigint) => number,
  limitPrice: number,
): ExecuteResult {
  if (decision.kind === "noop" || decision.kind === "halt" || decision.kind === "crank") {
    return { kind: "skipped", reason: decision.reason };
  }
  if (ctx.restingOrderId == null) {
    return {
      kind: "skipped",
      reason: "no resting order to Change — post a seed order first (GATE-0 if none)",
    };
  }
  const spend = ctx.budget.trySpend("change-order", true);
  if (!spend.ok) {
    return { kind: "queued", reason: "budget_exhausted — queued, not dropped" };
  }
  const order = buildChange({
    oid: ctx.restingOrderId,
    marketId: ctx.marketId,
    accountId: ctx.accountId,
    newSize: sizeForNotional(decision.targetNotional),
    price: limitPrice,
    headBlock: ctx.headBlock,
    orderTtlBlocks: ctx.orderTtlBlocks,
    sn: ctx.nextSn(),
    rq: ctx.nextRq(),
  });
  if (ctx.dryRun) return { kind: "dry_run", order };
  ctx.send(order);
  return { kind: "sent", order };
}
