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
| All **8** vectors + 5,000 seeded (+ fee-disabled) cases of `reference/reference_model.py` | `contracts/test/differential/Vectors.t.sol` + `packages/math` over `reference/vectors/*` | DONE (2026-09-30) — Python, TypeScript and Solidity agree exactly |
| Conservation identity in contracts | on-chain assert in `Waterfall.settle`; `testFuzz_conservation_and_loss_order`; `contracts/test/core/CoreInvariant.t.sol` | DONE (2026-09-30) |
| Loss carryforward L (no fee on recovery) | `contracts/test/differential/Vectors.t.sol` + `packages/math` (loss_recovery, partial_fee) | DONE (2026-09-30) |
| Fee split FR/FT with reserve-deficit cap | `contracts/test/differential/Vectors.t.sol` + `packages/math` (positive) | DONE (2026-09-30) |
| Two-pass rule: impaired epoch recomputed with zero fees | `contracts/test/differential/Vectors.t.sol` + `packages/math` (fee_waiver) + `contracts/test/core/Lifecycle.t.sol` impairment | DONE (2026-09-30) |
| Integer/no-Number money handling | `packages/domain/test/units.test.ts` (BigInt parse/format, rejects float forms) | DONE (schemas) — adoption in app/service pending |
| No negative tranche balances / insolvency is explicit | `test_insolvency_reverts_not_floors`; `contracts/test/core/CoreInvariant.t.sol` | DONE (2026-09-30) |

## Hull lifecycle (spec §8)

| Requirement | Artifact | Status |
|---|---|---|
| Series state machine (8 states, atomic activation) | `contracts/test/core/Lifecycle.t.sol` (activation, cover exclusion, min-rate refund, no mid-series entry, maturity, impairment) | DONE (2026-09-30) — invariant over series lifecycle PLANNED-S7 |
| Coupon accrual (simple, stops at maturity/termination) | coupon vector; `test_coupon_stops_at_maturity`; cumulative-truncation test in `packages/math` | DONE (2026-09-30) |
| Proportional funding before claims (no first-claimer edge) | `test_senior_impairment_pro_rata_and_cumulative_recovery` | DONE (2026-09-30) |
| Rate policy (EWMA, haircut, cap, no fabricated history) | TS rate module tests | PLANNED-S4 (needs 30d data) |

## Ballast and queues (spec §9)

| Requirement | Artifact | Status |
|---|---|---|
| Inflation/first-depositor defense | virtual offsets + donation quarantine: `test_donation_does_not_raise_capacity_or_yield` | DONE (2026-09-30) — offsets for mainnet remain P02 |
| 48h cooldown, cancel, partial fills, user-limited skip | `contracts/test/core/Lifecycle.t.sol` | DONE (2026-09-30) |
| No claimable exit without segregated funds (D10) | escrow backing check in `ClaimEscrow.fund`; `contracts/test/core/CoreInvariant.t.sol` | DONE (2026-09-30) |
| Subordination: 30% gate / 20% floor incl. projected coupon | coverage vector; `test_payout_blocked_below_projected_30pct_cover`; `test_activation_excludes_what_would_break_projected_cover` | DONE (2026-09-30) — 20% intervention is keeper policy (S3) |
| Zero-B with supply blocks deposits | `test_zero_B_blocks_deposit` | DONE (2026-09-30) |

## Risk policy and execution (spec §10–§11)

| Requirement | Artifact | Status |
|---|---|---|
| Delta bands, slice caps, slippage refusal | keeper policy tests + adapter replay | PLANNED-S3 |
| Paired slicing, failed-leg compensation, UNHEDGED_ALERT | adapter replay tests (recorded venue traces) | PLANNED-S3 |
| Idempotent orders, lost-ack reconciliation, two keepers | `vessel-service/test/keeper-v2.test.ts` (persist-before-dispatch, crash restart, `timeout_is_unknown_not_failed`, `two_workers_one_signs`, `stale_worker_rejected_by_fencing`, allowlist, superseded) | DONE (2026-09-30) for v2 controller actions; venue orders PLANNED-S3 (G01) |
| Margin stress +30% MON without top-up | stress model | PLANNED-S3 (gated G02) |

## Evidence and data (spec §12–§13)

| Requirement | Artifact | Status |
|---|---|---|
| Tagged type LIVE/STALE/UNAVAILABLE/PARTIAL/MISMATCH/SIMULATED; UNAVAILABLE has no value; only LIVE authorizes risk | `packages/domain/test/evidence.test.ts` + typecheck | DONE (schemas) |
| Single-block snapshot with blockHash; PARTIAL/MISMATCH on skew | `tools/verify-cli/test/checks.test.ts`; `/v1/book` in `vessel-service/test/v1-api.test.ts` | DONE (2026-09-30) — every read pinned to one finalized block; failed check → MISMATCH; venue PARTIAL arrives with real venues (G01) |
| Event identity (chainId, blockHash, txHash, logIndex); reorg replay | `vessel-service/test/v2-indexer.test.ts` (`dedupe_uses_full_event_identity`, `reorg_replay`, finality); `/v1/history` tests | DONE (2026-09-30) |
| Independent CLI recomputes hedge + waterfall without Vessel API | `vessel-verify` (book identity, backing, caps, units) — local Anvil run OVERALL PASS | PARTIAL (2026-09-30) — book checks DONE; hedge recompute BLOCKED on G01 (testnet engine is SIMULATED) |

## Auth (spec §14, docs/AUTH.md)

| Requirement | Artifact | Status |
|---|---|---|
| SIWE full validation (domain, URI, chain, nonce, window) | `vessel-service/test/auth.test.ts` | DONE (2026-09-30) |
| Nonce single-use; refresh rotation + reuse-revocation | `vessel-service/test/auth.test.ts` | DONE (2026-09-30) |
| Session expiry 15m/7d; logout revokes | `vessel-service/test/auth.test.ts` | DONE (2026-09-30) |

### Phase 1 named tests (master build prompt §1.6)

| Test | Module | Status |
|---|---|---|
| `siwe_rejects_cross_domain_replay` | `vessel-service/test/auth.test.ts` | DONE (2026-09-30) |
| `siwe_rejects_wrong_chain` | `vessel-service/test/auth.test.ts` | DONE (2026-09-30) |
| `siwe_rejects_reused_nonce` | `vessel-service/test/auth.test.ts` | DONE (2026-09-30) |
| `siwe_rejects_expired_nonce` | `vessel-service/test/auth.test.ts` | DONE (2026-09-30) |
| `refresh_reuse_revokes_family` | `vessel-service/test/auth.test.ts` | DONE (2026-09-30) |
| `wallet_switch_clears_private_queries` | `app/lib/__tests__/auth.test.ts` | DONE (2026-09-30) |
| `invite_single_use_and_hashed` | `vessel-service/test/auth.test.ts` | DONE (2026-09-30) |
| `invite_binds_only_after_wallet_proof` | `vessel-service/test/auth.test.ts` | DONE (2026-09-30) |
| `env_rejects_mainnet_mock_provider` | `packages/config/test/config.test.ts` | DONE (2026-09-30) |
| `env_rejects_placeholder_address` | `packages/config/test/config.test.ts` | DONE (2026-09-30) |
| `env_rejects_lab_address_on_mainnet` | `packages/config/test/config.test.ts` | DONE (2026-09-30) |
| `money_schema_rejects_js_number` | `packages/domain/test/money.test.ts` | DONE (2026-09-30) |
| `onboarding_desktop_and_mobile_360px` (Playwright) | `app/e2e/onboarding.spec.ts` — desktop 1280 px + mobile 360 px, real app + service, zero browser errors | DONE (2026-09-30) |

## App (spec §15)

| Requirement | Artifact | Status |
|---|---|---|
| Error/edge states per route (14 listed conditions) | v2 `/demo` states (unwired, empty, notinvited, disconnected, paused, impair, error, wrongnet); `app/lib/__tests__/book-plan.test.ts` mirrors each requestDeposit revert | PARTIAL (2026-10-01) — stale oracle/venue outage states await real venues (G01) |
| Truthful banners (testnet vs mainnet) | `lib/banner.ts`; SIMULATED ENGINE chip; Rule 0 tests on the v2 provider | DONE (testnet) |
| No fabricated zeros / unguarded reads | `app/lib/__tests__/rule0.test.ts` retargeted to `lib/book/chain.tsx` | DONE (2026-10-01) |
| Tx states incl. `unknown → reconcile` | app actions resolve confirmed/failed; refetch from chain after each | PARTIAL — no persisted pending-tx recovery across reloads |
| Terminal panels truthful when data is missing | `/terminal` HEDGE/CARRY/OPPORTUNITIES render reasons (G01), opportunity verdict refuses entry | DONE (2026-10-01) |

## Machine access (spec §17, R11)

| Requirement | Artifact | Status |
|---|---|---|
| Spec read/verify tools, same envelope as API | `tools/vessel-mcp/test/mcp.test.ts`; cold stdio test on testnet (docs/MCP.md) | DONE (2026-10-01) |
| Prepare behind a separate gate; no keys, no submission, no raw calldata, no redirect | MCP tests (gate off by default, injected receiver/to ignored, no send/raw tools); `packages/sdk/test/sdk.test.ts` (exact approvals, owner = receiver, exitKey matches the deployed controller) | DONE (2026-10-01) |
| Host compatibility | — | NOT CLAIMED — no AI host tested |

## Caps and admission (spec §19)

| Requirement | Artifact | Status |
|---|---|---|
| Lifetime budgets, per-wallet quotas, atomic reservation across all entry paths | `test_lifetime_cap_across_all_paths_and_withdrawal_does_not_refill`, `test_refund_releases_only_unadmitted`, `test_not_eligible_without_allowance`; `contracts/test/core/CoreInvariant.t.sol` | DONE (2026-09-30) for native paths; D30 route deferred (ADR-008) |
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
