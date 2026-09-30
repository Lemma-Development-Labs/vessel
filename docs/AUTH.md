# AUTH

Design frozen 2026-09-23 per [spec/VESSEL_V1.md](spec/VESSEL_V1.md) §14;
**implemented 2026-09-30** in `vessel-service/src/auth/` (tests:
`vessel-service/test/auth.test.ts`, 15 passing against real Postgres via
PGlite). Not yet deployed: the app rewrite and shell are the next step. A wallet connection is display-only and is **not** an authenticated
server session.

## Model

- **Wallet connection** (wagmi): read public chain positions. No server state.
- **SIWE session** (EIP-4361): required for private beta profile and consent
  actions. Verified server-side with viem's SIWE utilities.

## Placement

Endpoints live in **vessel-service** (it owns Postgres) and are reached
**same-origin** through Next.js rewrites in the app:

```
app domain /api/auth/*  ──rewrite──▶  vessel-service /auth/*
```

Cookies are therefore first-party on the app domain; no third-party-cookie
dependence, no CORS credential exposure. The auth routes are rate-limited
separately from public reads (spec §13).

## Endpoints

| Route | Behavior |
|---|---|
| `POST /auth/nonce` | issue single-use nonce (stored server-side with TTL) |
| `POST /auth/verify` | validate SIWE message: domain, URI, chainId, nonce (consume), issuedAt/expiry window, recovered address; then create session |
| `POST /auth/refresh` | rotate refresh token; reuse of a consumed token revokes the whole session family (theft detection) |
| `POST /auth/logout` | revoke refresh family |
| `GET /auth/session` | current wallet + expiry, or 401 |
| `GET /auth/disclosure` | current versioned disclosure text + SHA-256 (single source; the app renders it) |
| `POST /auth/invitations/redeem` | session required; binds the invitation to the signed-in wallet atomically with creating the participant |
| `POST /auth/consent` | session + participant required; records `{version, sha256}` only if the hash matches the published text |
| `GET /auth/eligibility` | backend onboarding status, and on-chain admission as a separate `UNAVAILABLE` field until BetaAdmission exists |

All `POST` routes require `Origin` = `AUTH_ORIGIN` **and** `x-vessel-csrf: 1`
(403 `CSRF` otherwise). Auth routes have their own rate limit (30/min/IP),
separate from public reads, and run in an encapsulated Fastify scope so the
public API's error handling and CORS (GET/HEAD, no credentials) are unchanged.
SIWE messages must carry `expirationTime` and live ≤ 10 minutes; `issuedAt`
may lead the server clock by ≤ 60 s. Error codes are listed in
`src/auth/core.ts` (`AuthErrorCode`).

## Session policy

- Cookies: `HttpOnly; Secure; SameSite=Lax; Path=/api/auth` (refresh) and
  `Path=/` (access). No tokens in localStorage or JS-readable state.
- Access lifetime **15 minutes**; refresh sessions revocable, **≤ 7 days**,
  rotated on every use.
- Postgres `auth_sessions` table: opaque IDs, hashed refresh tokens, family
  ID, expiry, revocation timestamps. No IP-to-wallet retention (spec §22).
- Wallet/account switch clears cached private queries and requires new SIWE.
- Contract-wallet signatures (ERC-1271/6492) are **deferred until tested**;
  EOA-only at first, stated in the UI (spec §14).
- Email, if ever collected, is support metadata only — never authority to
  move funds.

## Storage and configuration

- Tables (migration `001_identity`): `participants`, `wallets` (address PK,
  one wallet per participant), `invitations` (SHA-256 only, single-use),
  `consent_versions`, `consents`, `auth_nonces`, `auth_sessions` (token
  hashes only), `audit_events`, `intents` (`UNIQUE(account, idempotency_key)`,
  used from Session 4).
- `AUTH_DOMAIN` + `AUTH_ORIGIN` enable auth; https required except localhost
  outside mainnet. `DATABASE_URL` is required on mainnet; without it
  (local/testnet only) sessions live in an in-process PGlite.
- Invitations: `pnpm invite:create [ttlDays]` against a real database prints
  the code once. Non-mainnet runs may pre-seed code hashes with
  `AUTH_SEED_INVITE_SHA256S`; mainnet refuses that variable.
- Disclosure: `src/auth/disclosures.ts` holds the testnet text; mainnet has
  none and refuses to serve one until counsel-reviewed terms exist (G06).
- BetaAdmission linkage (on-chain) is Session 2.
