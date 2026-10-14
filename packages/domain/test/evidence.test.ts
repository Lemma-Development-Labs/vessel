import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  canAuthorizeNewRisk,
  hasValue,
  type Evidence,
  type Tagged,
} from "../src/evidence.js";

const evidence: Evidence = {
  schemaVersion: SCHEMA_VERSION,
  environment: "testnet",
  chainId: 10143,
  blockNumber: "65090419",
  blockHash:
    "0x1740b6995f153495cc67d1cd60929a9150164f72a107d373b60899d847c63677",
  observedAt: "2026-09-23T18:53:38Z",
  source: "rpc:https://testnet-rpc.monad.xyz",
  units: "DUSD",
  evidenceRefs: [],
};

const unavailable: Tagged<bigint> = {
  tag: "UNAVAILABLE",
  reason: "rpc timeout",
  evidence: {
    schemaVersion: SCHEMA_VERSION,
    environment: "testnet",
    chainId: 10143,
    observedAt: "2026-09-23T18:53:38Z",
    source: "rpc:https://testnet-rpc.monad.xyz",
    evidenceRefs: [],
  },
};

// Compile-time: UNAVAILABLE structurally has no value.
// @ts-expect-error accessing .value on an UNAVAILABLE reading must not typecheck
const _noValue = (u: Extract<Tagged<bigint>, { tag: "UNAVAILABLE" }>) => u.value;

describe("Tagged", () => {
  it("hasValue narrows away UNAVAILABLE", () => {
    const live: Tagged<bigint> = { tag: "LIVE", value: 1n, evidence };
    expect(hasValue(live)).toBe(true);
    expect(hasValue(unavailable)).toBe(false);
    if (hasValue(live)) expect(live.value).toBe(1n);
  });

  it("only LIVE authorizes new risk", () => {
    expect(canAuthorizeNewRisk({ tag: "LIVE", value: 1n, evidence })).toBe(true);
    for (const tag of ["STALE", "SIMULATED"] as const) {
      expect(canAuthorizeNewRisk({ tag, value: 1n, evidence }), tag).toBe(false);
    }
    for (const tag of ["PARTIAL", "MISMATCH"] as const) {
      expect(
        canAuthorizeNewRisk({ tag, value: 1n, reason: "rpc disagreement", evidence }),
        tag,
      ).toBe(false);
    }
    expect(canAuthorizeNewRisk(unavailable)).toBe(false);
  });

  it("envelope is JSON-safe (integers as strings)", () => {
    const round = JSON.parse(JSON.stringify(evidence)) as Evidence;
    expect(round).toEqual(evidence);
    expect(typeof round.blockNumber).toBe("string");
  });
});

// Compile-time: PARTIAL and MISMATCH must carry a reason.
// @ts-expect-error a MISMATCH without a reason must not typecheck
const _noReason: Tagged<bigint> = { tag: "MISMATCH", value: 1n, evidence };
