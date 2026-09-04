/**
 * Ed25519 request signing for Perpl API keys.
 * Canonical forms from https://github.com/PerplFoundation/api-docs/blob/main/authentication.md
 * (fetched 2026-09-04).
 */
import { createHash, randomBytes } from "node:crypto";
import * as ed from "@noble/ed25519";

const usedNonces = new Set<string>();

/** Max allowed |local - claimed| clock skew for outbound timestamps (ms). */
export const CLOCK_SKEW_MAX_MS = 5_000;

export function sha256Hex(body: string | Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

/** REST canonical string — six fields joined by `\n`. */
export function restCanonical(args: {
  chainId: number;
  method: string;
  target: string;
  timestampMs: string;
  nonce: string;
  body: string | Uint8Array;
}): string {
  return [
    String(args.chainId),
    args.method.toUpperCase(),
    args.target,
    args.timestampMs,
    args.nonce,
    sha256Hex(args.body),
  ].join("\n");
}

/** Trading-WS sign-in canonical — four fields joined by `\n`. */
export function wsSignInCanonical(args: {
  chainId: number;
  timestampMs: string;
  nonce: string;
}): string {
  return [String(args.chainId), "trading-ws-signin", args.timestampMs, args.nonce].join("\n");
}

export function freshNonce(): string {
  for (let i = 0; i < 8; i++) {
    const n = randomBytes(16).toString("base64url");
    if (!usedNonces.has(n)) {
      usedNonces.add(n);
      // Bound memory — drop oldest when large.
      if (usedNonces.size > 10_000) {
        const first = usedNonces.values().next().value;
        if (first) usedNonces.delete(first);
      }
      return n;
    }
  }
  throw new Error("nonce collision");
}

/** Test helper — clear nonce ledger between cases. */
export function resetNonceLedger(): void {
  usedNonces.clear();
}

export function assertNonceUnused(nonce: string): void {
  if (usedNonces.has(nonce)) throw new Error("nonce reused");
  usedNonces.add(nonce);
}

export function parseSecretHex(secret: string): Uint8Array {
  const hex = secret.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("PERPL_API_KEY_SECRET must be 32-byte hex");
  }
  return Buffer.from(hex, "hex");
}

export function guardClockSkew(timestampMs: string, nowMs = Date.now()): void {
  const t = Number(timestampMs);
  if (!Number.isFinite(t)) throw new Error("bad timestamp");
  if (Math.abs(nowMs - t) > CLOCK_SKEW_MAX_MS) {
    throw new Error(`clock skew ${Math.abs(nowMs - t)}ms exceeds ${CLOCK_SKEW_MAX_MS}ms`);
  }
}

export async function signCanonical(canonical: string, privateKey: Uint8Array): Promise<string> {
  const sig = await ed.signAsync(Buffer.from(canonical, "utf8"), privateKey);
  return Buffer.from(sig).toString("base64url");
}

export type AuthConfig = {
  chainId: number;
  apiKey: string;
  privateKey: Uint8Array;
  apiUrl: string;
};

export async function signedHeaders(
  cfg: AuthConfig,
  method: string,
  target: string,
  body = "",
  nowMs = Date.now(),
): Promise<Record<string, string>> {
  const timestamp = String(nowMs);
  guardClockSkew(timestamp, nowMs);
  const nonce = freshNonce();
  const canonical = restCanonical({
    chainId: cfg.chainId,
    method,
    target,
    timestampMs: timestamp,
    nonce,
    body,
  });
  const signature = await signCanonical(canonical, cfg.privateKey);
  return {
    "X-API-Key": cfg.apiKey,
    "X-API-Timestamp": timestamp,
    "X-API-Nonce": nonce,
    "X-API-Signature": signature,
    ...(body ? { "Content-Type": "application/json" } : {}),
  };
}

export async function signedFetch(
  cfg: AuthConfig,
  method: string,
  target: string,
  body = "",
): Promise<Response> {
  const headers = await signedHeaders(cfg, method, target, body);
  return fetch(`${cfg.apiUrl}${target}`, {
    method,
    headers,
    ...(body ? { body } : {}),
  });
}

export async function tradingWsSignInFrame(
  cfg: AuthConfig,
  nowMs = Date.now(),
): Promise<Record<string, unknown>> {
  const timestamp = String(nowMs);
  guardClockSkew(timestamp, nowMs);
  const nonce = freshNonce();
  const canonical = wsSignInCanonical({
    chainId: cfg.chainId,
    timestampMs: timestamp,
    nonce,
  });
  const signature = await signCanonical(canonical, cfg.privateKey);
  return {
    mt: 29,
    chain_id: cfg.chainId,
    api_key: cfg.apiKey,
    timestamp,
    nonce,
    signature,
  };
}
