import { encodeFunctionData, parseAbi, toFunctionSelector, type Address } from "viem";
import type { Allowed, PlannedAction } from "./keeper.ts";

/**
 * v2 keeper policy: a PURE function from observed controller state to at most
 * one action. The keeper persists, signs and dispatches it through the durable
 * journal. Every action here is either permissionless on the controller or an
 * operator-only internal transfer between custody and the engine.
 */
export const POLICY_VERSION = "v2-keeper-policy-1";

export const controllerWriteAbi = parseAbi([
  "function settle()",
  "function processDepositBatch(uint256)",
  "function processExitBatch(uint256)",
  "function activateSeries(uint256)",
  "function matureSeries(uint256)",
  "function fundSeries(uint256)",
  "function deployToEngine(uint256)",
  "function recallFromEngine(uint256)",
]);

const ACTIONS = [
  "settle()",
  "processDepositBatch(uint256)",
  "processExitBatch(uint256)",
  "activateSeries(uint256)",
  "matureSeries(uint256)",
  "fundSeries(uint256)",
  "deployToEngine(uint256)",
  "recallFromEngine(uint256)",
] as const;

export function allowlist(controller: Address): Allowed[] {
  return ACTIONS.map((sig) => ({ target: controller, selector: toFunctionSelector(sig), action: sig.split("(")[0]! }));
}

export interface Observed {
  now: bigint;
  /** controller state */
  pendingBallastDeposits: bigint; // queue length − head
  pendingExits: bigint; // exit queue length − head
  /** requestedAt + EXIT_COOLDOWN of the exit at the head of the queue (0 when none) */
  headExitReadyAt: bigint;
  activeSeries: bigint;
  seriesState: number; // SeriesState enum
  subscriptionEnd: bigint;
  maturity: bigint;
  hullNav: bigint;
  impaired: boolean;
  /** book */
  activeIdle: bigint;
  engineValue: bigint;
  treasuryLiability: bigint;
  engineWired: boolean;
  /** keeper memory (from the journal) */
  lastSettleAt: bigint;
}

export interface PolicyConfig {
  settleEverySec: bigint;
  batchSize: bigint;
  idleTargetBps: bigint; // e.g. 1_500 = keep 15% idle (10% is the on-chain floor)
  minMove: bigint; // don't shuffle dust
}

const SUBSCRIPTION_OPEN = 1;
const ACTIVE = 3;
const MATURED_UNWINDING = 4;
const IMPAIRED = 7;

const call = (fn: (typeof controllerWriteAbi)[number]["name"], args: readonly bigint[] = []) =>
  encodeFunctionData({ abi: controllerWriteAbi, functionName: fn, args } as never);

export function decide(o: Observed, cfg: PolicyConfig, controller: Address): PlannedAction | null {
  const plan = (id: string, action: string, calldata: string, inputs: object): PlannedAction => ({
    clientRequestId: id,
    action,
    target: controller,
    calldata,
    inputs: { ...inputs, policyVersion: POLICY_VERSION },
  });
  const sid = o.activeSeries;

  // 1. Series lifecycle first: time-bound obligations.
  if (sid > 0n && o.seriesState === SUBSCRIPTION_OPEN && o.now >= o.subscriptionEnd) {
    return plan(`activate:${sid}`, "activateSeries", call("activateSeries", [sid]), { series: sid.toString() });
  }
  if (sid > 0n && (o.seriesState === ACTIVE && o.now >= o.maturity || o.seriesState === IMPAIRED)) {
    return plan(`mature:${sid}`, "matureSeries", call("matureSeries", [sid]), { series: sid.toString() });
  }
  if (sid > 0n && o.seriesState === MATURED_UNWINDING && o.hullNav > 0n) {
    const liquid = o.activeIdle > o.treasuryLiability ? o.activeIdle - o.treasuryLiability : 0n;
    if (liquid < o.hullNav && o.engineValue > 0n) {
      const amount = o.hullNav - liquid < o.engineValue ? o.hullNav - liquid : o.engineValue;
      return plan(`recall-for-series:${sid}:${o.now / 60n}`, "recallFromEngine", call("recallFromEngine", [amount]), { amount: amount.toString() });
    }
    return plan(`fund:${sid}:${o.hullNav}`, "fundSeries", call("fundSeries", [sid]), { series: sid.toString() });
  }

  // 2. Queues.
  if (o.pendingBallastDeposits > 0n && !o.impaired) {
    return plan(`deposits:${o.now / 300n}`, "processDepositBatch", call("processDepositBatch", [cfg.batchSize]), {
      pending: o.pendingBallastDeposits.toString(),
    });
  }
  // Exits fill only after their cooldown, in order: calling earlier settles and stops at the head,
  // which costs gas every time and moves nobody's money.
  if (o.pendingExits > 0n && !o.impaired && o.now >= o.headExitReadyAt) {
    return plan(`exits:${o.now / 900n}`, "processExitBatch", call("processExitBatch", [cfg.batchSize]), {
      pending: o.pendingExits.toString(),
    });
  }

  // 3. Keep the idle buffer near target (never below the on-chain 10% floor).
  if (o.engineWired && !o.impaired && o.seriesState !== MATURED_UNWINDING) {
    const a = o.activeIdle + o.engineValue - o.treasuryLiability;
    const target = (a * cfg.idleTargetBps) / 10_000n + o.treasuryLiability;
    if (o.activeIdle > target + cfg.minMove) {
      const amount = o.activeIdle - target;
      return plan(`deploy:${o.now / 900n}`, "deployToEngine", call("deployToEngine", [amount]), { amount: amount.toString() });
    }
  }

  // 4. Regular settlement so income is recognized and visible.
  if (o.now - o.lastSettleAt >= cfg.settleEverySec) {
    return plan(`settle:${o.now / cfg.settleEverySec}`, "settle", call("settle"), {});
  }
  return null;
}
