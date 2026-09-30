import { QueryClient } from "@tanstack/react-query";
import { parseSiweMessage } from "viem/siwe";
import { describe, expect, it } from "vitest";
import {
  AuthApiError,
  buildSiweMessage,
  eligibilityKey,
  handleAccountChange,
  sessionKey,
  sessionMismatch,
} from "../auth";
import { networkBanner } from "../banner";
import { mockEnabled } from "../mock-flag";

const A = "0x1111111111111111111111111111111111111aaa" as const;
const B = "0x2222222222222222222222222222222222222bbb" as const;

describe("wallet switch", () => {
  it("wallet_switch_clears_private_queries", () => {
    const qc = new QueryClient();
    qc.setQueryData(sessionKey, { address: A, accessExpiresAt: "2026-09-30T12:15:00Z" });
    qc.setQueryData(eligibilityKey, { address: A, backendOnboarding: { complete: true } });
    qc.setQueryData(["deck", "stats"], { hullTvl: "1" }); // public chain data

    expect(handleAccountChange(qc, A, A.toUpperCase().replace("0X", "0x"))).toBe(false); // same wallet, other case
    expect(qc.getQueryData(eligibilityKey)).toBeDefined();

    expect(handleAccountChange(qc, A, B)).toBe(true);
    expect(qc.getQueryData(eligibilityKey)).toBeUndefined();
    expect(qc.getQueryData(sessionKey)).toBeNull();
    expect(qc.getQueryData(["deck", "stats"])).toEqual({ hullTvl: "1" });
  });

  it("treats a disconnect as a switch, and no session as nothing to clear", () => {
    expect(sessionMismatch(A, undefined)).toBe(true);
    expect(sessionMismatch(null, B)).toBe(false);
    expect(sessionMismatch(undefined, undefined)).toBe(false);
  });
});

describe("SIWE message", () => {
  const nonce = { nonce: "313649bb8f3b406f89f64ef626fa896a", domain: "testnet.vessel.wtf", uri: "https://testnet.vessel.wtf", chainId: 10143 };
  const now = new Date("2026-09-30T12:00:00Z");

  it("uses the server's domain, origin and chain, with a short expiry and a no-spend statement", () => {
    const m = parseSiweMessage(buildSiweMessage({ address: A, walletChainId: 10143, nonce, now }));
    expect(m).toMatchObject({ domain: nonce.domain, uri: nonce.uri, chainId: 10143, nonce: nonce.nonce, version: "1" });
    expect(m.expirationTime!.getTime() - now.getTime()).toBe(5 * 60_000);
    expect(m.statement).toMatch(/does not authorize any spending/);
  });

  it("refuses to request a signature on the wrong chain", () => {
    expect(() => buildSiweMessage({ address: A, walletChainId: 143, nonce, now })).toThrow(AuthApiError);
  });
});

describe("environment banner", () => {
  it("testnet names the real review status", () => {
    expect(networkBanner(10143, undefined).text).toBe("TESTNET · NO REAL VALUE · NO INDEPENDENT REVIEW");
  });
  it("mainnet never says no-real-value and requires a review scope", () => {
    expect(() => networkBanner(143, undefined)).toThrow(/review scope/);
    const b = networkBanner(143, "Contracts reviewed by X, 2026-11-02");
    expect(b.text).toBe("PRIVATE MAINNET BETA · REAL FUNDS AT RISK · Contracts reviewed by X, 2026-11-02");
    expect(b.text).not.toMatch(/NO REAL VALUE/);
  });
});

describe("mock flag", () => {
  it("serves fixtures only when explicitly enabled", () => {
    expect(mockEnabled("1")).toBe(true);
    for (const v of [undefined, "", "0", "true", "yes"]) expect(mockEnabled(v)).toBe(false);
  });
});
