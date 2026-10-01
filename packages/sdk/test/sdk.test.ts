import { decodeFunctionData, getAddress, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import {
  AUTHORIZATION,
  PrepareError,
  QUOTE_TTL_SEC,
  TESTNET_V2,
  envelope,
  parseManifest,
  prepareBallastDeposit,
  prepareBallastExit,
  prepareClaimExit,
  prepareHullSubscription,
  statusOf,
  unavailable,
  bookState,
  capacity,
  type Snapshot,
} from "../src/index.ts";

const m = parseManifest(TESTNET_V2);
const OWNER = "0x000000000000000000000000000000000000a11c";
const NOW = 1_800_000_000;
const abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function requestDeposit(uint8 tranche, uint256 seriesId, uint256 assets, address receiver, uint256 minOut, uint256 deadline) returns (uint256)",
  "function requestBallastRedeem(uint256 units, address receiver, uint256 minAssets) returns (uint256)",
  "function claim(bytes32 key) returns (uint256)",
]);

const snap = (over: Partial<Snapshot["controller"]> = {}): Snapshot => ({
  chainId: 10143,
  blockNumber: 100n,
  blockHash: "0xabc",
  blockTimestamp: 1_800_000_000n,
  asset: { symbol: "dUSD", decimals: 6 },
  controller: {
    hullNav: 800n, ballastNav: 200n, reserveNav: 20n, treasuryLiability: 0n, lastActive: 1_020n, lifetimeAdmitted: 1_000n,
    pendingReserved: 0n, stageCap: 25_000_000_000n, impaired: false, lossCarry: 0n, epoch: 1n, ...over,
  },
  custody: { pending: 0n, activeIdle: 1_020n, tokenBalance: 1_020n },
  escrow: { totalFunded: 0n, tokenBalance: 0n },
  engine: { present: false },
  ballastSupply: 200n,
});

describe("prepare — encodes only, from the manifest, for the owner", () => {
  it("Ballast deposit: exact approval to custody, then requestDeposit with receiver = owner", () => {
    const p = prepareBallastDeposit({ manifest: m, owner: OWNER, assets: 5_000_000n, minUnits: 1n, deadline: BigInt(NOW + 86_400), now: NOW });
    expect(p.calls).toHaveLength(2);
    const [approve, request] = p.calls;
    expect(approve!.to).toBe(m.contracts.DemoUSD);
    const ap = decodeFunctionData({ abi, data: approve!.data });
    expect(ap.args).toEqual([m.contracts.AssetCustody, 5_000_000n]); // exact amount, never unlimited
    expect(request!.to).toBe(m.contracts.TrancheController);
    const rq = decodeFunctionData({ abi, data: request!.data });
    expect(rq.functionName).toBe("requestDeposit");
    expect(rq.args).toEqual([1, 0n, 5_000_000n, getAddress(OWNER), 1n, BigInt(NOW + 86_400)]);
    expect(p.authorization).toBe(AUTHORIZATION);
    expect(p.expiresAt).toBe(String(NOW + QUOTE_TTL_SEC));
    expect(p.calls.every((c) => c.value === "0")).toBe(true);
  });

  it("skips approval only when the read allowance already covers the amount", () => {
    const base = { manifest: m, owner: OWNER, assets: 5n, minUnits: 1n, deadline: BigInt(NOW + 60), now: NOW };
    expect(prepareBallastDeposit({ ...base, currentAllowance: 5n }).calls).toHaveLength(1);
    expect(prepareBallastDeposit({ ...base, currentAllowance: 4n }).calls).toHaveLength(2);
    // An expiring deadline bounds the preparation's validity.
    expect(prepareBallastDeposit(base).expiresAt).toBe(String(NOW + 60));
  });

  it("Hull subscription carries the series and the minimum rate", () => {
    const p = prepareHullSubscription({ manifest: m, owner: OWNER, seriesId: 1n, minRateBps: 800n, assets: 9n, deadline: BigInt(NOW + 99), now: NOW });
    const rq = decodeFunctionData({ abi, data: p.calls.at(-1)!.data });
    expect(rq.args?.slice(0, 2)).toEqual([0, 1n]);
    expect(rq.args?.[4]).toBe(800n);
  });

  it("refuses bad input instead of encoding it", () => {
    const base = { manifest: m, assets: 5n, minUnits: 1n, deadline: BigInt(NOW + 60), now: NOW };
    expect(() => prepareBallastDeposit({ ...base, owner: "0x0000000000000000000000000000000000000000" })).toThrow(PrepareError);
    expect(() => prepareBallastDeposit({ ...base, owner: "not-an-address" })).toThrow(PrepareError);
    expect(() => prepareBallastDeposit({ ...base, owner: OWNER, assets: 0n })).toThrow(PrepareError);
    expect(() => prepareBallastDeposit({ ...base, owner: OWNER, deadline: BigInt(NOW) })).toThrow(PrepareError);
    expect(() => prepareHullSubscription({ ...base, owner: OWNER, seriesId: 0n, minRateBps: 800n })).toThrow(PrepareError);
  });

  it("exit pays the owner; claims target the escrow by exit key", () => {
    const ex = prepareBallastExit({ manifest: m, owner: OWNER, units: 10n, minAssets: 9n, now: NOW });
    expect(decodeFunctionData({ abi, data: ex.calls[0]!.data }).args).toEqual([10n, getAddress(OWNER), 9n]);
    const cl = prepareClaimExit({ manifest: m, id: 3n, now: NOW });
    expect(cl.calls[0]!.to).toBe(m.contracts.ClaimEscrow);
    // Value of TrancheController.exitKey(3) read from the deployed testnet controller.
    expect(decodeFunctionData({ abi, data: cl.calls[0]!.data }).args?.[0]).toBe(
      "0xf821155de02bd175962676dc844b90bd0dab68a5d46427280b95f267c3c60a73",
    );
  });
});

describe("evidence envelope", () => {
  it("carries block, units and status with decimal-string money", () => {
    const s = snap();
    const e = envelope(m, s, statusOf(s), bookState(s), "test");
    expect(e).toMatchObject({ schemaVersion: 1, chainId: 10143, blockNumber: "100", units: "dUSD:6", status: "LIVE" });
    expect(e.data?.hullNav).toBe("800");
  });

  it("a failed independent check makes the status MISMATCH", () => {
    expect(statusOf(snap({ lastActive: 999n }))).toBe("MISMATCH");
  });

  it("unavailable carries a reason and no data", () => {
    const u = unavailable(m, "rpc down", "test");
    expect(u.status).toBe("UNAVAILABLE");
    expect(u.data).toBeUndefined();
    expect(u.reason).toBe("rpc down");
  });

  it("capacity never goes negative", () => {
    expect(capacity(snap({ stageCap: 500n, lifetimeAdmitted: 1_000n })).remaining).toBe("0");
  });
});
