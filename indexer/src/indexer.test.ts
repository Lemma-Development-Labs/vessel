import { describe, it } from "vitest";
import { createTestIndexer, type Crank, type Deposit, type Halt } from "generated";
import { TestHelpers } from "envio";

/** Simulated events land at chain start_block (57918591), not block 0. */
const START = 57918591n;
const START_N = 57918591;

describe("Crank from EngineLite.Cranked", () => {
  it("writes Crank with gasLimit and deltaBefore/After", async (t) => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        10143: {
          simulate: [
            {
              contract: "EngineLite" as const,
              event: "Cranked" as const,
              params: {
                caller: TestHelpers.Addresses.defaultAddress,
                grossYield: 100n,
                netDeltaBps: 42n,
              },
              transaction: {
                hash: "0xabc0000000000000000000000000000000000000000000000000000000000001",
                from: TestHelpers.Addresses.defaultAddress,
                gas: 500_000n,
              },
            },
            {
              contract: "EngineLite" as const,
              event: "Cranked" as const,
              params: {
                caller: TestHelpers.Addresses.defaultAddress,
                grossYield: -10n,
                netDeltaBps: 7n,
              },
              transaction: {
                hash: "0xabc0000000000000000000000000000000000000000000000000000000000002",
                from: TestHelpers.Addresses.defaultAddress,
                gas: 400_000n,
              },
            },
          ],
        },
      },
    });

    const first = await indexer.Crank.getOrThrow(`10143_${START_N}_0`);
    const expectedFirst: Crank = {
      id: `10143_${START_N}_0`,
      block: START,
      ts: first.ts,
      actor: TestHelpers.Addresses.defaultAddress,
      decision: "crank",
      gasLimit: 500_000n,
      deltaBefore: 0n,
      deltaAfter: 42n,
      txHash: "0xabc0000000000000000000000000000000000000000000000000000000000001",
    };
    t.expect(first).toEqual(expectedFirst);

    const second = await indexer.Crank.getOrThrow(`10143_${START_N}_1`);
    t.expect(second.deltaBefore).toBe(42n);
    t.expect(second.deltaAfter).toBe(7n);
    t.expect(second.gasLimit).toBe(400_000n);
  });
});

describe("Deposit from Tranches.JoinedHull", () => {
  it("records hull tranche deposit", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            {
              contract: "Tranches" as const,
              event: "JoinedHull" as const,
              params: {
                user: TestHelpers.Addresses.defaultAddress,
                assets: 1_000n,
                shares: 999n,
              },
              transaction: {
                hash: "0xdef0000000000000000000000000000000000000000000000000000000000001",
              },
            },
          ],
        },
      },
    });

    const row = await indexer.Deposit.getOrThrow(`10143_${START_N}_0`);
    const expected: Deposit = {
      id: `10143_${START_N}_0`,
      block: START,
      ts: row.ts,
      actor: TestHelpers.Addresses.defaultAddress,
      tranche: "hull",
      assets: 1_000n,
      shares: 999n,
      txHash: "0xdef0000000000000000000000000000000000000000000000000000000000001",
    };
    t.expect(row).toEqual(expected);
  });
});

describe("Halt from Guardian.Paused", () => {
  it("opens a Halt row", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            {
              contract: "Guardian" as const,
              event: "Paused" as const,
              params: { account: TestHelpers.Addresses.defaultAddress },
              transaction: {
                hash: "0xaaa0000000000000000000000000000000000000000000000000000000000001",
              },
            },
          ],
        },
      },
    });
    const halt = await indexer.Halt.getOrThrow("open-halt");
    const expected: Halt = {
      id: "open-halt",
      block: START,
      ts: halt.ts,
      reason: `paused by ${TestHelpers.Addresses.defaultAddress}`,
      clearedAtBlock: undefined,
      txHash: "0xaaa0000000000000000000000000000000000000000000000000000000000001",
    };
    t.expect(halt).toEqual(expected);
  });
});

describe("Indexer smoke — live HyperSync (optional)", () => {
  it("processes first relevant block on 10143 when ENVIO_LIVE_SMOKE=1", async (t) => {
    if (process.env.ENVIO_LIVE_SMOKE !== "1") {
      t.expect(true).toBe(true);
      return;
    }
    const indexer = createTestIndexer();
    const result = await indexer.process({ chains: { 10143: {} } });
    t.expect(result.changes.length).toBeGreaterThan(0);
    const first = result.changes[0];
    t.expect(first?.chainId).toBe(10143);
    t.expect(first?.eventsProcessed).toBeGreaterThan(0);
  }, 60_000);
});
