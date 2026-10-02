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

## Sessions 3 + 4 — Day 2 of the 3-day plan · 2026-09-30 → 2026-10-01 · `testnet deployed`, wiring pending Safe

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

Testnet: v2 core redeployed 2026-10-02 at block 67565062 under a new Safe `0x12B2…2Ee5` (first deploy at 67163430 superseded); all 7 contracts
Sourcify exact-match, roles checked on chain, 20 dUSD reserve seed sent to
the timelock, `vessel-verify` OVERALL PASS (empty book). Addresses:
[ADDRESSES.md](ADDRESSES.md#v2-core--monad-testnet-2026-10-01). Wiring waits
on Safe batch 01 (files generated in `deployments/governance/`).

## Day 3 — app, Terminal, SDK/MCP, release · 2026-10-01 · `testnet GO (conditional)`, mainnet NO-GO

Checkpoint: [sessions/05.md](sessions/05.md). Decision:
[release/GO_NO_GO.md](release/GO_NO_GO.md). 286 tests across seven suites.

Done: app on the v2 book (deposit, portfolio, withdraw, series,
transparency) and `/terminal` with a typed command palette; `packages/sdk`
(evidence-enveloped reads, unsigned preparation); `tools/vessel-mcp`
(spec read/verify tools, prepare gated); release record with all twelve
gates evaluated.

## Blockers and follow-ups

| Item | Owner | Blocks |
|---|---|---|
| Fund the testnet keeper | Kunal | v0 demo settlement |
| Safe batch 01 executed 2026-10-02. Next: tester wallet list for batch 03 (allowances), then batch 02 (Hull series 1) | Priya / Safe signers | first deposits; Hull series |
| Set `V2_KEEPER_PK` (keeper `0xd158…f16f`, funded 5 MON) and the v2 manifest on Railway; `NEXT_PUBLIC_STATS_URL` on Vercel | Priya | v2 keeper + app evidence panels |
| Confirm the 2026-08-29 transactions from compromised key `0x4307…` | Kunal | incident record |
| New Safe `0x12B2…2Ee5` signers share one phrase during the build — swap in team-held signers at handover | Priya / team | G07, R07 |
| Evidence OPS.md §0 Railway/Vercel token rotation | Kunal | R05 |
| Split keeper key from the public API process | Daksh | any venue-authority key (S3) |
| Set `VESSEL_ENV=testnet` on Railway before deploying this branch | Kunal | service start |
| Set `VESSEL_API_URL` on Vercel for `/onboarding` | Kunal | sign-in in production |
| Per-file session prompts 01–08 (hashes in `spec/SHA256SUMS.json`) | Kunal | D15 provenance only |
| G01–G07, G09–G10 | see FACT_CHECKS | mainnet beta |

## Resume instruction

Meet the two testnet GO conditions in [release/GO_NO_GO.md](release/GO_NO_GO.md), then follow [sessions/05.md](sessions/05.md).
