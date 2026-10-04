import { PGlite } from "@electric-sql/pglite";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACCESS_TTL_MS,
  NONCE_TTL_MS,
  createInvitation,
  publishConsentVersion,
  sha256Hex,
  type AuthSettings,
} from "../src/auth/core.ts";
import { TESTNET_DISCLOSURE } from "../src/auth/disclosures.ts";
import { migrate } from "../src/auth/migrations.ts";
import { ACCESS_COOKIE, CSRF_HEADER, REFRESH_COOKIE, registerAuthRoutes } from "../src/auth/routes.ts";
import { pgliteSql, type Sql } from "../src/auth/sql.ts";

const ORIGIN = "https://app.vessel.test";
const DOMAIN = "app.vessel.test";
const CHAIN = 10143;

let clock: Date;
let sql: Sql;
let app: FastifyInstance;
let settings: AuthSettings;

beforeEach(async () => {
  clock = new Date("2026-09-30T12:00:00.000Z");
  sql = pgliteSql(new PGlite());
  await migrate(sql);
  await publishConsentVersion(sql, TESTNET_DISCLOSURE.version, TESTNET_DISCLOSURE.text);
  settings = { domain: DOMAIN, origin: ORIGIN, chainId: CHAIN, now: () => clock };
  app = Fastify();
  await registerAuthRoutes(app, { sql, settings, disclosure: TESTNET_DISCLOSURE });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await sql.close();
});

const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

type Jar = Record<string, string>;
const cookieHeader = (jar: Jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
function absorb(jar: Jar, res: LightMyRequestResponse): Jar {
  for (const c of res.cookies as Array<{ name: string; value: string }>) {
    if (c.value === "") delete jar[c.name];
    else jar[c.name] = c.value;
  }
  return jar;
}

const post = (url: string, body?: unknown, jar: Jar = {}, headers: Record<string, string> = {}) =>
  app.inject({
    method: "POST",
    url,
    headers: { origin: ORIGIN, [CSRF_HEADER]: "1", cookie: cookieHeader(jar), ...headers },
    ...(body === undefined ? {} : { payload: body as object }),
  });
const get = (url: string, jar: Jar = {}) =>
  app.inject({ method: "GET", url, headers: { cookie: cookieHeader(jar) } });

async function signedLogin(
  account: PrivateKeyAccount,
  over: Partial<{ domain: string; uri: string; chainId: number }> = {},
) {
  const nonceRes = await post("/auth/nonce");
  expect(nonceRes.statusCode).toBe(200);
  const { nonce } = nonceRes.json() as { nonce: string };
  const message = createSiweMessage({
    address: account.address,
    chainId: over.chainId ?? CHAIN,
    domain: over.domain ?? DOMAIN,
    uri: over.uri ?? `${ORIGIN}/onboarding`,
    version: "1",
    nonce,
    issuedAt: clock,
    expirationTime: new Date(clock.getTime() + 10 * 60_000),
    statement: "Sign in to Vessel. This does not authorize any spending.",
  });
  const signature = await account.signMessage({ message });
  return { message, signature };
}

async function login(account: PrivateKeyAccount): Promise<Jar> {
  const { message, signature } = await signedLogin(account);
  const res = await post("/auth/verify", { message, signature });
  expect(res.statusCode, res.body).toBe(200);
  return absorb({}, res);
}

const newAccount = () => privateKeyToAccount(generatePrivateKey());

describe("SIWE", () => {
  it("logs in, sets HttpOnly Secure SameSite cookies, and reports the session", async () => {
    const acct = newAccount();
    const { message, signature } = await signedLogin(acct);
    const res = await post("/auth/verify", { message, signature });
    expect(res.statusCode).toBe(200);
    const cookies = res.cookies as Array<{ name: string; httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string }>;
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
      const c = cookies.find((x) => x.name === name);
      expect(c, name).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax" });
    }
    expect(cookies.find((c) => c.name === REFRESH_COOKIE)?.path).toBe("/api/auth");
    const session = await get("/auth/session", absorb({}, res));
    expect(session.json()).toMatchObject({ address: acct.address });
  });

  it("siwe_rejects_cross_domain_replay", async () => {
    const acct = newAccount();
    // Signed for a phishing domain, replayed at ours.
    const foreign = await signedLogin(acct, { domain: "vessel-airdrop.example" });
    expect((await post("/auth/verify", foreign)).json()).toEqual({ error: "SIWE_WRONG_DOMAIN" });
    // Right domain string, but the URI points at another origin.
    const otherUri = await signedLogin(acct, { uri: "https://evil.example/onboarding" });
    expect((await post("/auth/verify", otherUri)).json()).toEqual({ error: "SIWE_WRONG_URI" });
  });

  it("siwe_rejects_wrong_chain", async () => {
    const signed = await signedLogin(newAccount(), { chainId: 143 });
    const res = await post("/auth/verify", signed);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "SIWE_WRONG_CHAIN" });
  });

  it("siwe_rejects_reused_nonce", async () => {
    const signed = await signedLogin(newAccount());
    expect((await post("/auth/verify", signed)).statusCode).toBe(200);
    const replay = await post("/auth/verify", signed);
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({ error: "NONCE_REUSED" });
  });

  it("siwe_rejects_expired_nonce", async () => {
    const signed = await signedLogin(newAccount());
    advance(NONCE_TTL_MS + 1_000); // message itself still inside its 10-minute lifetime
    const res = await post("/auth/verify", signed);
    expect(res.json()).toEqual({ error: "NONCE_EXPIRED" });
  });

  it("rejects a signature from another wallet, an expired message, and an unknown nonce", async () => {
    const signed = await signedLogin(newAccount());
    const forged = await newAccount().signMessage({ message: signed.message });
    expect((await post("/auth/verify", { message: signed.message, signature: forged })).json()).toEqual({
      error: "SIWE_BAD_SIGNATURE",
    });
    // A well-formed message whose nonce this server never issued.
    const acct = newAccount();
    const unknownMsg = createSiweMessage({
      address: acct.address, chainId: CHAIN, domain: DOMAIN, uri: ORIGIN, version: "1",
      nonce: "abcdef0123456789abcdef0123456789", issuedAt: clock,
      expirationTime: new Date(clock.getTime() + 5 * 60_000),
    });
    const unknownSig = await acct.signMessage({ message: unknownMsg });
    expect((await post("/auth/verify", { message: unknownMsg, signature: unknownSig })).json()).toEqual({
      error: "NONCE_UNKNOWN",
    });
    advance(11 * 60_000);
    expect((await post("/auth/verify", signed)).json()).toEqual({ error: "SIWE_EXPIRED" });
  });

  it("answers malformed requests with 4xx, never a 500", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/auth/nonce",
      headers: { origin: ORIGIN, [CSRF_HEADER]: "1", "content-type": "application/json" },
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toEqual({ error: "BAD_REQUEST" });
    const garbage = await post("/auth/verify", "{not json", {}, { "content-type": "application/json" });
    expect(garbage.statusCode).toBe(400);
  });

  it("refuses state-changing auth calls without the app origin and CSRF header", async () => {
    expect((await post("/auth/nonce", undefined, {}, { origin: "https://evil.example" })).statusCode).toBe(403);
    const noHeader = await app.inject({ method: "POST", url: "/auth/nonce", headers: { origin: ORIGIN } });
    expect(noHeader.statusCode).toBe(403);
    expect(noHeader.json()).toEqual({ error: "CSRF" });
  });
});

describe("sessions", () => {
  it("access tokens expire after 15 minutes; refresh rotates", async () => {
    const jar = await login(newAccount());
    advance(ACCESS_TTL_MS + 1_000);
    expect((await get("/auth/session", jar)).statusCode).toBe(401);
    const r = await post("/auth/refresh", undefined, jar);
    expect(r.statusCode).toBe(200);
    absorb(jar, r);
    expect((await get("/auth/session", jar)).statusCode).toBe(200);
  });

  it("refresh_reuse_revokes_family", async () => {
    const jar = await login(newAccount());
    const stolen = jar[REFRESH_COOKIE]!;
    const rotated = absorb({ ...jar }, await post("/auth/refresh", undefined, jar));
    expect(rotated[REFRESH_COOKIE]).not.toBe(stolen);

    // The thief replays the old refresh token → the whole family dies.
    const reuse = await post("/auth/refresh", undefined, { [REFRESH_COOKIE]: stolen });
    expect(reuse.json()).toEqual({ error: "REFRESH_REUSED" });
    // The legitimate, newer session is revoked too.
    expect((await get("/auth/session", rotated)).statusCode).toBe(401);
    expect((await post("/auth/refresh", undefined, rotated)).json()).toEqual({ error: "REFRESH_INVALID" });
    const [audit] = await sql.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE action = 'session.refresh_reuse_revoked_family'",
    );
    expect(audit?.n).toBe("1");
  });

  it("logout revokes the family and clears cookies", async () => {
    const jar = await login(newAccount());
    const res = await post("/auth/logout", undefined, jar);
    expect(res.statusCode).toBe(200);
    expect((await get("/auth/session", jar)).statusCode).toBe(401);
    expect((await post("/auth/refresh", undefined, jar)).statusCode).toBe(401);
  });
});

describe("invitations, consent and eligibility", () => {
  it("invite_single_use_and_hashed", async () => {
    const { code } = await createInvitation(sql, settings, 7 * 24 * 60 * 60_000);
    const rows = await sql.query<Record<string, unknown>>("SELECT * FROM invitations");
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(rows[0]?.code_sha256).toBe(sha256Hex(code));

    const a = await login(newAccount());
    expect((await post("/auth/invitations/redeem", { code }, a)).statusCode).toBe(200);
    const b = await login(newAccount());
    const again = await post("/auth/invitations/redeem", { code }, b);
    expect(again.statusCode).toBe(403);
    expect(again.json()).toEqual({ error: "INVITE_INVALID" });
  });

  it("invite_binds_only_after_wallet_proof", async () => {
    const { code } = await createInvitation(sql, settings, 60 * 60_000);
    const anon = await post("/auth/invitations/redeem", { code });
    expect(anon.json()).toEqual({ error: "SESSION_REQUIRED" });
    const [inv] = await sql.query<{ used_at: Date | null }>("SELECT used_at FROM invitations");
    expect(inv?.used_at).toBeNull(); // the failed attempt consumed nothing

    const acct = newAccount();
    const jar = await login(acct);
    expect((await post("/auth/invitations/redeem", { code }, jar)).statusCode).toBe(200);
    const [w] = await sql.query<{ address: string }>("SELECT address FROM wallets");
    expect(w?.address).toBe(acct.address.toLowerCase());
  });

  it("one wallet binds once, expired invites fail, and a failed redeem leaves no participant", async () => {
    const first = await createInvitation(sql, settings, 60 * 60_000);
    const second = await createInvitation(sql, settings, 60 * 60_000);
    const jar = await login(newAccount());
    expect((await post("/auth/invitations/redeem", { code: first.code }, jar)).statusCode).toBe(200);
    expect((await post("/auth/invitations/redeem", { code: second.code }, jar)).json()).toEqual({ error: "WALLET_ALREADY_BOUND" });

    const late = await createInvitation(sql, settings, 60_000);
    advance(2 * 60_000);
    const other = await login(newAccount());
    expect((await post("/auth/invitations/redeem", { code: late.code }, other)).json()).toEqual({ error: "INVITE_INVALID" });
    const [p] = await sql.query<{ n: string }>("SELECT count(*)::text AS n FROM participants");
    expect(p?.n).toBe("1"); // rolled back: no orphan participant from the failed redeem
  });

  it("consent binds to the exact disclosure text; eligibility keeps on-chain admission separate", async () => {
    const { code } = await createInvitation(sql, settings, 60 * 60_000);
    const jar = await login(newAccount());
    const noParticipant = await post("/auth/consent", { version: TESTNET_DISCLOSURE.version, sha256: sha256Hex("x") }, jar);
    expect(noParticipant.json()).toEqual({ error: "PARTICIPANT_REQUIRED" });

    await post("/auth/invitations/redeem", { code }, jar);
    const d = (await get("/auth/disclosure")).json() as { version: string; sha256: string };
    const wrong = await post("/auth/consent", { version: d.version, sha256: sha256Hex("different text") }, jar);
    expect(wrong.json()).toEqual({ error: "CONSENT_VERSION_MISMATCH" });
    expect((await post("/auth/consent", { version: d.version, sha256: d.sha256 }, jar)).statusCode).toBe(200);

    const e = (await get("/auth/eligibility", jar)).json() as {
      backendOnboarding: { complete: boolean; consent: { accepted: boolean } };
      onchainAdmission: { tag: string; reason: string };
    };
    expect(e.backendOnboarding.complete).toBe(true);
    expect(e.backendOnboarding.consent.accepted).toBe(true);
    expect(e.onchainAdmission.tag).toBe("UNAVAILABLE");
    expect(e.onchainAdmission).not.toHaveProperty("value");
  });

  it("idempotency keys are unique per account", async () => {
    const acct = "0x" + "ab".repeat(20);
    await sql.query("INSERT INTO intents (account, idempotency_key, action, body_sha256) VALUES ($1, 'k1', 'CLAIM', $2)", [acct, sha256Hex("a")]);
    await expect(
      sql.query("INSERT INTO intents (account, idempotency_key, action, body_sha256) VALUES ($1, 'k1', 'CLAIM', $2)", [acct, sha256Hex("b")]),
    ).rejects.toThrow();
  });
});
