import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { allowlist, controllerWriteAbi, decide, type Observed, type PolicyConfig } from "../src/v2/policy.ts";

const C = "0x00000000000000000000000000000000000000c1" as const;
const cfg: PolicyConfig = { settleEverySec: 3600n, batchSize: 10n, idleTargetBps: 1_500n, minMove: 1_000_000n };
const base = (): Observed => ({
  now: 1_800_000_000n,
  pendingBallastDeposits: 0n,
  pendingExits: 0n,
  activeSeries: 0n,
  seriesState: 0,
  subscriptionEnd: 0n,
  maturity: 0n,
  hullNav: 0n,
  impaired: false,
  activeIdle: 150_000_000n,
  engineValue: 850_000_000n,
  treasuryLiability: 0n,
  lastSettleAt: 1_800_000_000n,
});
const fn = (o: Observed) => {
  const p = decide(o, cfg, C);
  return p ? decodeFunctionData({ abi: controllerWriteAbi, data: p.calldata as `0x${string}` }) : null;
};

describe("v2 keeper policy", () => {
  it("does nothing when the book is balanced and recently settled", () => {
    expect(decide(base(), cfg, C)).toBeNull();
  });

  it("activates a series once its window has closed, before anything else", () => {
    const o = { ...base(), activeSeries: 1n, seriesState: 1, subscriptionEnd: 1_799_999_999n, pendingBallastDeposits: 3n };
    expect(fn(o)?.functionName).toBe("activateSeries");
  });

  it("matures at term, recalls what funding needs, then funds", () => {
    const active = { ...base(), activeSeries: 1n, seriesState: 3, maturity: 1_799_000_000n };
    expect(fn(active)?.functionName).toBe("matureSeries");
    const unwinding = { ...base(), activeSeries: 1n, seriesState: 4, hullNav: 500_000_000n };
    const r = fn(unwinding);
    expect(r?.functionName).toBe("recallFromEngine");
    expect(r?.args?.[0]).toBe(350_000_000n); // 500 owed − 150 idle
    expect(fn({ ...unwinding, activeIdle: 600_000_000n })?.functionName).toBe("fundSeries");
  });

  it("admits deposits and funds exits, but not while impaired", () => {
    expect(fn({ ...base(), pendingBallastDeposits: 2n })?.functionName).toBe("processDepositBatch");
    expect(fn({ ...base(), pendingExits: 1n })?.functionName).toBe("processExitBatch");
    expect(fn({ ...base(), pendingExits: 1n, impaired: true, lastSettleAt: 0n })?.functionName).toBe("settle");
  });

  it("deploys only the excess above the idle target, never below it", () => {
    const r = fn({ ...base(), activeIdle: 400_000_000n, engineValue: 600_000_000n });
    expect(r?.functionName).toBe("deployToEngine");
    expect(r?.args?.[0]).toBe(250_000_000n); // keep 15% of 1,000 idle
    expect(fn({ ...base(), activeIdle: 150_500_000n, engineValue: 849_500_000n })).toBeNull(); // below minMove
  });

  it("settles on schedule", () => {
    expect(fn({ ...base(), lastSettleAt: 1_800_000_000n - 3600n })?.functionName).toBe("settle");
  });

  it("every planned call is on the allowlist and nothing else is", () => {
    const allow = allowlist(C);
    expect(allow).toHaveLength(8);
    const plans = [
      decide({ ...base(), pendingBallastDeposits: 1n }, cfg, C),
      decide({ ...base(), lastSettleAt: 0n }, cfg, C),
      decide({ ...base(), activeIdle: 500_000_000n, engineValue: 500_000_000n }, cfg, C),
    ];
    for (const p of plans) expect(allow.some((a) => p!.calldata.startsWith(a.selector))).toBe(true);
  });
});
