# TEST_PLAN — requirements-to-test matrix

Created in Session 1 (spec §26). Maps v2 blueprint requirements to test
artifacts. Status values: **DONE** (exists and passes for the v2 requirement),
**COVERED-V0** (an equivalent v0 test exists but targets the v0 design —
evidence of practice, not of the v2 behavior), **PARTIAL**, **PLANNED-Sn**
(scheduled session). Coverage percentages are not release evidence (spec §23).

The independent integer reference model (waterfall + request lifecycle, golden
examples shared across Solidity and TypeScript) starts in `packages/domain`
(vector schema + conservation identity) and is completed in Session 2. The
reference must not call the implementation under test.

## Accounting (spec §7)

| Requirement | Artifact | Status |
|---|---|---|
| Conservation `ΔH+ΔB+ΔR+FT = G` on golden vectors | `packages/domain/test/golden.test.ts` over `docs/spec/ACCOUNTING_GOLDEN_VECTORS.json` | DONE |
| All **8** vectors of `reference/reference_model.py` (adds loss_recovery, partial_fee, fee_waiver) | `reference/reference_model.py` (PASS 2026-09-30); `packages/domain` holds 5 → extend to 8 via `reference/vectors/*.json` | PARTIAL → PLANNED-S2 |
| Conservation identity in contracts | v0: `contracts/test/fuzz/Conservation.t.sol` (v0 identity incl. treasury) | COVERED-V0 → PLANNED-S2 for v2 waterfall |
| Loss carryforward L (no fee on recovery) | reference model + Solidity vectors | PLANNED-S2 |
| Fee split FR/FT with reserve-deficit cap | reference model + Solidity vectors | PLANNED-S2 |
| Two-pass rule: impaired epoch recomputed with zero fees | reference model + Solidity vectors | PLANNED-S2 |
| Integer/no-Number money handling | `packages/domain/test/units.test.ts` (BigInt parse/format, rejects float forms) | DONE (schemas) — adoption in app/service pending |
| No negative tranche balances / insolvency is explicit | invariant campaign | PLANNED-S2 |

## Hull lifecycle (spec §8)

| Requirement | Artifact | Status |
|---|---|---|
| Series state machine (8 states, atomic activation) | Foundry unit + invariant | PLANNED-S2 |
| Coupon accrual (simple, stops at maturity/termination) | v0: `Tranches` accrual tests exist for perpetual 8% | COVERED-V0 → PLANNED-S2 |
| Proportional funding before claims (no first-claimer edge) | Foundry scenario | PLANNED-S2 |
| Rate policy (EWMA, haircut, cap, no fabricated history) | TS rate module tests | PLANNED-S4 (needs 30d data) |

## Ballast and queues (spec §9)

| Requirement | Artifact | Status |
|---|---|---|
| Inflation/first-depositor defense | v0: `test/unit/Inflation.t.sol` + dead shares | COVERED-V0 → re-verify for v2 custody in S2 |
| 48h cooldown, cancel, partial fills, user-limited skip | Foundry queue tests | PLANNED-S2 |
| No claimable exit without segregated funds (D10) | invariant | PLANNED-S2 |
| Subordination: 30% gate / 20% floor incl. projected coupon | v0: 20% floor tests in `Tranches.t.sol` | COVERED-V0 (floor only) → PLANNED-S2 |
| Zero-B with supply blocks deposits | Foundry unit | PLANNED-S2 |

## Risk policy and execution (spec §10–§11)

| Requirement | Artifact | Status |
|---|---|---|
| Delta bands, slice caps, slippage refusal | keeper policy tests + adapter replay | PLANNED-S3 |
| Paired slicing, failed-leg compensation, UNHEDGED_ALERT | adapter replay tests (recorded venue traces) | PLANNED-S3 |
| Idempotent orders, lost-ack reconciliation, two keepers | journal/outbox tests, fencing-token test | PLANNED-S3 |
| Margin stress +30% MON without top-up | stress model | PLANNED-S3 (gated G02) |

## Evidence and data (spec §12–§13)

| Requirement | Artifact | Status |
|---|---|---|
| Tagged type LIVE/STALE/UNAVAILABLE/PARTIAL/MISMATCH/SIMULATED; UNAVAILABLE has no value; only LIVE authorizes risk | `packages/domain/test/evidence.test.ts` + typecheck | DONE (schemas) |
| Single-block snapshot with blockHash; PARTIAL/MISMATCH on skew | verifier CLI tests | PLANNED-S4 |
| Event identity (chainId, blockHash, txHash, logIndex); reorg replay | indexer tests | PLANNED-S4 |
| Independent CLI recomputes hedge + waterfall without Vessel API | CLI golden runs | PLANNED-S4 |

## Auth (spec §14, docs/AUTH.md)

| Requirement | Artifact | Status |
|---|---|---|
| SIWE full validation (domain, URI, chain, nonce, window) | service unit tests | PLANNED-S1 (remaining item) |
| Nonce single-use; refresh rotation + reuse-revocation | service unit tests | PLANNED-S1 (remaining item) |
| Session expiry 15m/7d; logout revokes | service unit tests | PLANNED-S1 (remaining item) |

### Phase 1 named tests (master build prompt §1.6)

| Test | Module | Status |
|---|---|---|
| `siwe_rejects_cross_domain_replay` | vessel-service auth | PLANNED-S1 |
| `siwe_rejects_wrong_chain` | vessel-service auth | PLANNED-S1 |
| `siwe_rejects_reused_nonce` | vessel-service auth | PLANNED-S1 |
| `siwe_rejects_expired_nonce` | vessel-service auth | PLANNED-S1 |
| `refresh_reuse_revokes_family` | vessel-service auth | PLANNED-S1 |
| `wallet_switch_clears_private_queries` | app | PLANNED-S1 |
| `invite_single_use_and_hashed` | vessel-service auth | PLANNED-S1 |
| `invite_binds_only_after_wallet_proof` | vessel-service auth | PLANNED-S1 |
| `env_rejects_mainnet_mock_provider` | packages/config | PLANNED-S1 |
| `env_rejects_placeholder_address` | packages/config | PLANNED-S1 |
| `env_rejects_lab_address_on_mainnet` | packages/config | PLANNED-S1 |
| `money_schema_rejects_js_number` | packages/domain | PLANNED-S1 |
| `onboarding_desktop_and_mobile_360px` (Playwright) | app | PLANNED-S1 |

## App (spec §15)

| Requirement | Artifact | Status |
|---|---|---|
| Error/edge states per route (14 listed conditions) | v0: `/demo` states + `app/lib/__tests__` | PARTIAL → PLANNED-S5 browser journeys |
| Truthful banners (testnet vs mainnet) | v0: app/CLAUDE.md enforced copy | PARTIAL (testnet only) |
| Tx states incl. `unknown → reconcile` | app tests | PLANNED-S5 |

## Caps and admission (spec §19)

| Requirement | Artifact | Status |
|---|---|---|
| Lifetime budgets, per-wallet quotas, atomic reservation across all entry paths | Foundry invariants | PLANNED-S2/S3 |
| Stage transitions behind 48h timelock | Foundry + governance tests | PLANNED-S3 |

## Scenario campaign (spec §23)

The full scenario list (first-depositor, loss-then-recovery, G below coupon,
Ballast wipeout, Hull impairment, 30d negative funding, ±30%/±50% shocks,
depeg, thin depth, partial fills, lost acks, ws reconnect, two keepers, key
rotation, stale oracles, RPC disagreement, reorg replay, paused claims,
refund races, queue starvation, exit-at-maturity crowd) is tracked here as the
release checklist for R01/R05; each lands with its owning session. Nightly
100k-action randomized campaign: PLANNED-S7.

## Inbound supported-chain funding (D30, Handbook v4 ch. 6)

| Requirement | Artifact | Status |
|---|---|---|
| Solver / tx sender never becomes beneficiary; EIP-712 binding (ERC-1271 for contract wallets) | `solver_cannot_become_beneficiary`, `forged_binding_rejected` | PLANNED-S6 |
| Credit the observed transfer amount, never adapter balance | `adapter_uses_observed_amount_not_balance` | PLANNED-S6 |
| One `BetaAdmission` ledger across native and remote entry | `inbound_shares_global_cap_with_native` (concurrent) | PLANNED-S2 (ledger) / S6 (adapter) |
| Late arrival after Hull close is refundable on Monad | `late_arrival_refundable` | PLANNED-S6 |
| Duplicate/racing callbacks → one terminal disposition | `duplicate_callback_single_disposition` | PLANNED-S6 |
| Recovery with the quote service offline | `recovery_without_quote_service` | PLANNED-S6 |
| Overdelivery goes to a separate credit | `overdelivery_to_credit` | PLANNED-S6 |
