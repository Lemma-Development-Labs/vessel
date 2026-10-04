import { describe, expect, it } from "vitest";
import { evaluate, overall, type Snapshot } from "../src/checks.ts";

const healthy = (): Snapshot => ({
  chainId: 10143,
  blockNumber: 100n,
  blockHash: "0xabc",
  blockTimestamp: 1_790_000_000n,
  asset: { symbol: "dUSD", decimals: 6 },
  controller: {
    hullNav: 80_000_000n, ballastNav: 900_000_000n, reserveNav: 20_000_000n, treasuryLiability: 0n,
    lastActive: 1_000_000_000n, lifetimeAdmitted: 1_000_000_000n, pendingReserved: 0n,
    stageCap: 25_000_000_000n, impaired: false, lossCarry: 0n, epoch: 3n,
  },
  custody: { pending: 0n, activeIdle: 200_000_000n, tokenBalance: 200_000_000n },
  escrow: { totalFunded: 0n, tokenBalance: 0n },
  engine: { present: true, simulated: true, value: 800_000_000n, observedAt: 1_790_000_000n, book: 800_000_000n, pot: 200_000_000n, fundingRateBps: 1200n },
  ballastSupply: 900_000_000_000_000_000_000n,
});

const verdictOf = (s: Snapshot, id: string) => evaluate(s).find((c) => c.id === id)?.verdict;

describe("verifier checks", () => {
  it("passes a consistent book and labels the simulated engine", () => {
    const s = healthy();
    expect(overall(evaluate(s))).toBe("PASS");
    expect(verdictOf(s, "engine")).toBe("SIMULATED");
  });

  it("corrupted_projection_yields_MISMATCH: recorded A ≠ H + B + R", () => {
    const s = healthy();
    s.controller.ballastNav += 1n;
    expect(verdictOf(s, "book.identity")).toBe("MISMATCH");
    expect(overall(evaluate(s))).toBe("MISMATCH");
  });

  it("custody below its tracked compartments is a MISMATCH; a surplus is quarantined", () => {
    const short = healthy();
    short.custody.tokenBalance -= 1n;
    expect(verdictOf(short, "custody.backing")).toBe("MISMATCH");
    const donated = healthy();
    donated.custody.tokenBalance += 5n;
    const c = evaluate(donated).find((x) => x.id === "custody.backing")!;
    expect(c.verdict).toBe("PASS");
    expect(c.values.quarantined).toBe("5");
  });

  it("escrow owing more than it holds is a MISMATCH", () => {
    const s = healthy();
    s.escrow.totalFunded = 10n;
    expect(verdictOf(s, "escrow.backing")).toBe("MISMATCH");
  });

  it("caps beyond the stage cap or the V1 ceiling are a MISMATCH", () => {
    const over = healthy();
    over.controller.pendingReserved = over.controller.stageCap;
    expect(verdictOf(over, "caps.lifetime")).toBe("MISMATCH");
    const ceiling = healthy();
    ceiling.controller.stageCap = 25_000_000_001n;
    expect(verdictOf(ceiling, "caps.lifetime")).toBe("MISMATCH");
  });

  it("reports unsettled income without calling it a mismatch", () => {
    const s = healthy();
    if (s.engine.present) s.engine.value += 7n;
    const c = evaluate(s).find((x) => x.id === "book.unsettled")!;
    expect(c.verdict).toBe("INFO");
    expect(c.values.unsettledG).toBe("7");
    expect(overall(evaluate(s))).toBe("PASS");
  });

  it("units without admitted capital are a MISMATCH", () => {
    const s = healthy();
    s.controller.lifetimeAdmitted = 0n;
    s.controller.lastActive = s.controller.hullNav + s.controller.ballastNav + s.controller.reserveNav;
    expect(verdictOf(s, "units.backed")).toBe("MISMATCH");
  });
});
