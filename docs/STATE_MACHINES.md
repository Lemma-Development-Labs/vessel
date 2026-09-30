# STATE_MACHINES

Canonical state names for v2 (Session 1 freeze). Contracts, `packages/domain`,
the API, the app and MCP must use these exact identifiers. Sources:
[spec/VESSEL_V1.md](spec/VESSEL_V1.md) §8–§12, §15 and
[HANDBOOK_v4.md](HANDBOOK_v4.md) ch. 6. Where sources name the same machine
differently, the blueprint wins and the variant is recorded under
"Name reconciliation". Guards listed are the minimum; every money-moving
transition also re-checks chain config, caller, receiver, deadline, pause
dimension, capacity and quota (spec §6).

Nothing here is implemented yet except the observation tags in
`packages/domain`. Implementation sessions are noted per machine.

## 1. Hull series (S2)

| From | To | Trigger / guard |
|---|---|---|
| — | `DRAFT` | governance proposes terms (rate derivation published, terms hash fixed) |
| `DRAFT` | `SUBSCRIPTION_OPEN` | previous series `CLOSED`; reserve ≥ 2% pre-funded; 30-day real rate history present |
| `SUBSCRIPTION_OPEN` | `ACTIVE` | 72 h window ended; ordered eligible set frozen; projected junior cover ≥ 30%; activation atomic (never partial); ≤ 25 subscribers |
| `SUBSCRIPTION_OPEN` | `CANCELLED` | activation conditions fail → all subscriptions `REFUNDABLE` |
| `ACTIVE` | `MATURED_UNWINDING` | `now ≥ activation + 28 d`; coupon accrual stops at maturity |
| `ACTIVE` | `IMPAIRED` | settlement reduces Hull below principal + accrued coupon, or emergency termination (accrual stops at the recorded time; entitlement frozen) |
| `MATURED_UNWINDING` | `CLAIMABLE` | hedge closed in paired slices, collateral returned, all holders funded pro-rata into `ClaimEscrow` |
| `IMPAIRED` | `CLAIMABLE` | recoveries distributed by cumulative per-unit accounting |
| `CLAIMABLE` | `CLOSED` | every claim and recovery reconciled |

No mid-series entry, no early redemption, no rollover, no transfers in the beta.

## 2. Subscription / deposit request (S2)

`REQUESTED → ESCROWED → ADMITTED | REFUNDABLE`, `REFUNDABLE → CLAIMED_REFUND`.
Admission settles the book first and prices forward; a cancellation racing
admission resolves atomically to one terminal disposition. Refund releases
only the never-admitted reservation.

## 3. Ballast exit request (S2)

| From | To | Trigger / guard |
|---|---|---|
| — | `REQUESTED` | holder locks units (still exposed to gains and losses) |
| `REQUESTED` | `COOLING` | immediately; 48 h cooldown starts |
| `COOLING` | `ELIGIBLE` | cooldown elapsed |
| `ELIGIBLE` | `PARTIALLY_FUNDED` / `FUNDED` | settle first; safe liquidity after senior obligations, margin, reserve and projected full-term cover ≥ 30%; burn only the funded fraction |
| `ELIGIBLE` | `USER_LIMITED` | user minimum unmet → skipped without blocking the queue |
| `PARTIALLY_FUNDED` / `FUNDED` | `CLAIMED` | claim to the fixed receiver (independent of the exposed remainder) |
| any unfunded | `CANCELLED` | holder cancels the unfunded remainder; units released |

## 4. Engine mode (S3)

`IDLE`, `DEPLOYING`, `HEDGED`, `REBALANCE_REQUIRED`, `DE_RISKING`,
`UNWINDING`, `VENUE_UNAVAILABLE`, `UNHEDGED_ALERT`, `PAUSED`.
Modes are distinct from pause dimensions (§7). An idle book reports `IDLE`,
never a hedge ratio. Unknown order state forces reconciliation before any
transition that adds risk.

## 5. Observation (implemented: `packages/domain`)

`LIVE`, `STALE`, `UNAVAILABLE`, `PARTIAL`, `MISMATCH`, `SIMULATED`.
`UNAVAILABLE` carries no numeric value. Only `LIVE` may authorize new risk.

## 6. Transaction (S5)

`preparing`, `awaiting_approval`, `awaiting_signature`, `submitted`,
`confirming`, `finalized`, `replaced`, `reverted`, `cancelled`, `expired`,
`unknown`. `unknown` means reconcile; it never invites resubmission. Deposit
success = receipt exists; admission success = units minted; withdrawal
success = funded USDC claimable or received.

## 7. Pause dimensions (S2)

`ADMISSION`, `RISK_INCREASE`, `VALUATION_SETTLEMENT`, `CLAIMS` — independent
flags. Guardian may set; only timelocked governance may clear. Funded claims
stay usable during ordinary risk pauses; the `CLAIMS` pause is reserved for an
escrow-specific exploit. Exact masks are open parameter P09.

## 8. Inbound route and route subscription (D30, S6)

Route: `QUOTED`, `AUTHORIZED`, `SOURCE_COMMITTED`, `IN_TRANSIT`, `ARRIVED`,
`RECOVERY_PENDING`, `RECOVERABLE`, `CLOSED`.
Route subscription: `NOT_REQUESTED`, `RESERVED`, `PENDING`, `ADMITTED`,
`REFUNDABLE`, `CLAIMED_REFUND`.
Route record (manifest): `CANDIDATE`, `TESTNET_QUALIFIED`, `REVIEWED`,
`CANARY`, `ACTIVE`, `PAUSED`, `RETIRED` — only `ACTIVE` appears on mainnet.

## 9. Keeper action journal (S3)

`PERSISTED → DISPATCHED → ACKED → PARTIAL | FILLED → RECONCILED`, with
`UNKNOWN` reachable from `DISPATCHED`/`ACKED` on timeout. `UNKNOWN` resolves
only by querying venue state; never by resubmission.

## Name reconciliation

| Machine | Canonical (blueprint) | Variant in support docs | Decision |
|---|---|---|---|
| Engine mode | 9 modes above (§11 / Session 3) | `IDLE, OPENING, HEDGED, REBALANCING, CLOSING, PAUSED, WIND_DOWN` (company doc 02, support doc 04) | blueprint names; `WIND_DOWN` ≡ `UNWINDING` with governance-initiated cause |
| Hull impaired | `IMPAIRED` (§8) | `IMPAIRED_RECOVERY` (support doc 04) | `IMPAIRED` |
| Ballast exit skipped | `USER_LIMITED` (§9 prose "marked user-limited") | not named | `USER_LIMITED` |
