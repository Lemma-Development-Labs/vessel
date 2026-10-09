# BUILD_STATUS

Updated 2026-10-05 · branch `p-development` · v2 program per
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
[ADDRESSES.md](ADDRESSES.md#v2-core--monad-testnet-2026-10-02). Safe batch 01
executed 2026-10-02: engine wired, 25,000 dUSD stage cap, 20 dUSD reserve;
`vessel-verify` PASS at latest and finalized blocks.

## Day 3 — app, Terminal, SDK/MCP, release · 2026-10-01 · `testnet GO (conditional)`, mainnet NO-GO

Checkpoint: [sessions/05.md](sessions/05.md). Decision:
[release/GO_NO_GO.md](release/GO_NO_GO.md). 286 tests across seven suites.

Done: app on the v2 book (deposit, portfolio, withdraw, series,
transparency) and `/terminal` with a typed command palette; `packages/sdk`
(evidence-enveloped reads, unsigned preparation); `tools/vessel-mcp`
(spec read/verify tools, prepare gated); release record with all twelve
gates evaluated.

## Live testnet book — 2026-10-05

Safe batches 01 and 03 (wave 1, tester `0xD802…6206` allowed 1,000 dUSD) are executed.
The v2 keeper runs on Railway. The first live deposit (request #1, 100 dUSD
Ballast) was admitted by the keeper. `/v1/book` at block 68,445,192: Ballast
100 dUSD, reserve 20 dUSD, 102 dUSD in the simulated engine, epoch 52, every
book check PASS. Batch 02 (Hull series 1) is not yet signed.

## Venue integration — 2026-10-05 · `fork-proven`, engine in progress

Decision: [ADR-009](DECISIONS.md#adr-009--one-user-dollar-circle-usdc-vessel-opened-kuru-markets-on-testnet-2026-10-05):
Circle USDC is the only user dollar, AUSD is engine-internal, dUSD is retired at
a fresh deployment, and Vessel opens its own Kuru markets on testnet.

Proven on testnet forks (opt-in `VENUE_FORK=1`, evidence in
[FACT_CHECKS.md](FACT_CHECKS.md#testnet-venues--verified-2026-10-05-chain-reads--fork-proofs)):

- `PerplProof`: a contract owns Perpl account #842, shorts 1,000 MON, closes,
  and withdraws 599.94 / 600 AUSD to a fixed address.
- `KuruProof`: Vessel-opened MON/USDC and MON/AUSD quote both sides;
  USDC→MON→AUSD in one transaction under the floor, 12.7 bps round trip.

Built: `HedgedEngine` (`contracts/src/core/engine/`) replaces
`SimulatedEngine`. It owns the Perpl account, buys spot on Kuru, converts
USDC⇄AUSD atomically, values itself through `PerplMarkValuation` (testnet only,
not independent, G03), and enforces slices, hedge gap, price bands, conversion
floor, stale-price stops and the RISK_INCREASE pause on chain. 31 unit tests;
on a testnet fork the real core on Circle USDC admitted 2,000 USDC, hedged
826.97 MON spot against an 826-lot short in three slices, settled, unwound and
recalled 1,799.16 of 1,800 USDC (0.05% round trip).

Also built 2026-10-05: keeper hedge policy (`vessel-service/src/v2/hedge.ts`,
simulated end to end in tests); recalls capped at engine cash; Circle USDC
support across `DeployV2` (V2_ENGINE=hedged), `vessel-verify` (engine backing,
recomputed value, hedge gap), SDK and app; Safe batch specs `testnet-v2h-01/03`;
scripts to open and quote Vessel's Kuru markets.

Rehearsed 2026-10-06 ([sessions/07.md](sessions/07.md)): `scripts/v2-deploy-hedged.sh --rehearse`
ran markets → quotes → deploy → reserve → Safe batches → a 1,000 USDC deposit
→ the real keeper hedging (705.71 MON spot vs 705-lot short after 150 s) →
`vessel-verify` OVERALL PASS with the new engine checks.

2026-10-08: the testnet Kuru quoter keeps Vessel's books centred on the Perpl
mark (re-centred both books after a +0.6% move in rehearsal); Hull series 1
batch `testnet-v2h-02` rehearsed; switch-day runbook
[release/SWITCH_TO_HEDGED.md](release/SWITCH_TO_HEDGED.md). Seeder
`0x933D…49F9` holds 30,000 AUSD.

2026-10-09 (ADR-010): testnet MON could not be sourced, so the spot leg can
run on vMON, a testnet token quoted at the Perpl mark; the Perpl short stays
real. Rehearsed end to end with `vessel-verify` OVERALL PASS (engine labelled
SIMULATED).

Next: the real deployment once the seeder holds some Circle USDC (AUSD and vMON
are covered), the Safe signers are ready, and an explicit go-ahead.

## Blockers and follow-ups

| Item | Owner | Blocks |
|---|---|---|
| Fund the testnet keeper | Kunal | v0 demo settlement |
| Batches 01 and 03 executed. Next: batch 02 (Hull series 1) on the current book, or fold it into the USDC deployment | Priya / Safe signers | Hull series |
| v2 keeper live on Railway (done). Still to do: `NEXT_PUBLIC_STATS_URL` on Vercel | Priya | app evidence panels |
| Confirm the 2026-08-29 transactions from compromised key `0x4307…` | Kunal | incident record |
| New Safe `0x12B2…2Ee5` signers share one phrase during the build — swap in team-held signers at handover | Priya / team | G07, R07 |
| Evidence OPS.md §0 Railway/Vercel token rotation | Kunal | R05 |
| Split keeper key from the public API process | Daksh | any venue-authority key (S3) |
| Set `VESSEL_ENV=testnet` on Railway before deploying this branch | Kunal | service start |
| Set `VESSEL_API_URL` on Vercel for `/onboarding` | Kunal | sign-in in production |
| Per-file session prompts 01–08 (hashes in `spec/SHA256SUMS.json`) | Kunal | D15 provenance only |
| Test MON (~40k min, ~150k comfortable), test AUSD (~5–10k, from Perpl) and Circle USDC beyond the faucet's 20 / 2 h, to seed the Vessel Kuru markets | Kunal / Priya to request | testnet hedged engine |
| G01–G07, G09–G10 (G01, G02 and G04 have testnet fork evidence; mainnet still open) | see FACT_CHECKS | mainnet beta |

## Resume instruction

Follow [sessions/07.md](sessions/07.md) "Real run": run `scripts/v2-deploy-hedged.sh` for real once its preconditions hold.
