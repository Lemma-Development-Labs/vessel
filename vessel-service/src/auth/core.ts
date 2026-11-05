import { createHash, randomBytes } from "node:crypto";
import { getAddress, isAddress, recoverMessageAddress, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";
import type { Sql } from "./sql.ts";

/**
 * SIWE (EIP-4361) sessions, invitations and consent — docs/AUTH.md.
 *
 * Signing in proves control of a wallet for private beta metadata. It never
 * authorizes spending, and nothing in this module can move funds or change
 * on-chain admission (spec §14).
 */

export const NONCE_TTL_MS = 5 * 60_000;
export const ACCESS_TTL_MS = 15 * 60_000;
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60_000;
/** Allowed clock skew for a message's issuedAt in the future. */
export const ISSUED_AT_SKEW_MS = 60_000;
/** A signed message may live at most this long (issuedAt → expirationTime). */
export const MAX_MESSAGE_LIFETIME_MS = 10 * 60_000;

export type AuthErrorCode =
  | "SIWE_BAD_MESSAGE"
  | "SIWE_WRONG_DOMAIN"
  | "SIWE_WRONG_URI"
  | "SIWE_WRONG_CHAIN"
  | "SIWE_EXPIRED"
  | "SIWE_NOT_YET_VALID"
  | "SIWE_BAD_SIGNATURE"
  | "NONCE_UNKNOWN"
  | "NONCE_EXPIRED"
  | "NONCE_REUSED"
  | "SESSION_REQUIRED"
  | "REFRESH_INVALID"
  | "REFRESH_REUSED"
  | "INVITE_INVALID"
  | "WALLET_ALREADY_BOUND"
  | "PARTICIPANT_REQUIRED"
  | "CONSENT_VERSION_MISMATCH";

export class AuthError extends Error {
  override name = "AuthError";
  constructor(
    readonly code: AuthErrorCode,
    readonly status: 400 | 401 | 403 | 409,
    message: string = code,
  ) {
    super(message);
  }
}

export interface AuthSettings {
  /** RFC 3986 authority the app is served from, e.g. "testnet.vessel.wtf". */
  domain: string;
  /** Exact origin, e.g. "https://testnet.vessel.wtf". SIWE uri and request Origin must match it. */
  origin: string;
  chainId: number;
  now: () => Date;
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");
const token = (bytes = 32): string => randomBytes(bytes).toString("base64url");

async function audit(sql: Sql, actor: string | null, action: string, detail: object = {}): Promise<void> {
  await sql.query("INSERT INTO audit_events (actor, action, detail) VALUES ($1, $2, $3)", [
    actor,
    action,
    JSON.stringify(detail),
  ]);
}

// ---------------------------------------------------------------------------
// Nonces
// ---------------------------------------------------------------------------

export async function issueNonce(sql: Sql, s: AuthSettings): Promise<{ nonce: string; expiresAt: Date }> {
  // 128 bits, alphanumeric as EIP-4361 requires.
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(s.now().getTime() + NONCE_TTL_MS);
  await sql.query("INSERT INTO auth_nonces (nonce, created_at, expires_at) VALUES ($1, $2, $3)", [
    nonce,
    s.now(),
    expiresAt,
  ]);
  return { nonce, expiresAt };
}

/** Atomically consume a nonce; distinguishes unknown / expired / reused. */
async function consumeNonce(sql: Sql, nonce: string, now: Date): Promise<void> {
  const hit = await sql.query(
    `UPDATE auth_nonces SET consumed_at = $2
      WHERE nonce = $1 AND consumed_at IS NULL AND expires_at > $2
      RETURNING nonce`,
    [nonce, now],
  );
  if (hit.length === 1) return;
  const [row] = await sql.query<{ consumed_at: Date | null; expires_at: Date }>(
    "SELECT consumed_at, expires_at FROM auth_nonces WHERE nonce = $1",
    [nonce],
  );
  if (!row) throw new AuthError("NONCE_UNKNOWN", 401);
  if (row.consumed_at) throw new AuthError("NONCE_REUSED", 401);
  throw new AuthError("NONCE_EXPIRED", 401);
}

// ---------------------------------------------------------------------------
// SIWE verification → session family
// ---------------------------------------------------------------------------

export interface SessionTokens {
  address: `0x${string}`;
  familyId: string;
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
}

async function insertSession(
  sql: Sql,
  address: string,
  familyId: string | null,
  familyExpiresAt: Date,
  now: Date,
): Promise<SessionTokens> {
  const accessToken = token();
  const refreshToken = token();
  const accessExpiresAt = new Date(Math.min(now.getTime() + ACCESS_TTL_MS, familyExpiresAt.getTime()));
  const refreshExpiresAt = familyExpiresAt;
  const [row] = await sql.query<{ family_id: string }>(
    `INSERT INTO auth_sessions
       (family_id, address, access_sha256, access_expires_at, refresh_sha256,
        refresh_expires_at, family_expires_at, created_at)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8)
     RETURNING family_id`,
    [familyId, address, sha256Hex(accessToken), accessExpiresAt, sha256Hex(refreshToken), refreshExpiresAt, familyExpiresAt, now],
  );
  return {
    address: getAddress(address),
    familyId: row!.family_id,
    accessToken,
    accessExpiresAt,
    refreshToken,
    refreshExpiresAt,
  };
}

/**
 * Validate an EIP-4361 message and its signature, consume its nonce, and
 * open a session family. EOA signatures only: ERC-1271/6492 contract-wallet
 * verification is deferred until tested (AUTH.md), so a contract wallet fails
 * here with SIWE_BAD_SIGNATURE rather than being half-supported.
 */
export async function verifySiwe(
  sql: Sql,
  s: AuthSettings,
  message: string,
  signature: Hex,
): Promise<SessionTokens> {
  const now = s.now();
  let m: ReturnType<typeof parseSiweMessage>;
  try {
    m = parseSiweMessage(message);
  } catch {
    throw new AuthError("SIWE_BAD_MESSAGE", 400);
  }
  if (!m.address || !m.domain || !m.uri || !m.nonce || !m.issuedAt || !m.expirationTime || m.version !== "1" || m.chainId === undefined) {
    throw new AuthError("SIWE_BAD_MESSAGE", 400, "message must carry address, domain, uri, version 1, chainId, nonce, issuedAt and expirationTime");
  }
  if (m.domain !== s.domain) throw new AuthError("SIWE_WRONG_DOMAIN", 401);
  let uriOrigin: string;
  try {
    uriOrigin = new URL(m.uri).origin;
  } catch {
    throw new AuthError("SIWE_BAD_MESSAGE", 400, "uri is not a URL");
  }
  if (uriOrigin !== s.origin) throw new AuthError("SIWE_WRONG_URI", 401);
  if (m.chainId !== s.chainId) throw new AuthError("SIWE_WRONG_CHAIN", 401);

  const issued = m.issuedAt.getTime();
  const expires = m.expirationTime.getTime();
  if (issued > now.getTime() + ISSUED_AT_SKEW_MS) throw new AuthError("SIWE_NOT_YET_VALID", 401);
  if (m.notBefore && m.notBefore.getTime() > now.getTime()) throw new AuthError("SIWE_NOT_YET_VALID", 401);
  if (expires <= now.getTime()) throw new AuthError("SIWE_EXPIRED", 401);
  if (expires - issued > MAX_MESSAGE_LIFETIME_MS) {
    throw new AuthError("SIWE_BAD_MESSAGE", 400, "message lifetime exceeds 10 minutes");
  }

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message, signature });
  } catch {
    throw new AuthError("SIWE_BAD_SIGNATURE", 401);
  }
  if (recovered.toLowerCase() !== m.address.toLowerCase()) {
    await audit(sql, m.address.toLowerCase(), "siwe.bad_signature");
    throw new AuthError("SIWE_BAD_SIGNATURE", 401);
  }

  await consumeNonce(sql, m.nonce, now);
  const address = m.address.toLowerCase();
  const session = await insertSession(sql, address, null, new Date(now.getTime() + REFRESH_TTL_MS), now);
  await audit(sql, address, "siwe.login", { familyId: session.familyId });
  return session;
}

// ---------------------------------------------------------------------------
// Session lookup, refresh rotation, logout
// ---------------------------------------------------------------------------

export async function sessionFromAccess(
  sql: Sql,
  s: AuthSettings,
  accessToken: string | undefined,
): Promise<{ address: `0x${string}`; familyId: string; accessExpiresAt: Date } | null> {
  if (!accessToken) return null;
  const [row] = await sql.query<{ address: string; family_id: string; access_expires_at: Date }>(
    `SELECT address, family_id, access_expires_at FROM auth_sessions
      WHERE access_sha256 = $1 AND revoked_at IS NULL AND rotated_at IS NULL AND access_expires_at > $2`,
    [sha256Hex(accessToken), s.now()],
  );
  if (!row) return null;
  return { address: getAddress(row.address), familyId: row.family_id, accessExpiresAt: row.access_expires_at };
}

async function revokeFamily(sql: Sql, familyId: string, now: Date): Promise<void> {
  await sql.query("UPDATE auth_sessions SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL", [familyId, now]);
}

/**
 * Rotate a refresh token. Presenting a token that was already rotated is
 * treated as theft: the whole family (every descendant session) is revoked.
 */
export async function refreshSession(sql: Sql, s: AuthSettings, refreshToken: string | undefined): Promise<SessionTokens> {
  if (!refreshToken) throw new AuthError("REFRESH_INVALID", 401);
  const now = s.now();
  const hash = sha256Hex(refreshToken);
  const [live] = await sql.query<{ address: string; family_id: string; family_expires_at: Date }>(
    `UPDATE auth_sessions SET rotated_at = $2
      WHERE refresh_sha256 = $1 AND rotated_at IS NULL AND revoked_at IS NULL AND refresh_expires_at > $2
      RETURNING address, family_id, family_expires_at`,
    [hash, now],
  );
  if (live) {
    return insertSession(sql, live.address, live.family_id, live.family_expires_at, now);
  }
  const [seen] = await sql.query<{ family_id: string; address: string; rotated_at: Date | null }>(
    "SELECT family_id, address, rotated_at FROM auth_sessions WHERE refresh_sha256 = $1",
    [hash],
  );
  if (seen?.rotated_at) {
    await revokeFamily(sql, seen.family_id, now);
    await audit(sql, seen.address, "session.refresh_reuse_revoked_family", { familyId: seen.family_id });
    throw new AuthError("REFRESH_REUSED", 401);
  }
  throw new AuthError("REFRESH_INVALID", 401);
}

export async function logout(sql: Sql, s: AuthSettings, refreshToken: string | undefined, accessToken: string | undefined): Promise<void> {
  const now = s.now();
  for (const [col, t] of [["refresh_sha256", refreshToken], ["access_sha256", accessToken]] as const) {
    if (!t) continue;
    const [row] = await sql.query<{ family_id: string; address: string }>(
      `SELECT family_id, address FROM auth_sessions WHERE ${col} = $1`,
      [sha256Hex(t)],
    );
    if (row) {
      await revokeFamily(sql, row.family_id, now);
      await audit(sql, row.address, "session.logout", { familyId: row.family_id });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Invitations and participants
// ---------------------------------------------------------------------------

/** Create an invitation. The plaintext code is returned once and never stored. */
export async function createInvitation(sql: Sql, s: AuthSettings, ttlMs: number): Promise<{ code: string; expiresAt: Date }> {
  const code = token(18);
  const expiresAt = new Date(s.now().getTime() + ttlMs);
  await sql.query("INSERT INTO invitations (code_sha256, expires_at, created_at) VALUES ($1, $2, $3)", [
    sha256Hex(code),
    expiresAt,
    s.now(),
  ]);
  await audit(sql, null, "invite.created", { expiresAt: expiresAt.toISOString() });
  return { code, expiresAt };
}

/**
 * Redeem an invitation for the signed-in wallet. The caller must already have
 * proved wallet control (a SIWE session); the code binds to that wallet only
 * then, atomically with creating the participant.
 */
export async function redeemInvitation(sql: Sql, s: AuthSettings, address: string, code: string): Promise<{ participantId: string }> {
  const addr = address.toLowerCase();
  if (!isAddress(addr)) throw new AuthError("SESSION_REQUIRED", 401);
  const now = s.now();
  return sql.transaction(async (q) => {
    const [bound] = await q.query("SELECT 1 FROM wallets WHERE address = $1", [addr]);
    if (bound) throw new AuthError("WALLET_ALREADY_BOUND", 409);
    const [p] = await q.query<{ id: string }>("INSERT INTO participants (created_at) VALUES ($1) RETURNING id", [now]);
    const claimed = await q.query(
      `UPDATE invitations SET used_at = $2, participant_id = $3
        WHERE code_sha256 = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > $2
        RETURNING id`,
      [sha256Hex(code), now, p!.id],
    );
    if (claimed.length !== 1) throw new AuthError("INVITE_INVALID", 403);
    await q.query("INSERT INTO wallets (address, participant_id, bound_at) VALUES ($1, $2, $3)", [addr, p!.id, now]);
    await q.query("INSERT INTO audit_events (actor, action, detail) VALUES ($1, 'invite.redeemed', $2)", [
      addr,
      JSON.stringify({ participantId: p!.id }),
    ]);
    return { participantId: p!.id };
  });
}

// ---------------------------------------------------------------------------
// Consent and eligibility
// ---------------------------------------------------------------------------

export async function publishConsentVersion(sql: Sql, version: string, text: string): Promise<void> {
  await sql.query(
    `INSERT INTO consent_versions (version, text_sha256) VALUES ($1, $2)
     ON CONFLICT (version) DO NOTHING`,
    [version, sha256Hex(text)],
  );
  const [row] = await sql.query<{ text_sha256: string }>("SELECT text_sha256 FROM consent_versions WHERE version = $1", [version]);
  if (row?.text_sha256 !== sha256Hex(text)) {
    throw new Error(`consent version ${version} already published with different text`);
  }
}

export async function acceptConsent(
  sql: Sql,
  s: AuthSettings,
  address: string,
  version: string,
  textSha256: string,
): Promise<void> {
  const [w] = await sql.query<{ participant_id: string }>("SELECT participant_id FROM wallets WHERE address = $1", [address.toLowerCase()]);
  if (!w) throw new AuthError("PARTICIPANT_REQUIRED", 403);
  const [v] = await sql.query<{ text_sha256: string }>("SELECT text_sha256 FROM consent_versions WHERE version = $1", [version]);
  if (!v || v.text_sha256 !== textSha256) throw new AuthError("CONSENT_VERSION_MISMATCH", 409);
  await sql.query(
    `INSERT INTO consents (participant_id, version, accepted_at) VALUES ($1, $2, $3)
     ON CONFLICT (participant_id, version) DO NOTHING`,
    [w.participant_id, version, s.now()],
  );
  await audit(sql, address.toLowerCase(), "consent.accepted", { version });
}

/**
 * Backend onboarding status. On-chain admission is a separate question with
 * its own authority (BetaAdmission, Session 2); until that contract exists it
 * is reported UNAVAILABLE — never inferred from the backend record.
 */
export async function eligibility(sql: Sql, address: string, currentConsentVersion: string) {
  const addr = address.toLowerCase();
  const [w] = await sql.query<{ participant_id: string; bound_at: Date }>(
    "SELECT participant_id, bound_at FROM wallets WHERE address = $1",
    [addr],
  );
  const consents = w
    ? await sql.query<{ version: string; accepted_at: Date }>(
        "SELECT version, accepted_at FROM consents WHERE participant_id = $1",
        [w.participant_id],
      )
    : [];
  const current = consents.find((c) => c.version === currentConsentVersion);
  return {
    address: getAddress(addr),
    backendOnboarding: {
      invited: Boolean(w),
      participantId: w?.participant_id ?? null,
      boundAt: w?.bound_at.toISOString() ?? null,
      consent: {
        currentVersion: currentConsentVersion,
        accepted: Boolean(current),
        acceptedAt: current?.accepted_at.toISOString() ?? null,
      },
      complete: Boolean(w && current),
    },
    onchainAdmission: {
      tag: "UNAVAILABLE" as const,
      reason: "BetaAdmission is not deployed (Session 2); backend onboarding does not imply on-chain admission",
    },
  };
}
