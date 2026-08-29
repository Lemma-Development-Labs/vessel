import { describe, expect, it } from "vitest";
import { ok, unavailable, type Live } from "../live";
import { planExit } from "../provider";

/**
 * PHASE 0.1 — the exit path that used to dead-end.
 *
 * This covers the UI's decision logic: given the vault state at each step of
 * deposit → deployLiquidity → exit → unwind → exit, does the app correctly
 * decide whether to let the user sign?
 *
 * The numbers below are not invented. They are the arithmetic the contracts
 * actually perform, mirrored from:
 *   BlitzVault.deployable()  = totalAssets * 9000 / 10000 - deployed
 *   Tranches.exitHull()      = shares * hullTvl / hullSupply   (floor)
 *   Tranches._withdrawTo()   = vault.withdraw(assetsOut) — pays from the
 *                              vault's own dUSD balance, so it reverts when
 *                              assetsOut exceeds idle.
 * The on-chain half of this sequence is proved separately by the Foundry
 * integration test in contracts/test/integration/.
 */

const M = 1_000_000n; // 1 dUSD, 6dp
const SHARE = 1_000_000_000_000n; // Tranches.SHARES_OFFSET

/** Deck state after both decks join 400 dUSD, plus the 100 dUSD dead seed. */
const HULL_TVL = 400n * M;
const BAL_TVL = 400n * M;
const DEAD = 100n * M;
const TOTAL_ASSETS = HULL_TVL + BAL_TVL + DEAD; // 900 dUSD
const HULL_SUPPLY = HULL_TVL * SHARE;
const BAL_SUPPLY = BAL_TVL * SHARE;

/** BlitzVault.DEPLOYABLE_BPS = 9000. */
const DEPLOYED = (TOTAL_ASSETS * 9_000n) / 10_000n; // 810 dUSD
const IDLE_AFTER_DEPLOY = TOTAL_ASSETS - DEPLOYED; // 90 dUSD

const THETA_MIN = ok(2_000n, "chain", 100) as Live<bigint>;

function hullExit(shares: bigint, idle: bigint) {
  return planExit({
    shares,
    deckTvl: ok(HULL_TVL, "chain", 100),
    deckSupply: ok(HULL_SUPPLY, "chain", 100),
    otherTvl: ok(BAL_TVL, "chain", 100),
    idle: ok(idle, "chain", 100),
    thetaMinBps: THETA_MIN,
    exitingBallast: false,
  });
}

describe("exit → blocked → unwind → exit", () => {
  it("step 1: before deployLiquidity the whole position exits cleanly", () => {
    // All 900 dUSD is idle in the vault.
    const plan = hullExit(HULL_SUPPLY, TOTAL_ASSETS);
    expect(plan.kind).toBe("ready");
    if (plan.kind === "ready") expect(plan.assetsOut).toBe(400n * M);
  });

  it("step 2: after deployLiquidity a full Hull exit is blocked on liquidity", () => {
    // 810 of 900 is at the engine; only 90 is idle. A 400 dUSD exit cannot
    // be paid, and on chain this reverts inside vault.withdraw with a bare
    // ERC-20 balance error the holder cannot act on.
    const plan = hullExit(HULL_SUPPLY, IDLE_AFTER_DEPLOY);
    expect(plan.kind).toBe("needs-unwind");
    if (plan.kind === "needs-unwind") {
      expect(plan.assetsOut).toBe(400n * M);
      expect(plan.idle).toBe(90n * M);
      // The exact number the UI puts in front of the user.
      expect(plan.shortfall).toBe(310n * M);
    }
  });

  it("step 2b: a small exit still succeeds while the hedge is deployed", () => {
    // 50 dUSD out of 90 idle — no unwind needed. The blocking must be
    // proportionate, not a blanket "hedge is deployed, no exits".
    const shares = (50n * M * SHARE * HULL_TVL) / (HULL_TVL * HULL_TVL / (HULL_TVL / (400n * M)));
    const fiftyShares = 50n * M * SHARE;
    const plan = hullExit(fiftyShares, IDLE_AFTER_DEPLOY);
    expect(plan.kind).toBe("ready");
    if (plan.kind === "ready") expect(plan.assetsOut).toBe(50n * M);
    expect(shares).toBeTypeOf("bigint");
  });

  it("step 3: after unwind everything returns to the vault and the exit clears", () => {
    // EngineLite.unwind() closes the short, swaps WMON back and returns all
    // dUSD, so deployed goes to 0 and idle is the full book again.
    const plan = hullExit(HULL_SUPPLY, TOTAL_ASSETS);
    expect(plan.kind).toBe("ready");
  });

  it("the shortfall is exactly assetsOut - idle at every level", () => {
    for (const idle of [0n, 1n, 90n * M, 399n * M, 399_999_999n]) {
      const plan = hullExit(HULL_SUPPLY, idle);
      expect(plan.kind).toBe("needs-unwind");
      if (plan.kind === "needs-unwind") {
        expect(plan.shortfall).toBe(plan.assetsOut - plan.idle);
      }
    }
  });
});

describe("planExit refuses to guess", () => {
  it("returns unknown — not ready — when vault liquidity cannot be read", () => {
    const plan = planExit({
      shares: HULL_SUPPLY,
      deckTvl: ok(HULL_TVL, "chain", 100),
      deckSupply: ok(HULL_SUPPLY, "chain", 100),
      otherTvl: ok(BAL_TVL, "chain", 100),
      idle: unavailable("vault balance read reverted"),
      thetaMinBps: THETA_MIN,
      exitingBallast: false,
    });
    // Optimistically calling this "ready" would cost the user a reverted tx.
    expect(plan.kind).toBe("unknown");
    if (plan.kind === "unknown") expect(plan.reason).toContain("vault balance read reverted");
  });

  it("returns unknown when the deck TVL or supply cannot be read", () => {
    const noTvl = planExit({
      shares: HULL_SUPPLY,
      deckTvl: unavailable("deck stats call reverted"),
      deckSupply: ok(HULL_SUPPLY, "chain", 100),
      otherTvl: ok(BAL_TVL, "chain", 100),
      idle: ok(TOTAL_ASSETS, "chain", 100),
      thetaMinBps: THETA_MIN,
      exitingBallast: false,
    });
    expect(noTvl.kind).toBe("unknown");

    const noSupply = planExit({
      shares: HULL_SUPPLY,
      deckTvl: ok(HULL_TVL, "chain", 100),
      deckSupply: unavailable("supply read reverted"),
      otherTvl: ok(BAL_TVL, "chain", 100),
      idle: ok(TOTAL_ASSETS, "chain", 100),
      thetaMinBps: THETA_MIN,
      exitingBallast: false,
    });
    expect(noSupply.kind).toBe("unknown");
  });

  it("returns unknown when the floor inputs are missing on a Ballast exit", () => {
    const plan = planExit({
      shares: BAL_SUPPLY,
      deckTvl: ok(BAL_TVL, "chain", 100),
      deckSupply: ok(BAL_SUPPLY, "chain", 100),
      otherTvl: ok(HULL_TVL, "chain", 100),
      idle: ok(TOTAL_ASSETS, "chain", 100),
      thetaMinBps: unavailable("THETA_MIN_BPS read reverted"),
      exitingBallast: true,
    });
    expect(plan.kind).toBe("unknown");
  });
});

describe("the subordination floor still gates Ballast exits", () => {
  it("blocks a full Ballast exit that would drop the ratio below the floor", () => {
    // Hull 400 stays; Ballast 400 -> 0 gives a 0% ratio, far under 20%.
    const plan = planExit({
      shares: BAL_SUPPLY,
      deckTvl: ok(BAL_TVL, "chain", 100),
      deckSupply: ok(BAL_SUPPLY, "chain", 100),
      otherTvl: ok(HULL_TVL, "chain", 100),
      idle: ok(TOTAL_ASSETS, "chain", 100),
      thetaMinBps: THETA_MIN,
      exitingBallast: true,
    });
    expect(plan.kind).toBe("blocked-floor");
  });

  it("allows a partial Ballast exit that stays above the floor", () => {
    // 400 -> 300 against Hull 400 is 300/700 = 42.8%, well above 20%.
    const plan = planExit({
      shares: 100n * M * SHARE,
      deckTvl: ok(BAL_TVL, "chain", 100),
      deckSupply: ok(BAL_SUPPLY, "chain", 100),
      otherTvl: ok(HULL_TVL, "chain", 100),
      idle: ok(TOTAL_ASSETS, "chain", 100),
      thetaMinBps: THETA_MIN,
      exitingBallast: true,
    });
    expect(plan.kind).toBe("ready");
  });

  it("the floor is checked before liquidity — a blocked exit is not mislabelled", () => {
    // Floor-blocked AND illiquid: the user must be told the real reason,
    // because unwinding would not help.
    const plan = planExit({
      shares: BAL_SUPPLY,
      deckTvl: ok(BAL_TVL, "chain", 100),
      deckSupply: ok(BAL_SUPPLY, "chain", 100),
      otherTvl: ok(HULL_TVL, "chain", 100),
      idle: ok(1n, "chain", 100),
      thetaMinBps: THETA_MIN,
      exitingBallast: true,
    });
    expect(plan.kind).toBe("blocked-floor");
  });

  it("mirrors Tranches: a Hull exit is never floor-blocked (it improves the ratio)", () => {
    const plan = hullExit(HULL_SUPPLY, TOTAL_ASSETS);
    expect(plan.kind).not.toBe("blocked-floor");
  });
});
