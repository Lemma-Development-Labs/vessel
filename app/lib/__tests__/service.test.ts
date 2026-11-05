import { describe, expect, it } from "vitest";
import { parseBookEvidence, parseHistory, pickShape, serviceReason } from "../book/service";

/** Review APP-7: one malformed field in stats-service JSON must not reach render. */
const H = `0x${"ab".repeat(32)}`;
const row = { blockNumber: "123", txHash: H, logIndex: 0, event: "Settled", args: { a: "1" }, finalized: true };

describe("APP-7: /v1/book is checked at fetch", () => {
  it("accepts a well-formed reply", () => {
    const r = parseBookEvidence({ status: "SIMULATED", blockNumber: "99", blockHash: H, checks: [{ id: "engine", verdict: "SIMULATED", summary: "s" }] });
    expect(r).toEqual({ ok: true, value: { status: "SIMULATED", blockNumber: "99", blockHash: H, checks: [{ id: "engine", verdict: "SIMULATED", summary: "s" }] } });
    expect(parseBookEvidence({ status: "UNAVAILABLE" })).toMatchObject({ ok: true, value: { blockNumber: null, checks: [] } });
  });

  it("refuses what used to crash render: a non-numeric block for BigInt(), checks that aren't a list", () => {
    expect(parseBookEvidence({ status: "LIVE", blockNumber: 12 })).toMatchObject({ ok: false, reason: /blockNumber/ });
    expect(parseBookEvidence({ status: "LIVE", blockNumber: "0x1f" })).toMatchObject({ ok: false });
    expect(parseBookEvidence({ status: "LIVE", checks: { id: "x" } })).toMatchObject({ ok: false, reason: /checks/ });
    expect(parseBookEvidence({ status: "LIVE", checks: [{ id: "x", verdict: "GREEN", summary: "" }] })).toMatchObject({ ok: false });
    expect(parseBookEvidence({ status: "MAINNET" })).toMatchObject({ ok: false });
    expect(parseBookEvidence(null)).toMatchObject({ ok: false });
  });
});

describe("APP-7: /v1/history is checked at fetch", () => {
  it("accepts rows and a missing list", () => {
    expect(parseHistory({ data: [row] })).toEqual({ ok: true, value: [row] });
    expect(parseHistory({})).toEqual({ ok: true, value: [] });
  });

  it("one bad row makes the page unavailable, not shorter", () => {
    expect(parseHistory({ data: [row, { ...row, blockNumber: undefined }] })).toMatchObject({ ok: false, reason: /history row/ });
    expect(parseHistory({ data: [{ ...row, args: "x" }] })).toMatchObject({ ok: false });
    expect(parseHistory({ data: "rows" })).toMatchObject({ ok: false });
  });

  it("an error reply's reason is used only if it is a string", () => {
    expect(serviceReason({ reason: "indexer behind" })).toBe("indexer behind");
    expect(serviceReason({ error: { nested: true } })).toBe("service unavailable");
    expect(serviceReason(null)).toBe("service unavailable");
  });
});

describe("APP-7: /health keeps only correctly typed fields", () => {
  const shape = { ok: "boolean", degraded: "string[]", protocol: { netDeltaPct: "number" }, errors: "record" } as const;

  it("drops mistyped fields (rendered as —) and keeps the rest", () => {
    const out = pickShape(
      { ok: true, degraded: "keeper down", protocol: { netDeltaPct: "0.4" }, errors: { rpc: "timeout", bad: 1 }, extra: { x: 1 } },
      shape,
    );
    expect(out).toEqual({ ok: true, protocol: {}, errors: { rpc: "timeout" } });
    expect(pickShape({ degraded: ["a"], protocol: null }, shape)).toEqual({ degraded: ["a"], protocol: null });
    expect(pickShape(null, shape)).toEqual({});
    expect(pickShape({ protocol: { netDeltaPct: Number.NaN } }, shape)).toEqual({ protocol: {} });
  });
});
