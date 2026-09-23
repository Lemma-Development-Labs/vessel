# AUTH

Frozen design (Session 1, 2026-09-23) per [spec/VESSEL_V1.md](spec/VESSEL_V1.md)
§14. Implementation is the remaining Session 1 work item; nothing below is
live yet. A wallet connection is display-only and is **not** an authenticated
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

## Sequencing constraint

`vessel-service/src/db.ts` currently carries uncommitted in-flight changes
(indexer reset on redeploy). Auth tables and code land **after** that work is
committed, to avoid colliding with it. Invite codes, BetaAdmission linkage,
and consent versions are later sessions (S5/S8) — this document covers only
the authenticated shell.
