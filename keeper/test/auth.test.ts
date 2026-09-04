import { createHash } from "node:crypto";
import { describe, expect, it, beforeEach } from "vitest";
import * as ed from "@noble/ed25519";
import {
  restCanonical,
  wsSignInCanonical,
  freshNonce,
  resetNonceLedger,
  assertNonceUnused,
  signCanonical,
  sha256Hex,
} from "../src/auth.ts";

describe("auth canonical strings", () => {
  beforeEach(() => resetNonceLedger());

  it("REST canonical matches doc byte-for-byte", () => {
    const body = "";
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const c = restCanonical({
      chainId: 10143,
      method: "GET",
      target: "/v1/trading/fills?count=100",
      timestampMs: "1700000000000",
      nonce: "abcXYZ-_0123456789",
      body,
    });
    expect(c).toBe(
      ["10143", "GET", "/v1/trading/fills?count=100", "1700000000000", "abcXYZ-_0123456789", bodyHash].join(
        "\n",
      ),
    );
    expect(sha256Hex(body)).toBe(bodyHash);
  });

  it("WS sign-in canonical matches doc", () => {
    const c = wsSignInCanonical({
      chainId: 10143,
      timestampMs: "1700000000000",
      nonce: "n1",
    });
    expect(c).toBe(["10143", "trading-ws-signin", "1700000000000", "n1"].join("\n"));
  });

  it("nonce never reused", () => {
    const a = freshNonce();
    const b = freshNonce();
    expect(a).not.toBe(b);
    expect(() => assertNonceUnused(a)).toThrow(/reused/);
  });

  it("ed25519 signature verifies", async () => {
    const sk = ed.utils.randomPrivateKey();
    const canonical = restCanonical({
      chainId: 10143,
      method: "GET",
      target: "/v1/trading/fills?count=1",
      timestampMs: String(Date.now()),
      nonce: freshNonce(),
      body: "",
    });
    const sigB64 = await signCanonical(canonical, sk);
    const sig = Buffer.from(sigB64, "base64url");
    const pk = await ed.getPublicKeyAsync(sk);
    expect(await ed.verifyAsync(sig, Buffer.from(canonical), pk)).toBe(true);
  });
});
