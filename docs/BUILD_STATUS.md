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

## Session 2 — next

Economic core and complete local claim lifecycle. Resume instruction at the
end of [sessions/01.md](sessions/01.md).

## Blockers and follow-ups

| Item | Owner | Blocks |
|---|---|---|
| Fund the testnet keeper | Kunal | v0 demo settlement |
| Confirm the 2026-08-29 transactions from compromised key `0x4307…` | Kunal | incident record |
| Evidence Safe `0xe4f2…0279` signer independence | Kunal | G07, R07 |
| Evidence OPS.md §0 Railway/Vercel token rotation | Kunal | R05 |
| Split keeper key from the public API process | Daksh | any venue-authority key (S3) |
| Set `VESSEL_ENV=testnet` on Railway before deploying this branch | Kunal | service start |
| Set `VESSEL_API_URL` on Vercel for `/onboarding` | Kunal | sign-in in production |
| Per-file session prompts 01–08 (hashes in `spec/SHA256SUMS.json`) | Kunal | D15 provenance only |
| G01–G07, G09–G10 | see FACT_CHECKS | mainnet beta |

## Resume instruction

Start **Session 2** per the resume instruction in [sessions/01.md](sessions/01.md).
