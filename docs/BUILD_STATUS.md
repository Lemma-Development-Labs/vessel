# BUILD_STATUS

Updated 2026-09-30 · branch `p-development` · v2 program per
[spec/VESSEL_V1.md](spec/VESSEL_V1.md) (+ D30 from [HANDBOOK_v4.md](HANDBOOK_v4.md)),
sessions per §25.

## Overall readiness

**blocked** for the v2 mainnet beta: G01–G07 and route gates G09–G10 open
([FACT_CHECKS.md](FACT_CHECKS.md)); R01–R12 not evaluated; P01–P10 open
([RISK_PARAMETERS.md](RISK_PARAMETERS.md)).

The v0 testnet demo: contracts live and Sourcify-verified; **keeper out of gas
since 2026-09-28 06:56 UTC** (fund `0x2A3f…de65` — owner Kunal).

## Session 1 — closed 2026-09-30 · `local complete`

Checkpoint and evidence: [sessions/01.md](sessions/01.md).
Inventory: [INVENTORY.md](INVENTORY.md). All thirteen named Phase 1 tests
DONE ([TEST_PLAN.md](TEST_PLAN.md)).

## Session 2 — Day 1 of the 3-day plan (ADR-008) · closed 2026-09-30 · `local complete`

Checkpoint: [sessions/02.md](sessions/02.md). 147 contract tests, coverage 98.91%.

Done: golden vectors exported from the reference model; `packages/math`
(independent TS port); Solidity `Waterfall`/`Coupon`/`Coverage` matching all
8 golden + 10,000 seeded cases; v2 core contracts in `contracts/src/core`
(TrancheController, AssetCustody, ClaimEscrow, BallastToken, PauseGuardian)
with 28 lifecycle tests; randomized invariant campaign (32,768 calls in CI profile). Accounting as
implemented: [ACCOUNTING.md](ACCOUNTING.md).

Not in this session (by plan): real venues and valuation adapter (Day 2),
48 h timelock contract (governance is an address today; the Safe/timelock
wiring lands with deployment), D30 route adapter and vUSD lab (deferred).

## Sessions 3 + 4 — Day 2 of the 3-day plan · 2026-09-30 · `local complete`, testnet deploy pending

Checkpoint: [sessions/03.md](sessions/03.md). 155 contract tests; service 40;
verify-cli 7.

Done: `DeployV2.s.sol` (TimelockController 300 s owned by the Safe,
PauseGuardian, TrancheController, labelled `SimulatedEngine`); Safe
Transaction Builder batches for the timelock; durable keeper journal
(fencing, nonce-pinned dispatch, UNKNOWN on timeout) and v2 keeper policy;
independent `vessel-verify` CLI; `/v1` evidence API (book, series,
requests, history); reorg-aware event indexer. Full rehearsal on Anvil:
deploy → Safe batches → timelock delay enforced → keeper admitted, deployed
and settled a deposit → `vessel-verify` OVERALL PASS.

Not done: the Monad testnet broadcast — waits on `contracts/.env`
(`DEPLOYER_PK`, `MONAD_TESTNET_RPC`) from the owner; runbook in
[../deployments/README.md](../deployments/README.md).

## Blockers and follow-ups

| Item | Owner | Blocks |
|---|---|---|
| Fund the testnet keeper | Kunal | v0 demo settlement |
| Add `contracts/.env` with a fresh `DEPLOYER_PK` + `MONAD_TESTNET_RPC`, then Safe signers approve batches 01 → 03 → 02 | Priya / Safe signers | v2 testnet deploy |
| Fund a separate v2 keeper key (`V2_KEEPER_PK`) with testnet MON | Priya | v2 keeper on testnet |
| Confirm the 2026-08-29 transactions from compromised key `0x4307…` | Kunal | incident record |
| Evidence Safe `0xe4f2…0279` signer independence | Kunal | G07, R07 |
| Evidence OPS.md §0 Railway/Vercel token rotation | Kunal | R05 |
| Split keeper key from the public API process | Daksh | any venue-authority key (S3) |
| Set `VESSEL_ENV=testnet` on Railway before deploying this branch | Kunal | service start |
| Set `VESSEL_API_URL` on Vercel for `/onboarding` | Kunal | sign-in in production |
| Per-file session prompts 01–08 (hashes in `spec/SHA256SUMS.json`) | Kunal | D15 provenance only |
| G01–G07, G09–G10 | see FACT_CHECKS | mainnet beta |

## Resume instruction

Run the testnet deploy (Day 2 tail), then **Day 3** per the resume instruction in [sessions/03.md](sessions/03.md).
