# INVENTORY

Phase 1.1 repository reconciliation (Session 1). Classifies every existing
module against the v2 decisions (D01–D18, D30) as **KEEP / FIX / REPLACE /
MISSING**, with evidence, and maps current modules onto the target tree.

- Checked **2026-09-30** on branch `p-development` at the merge of
  `origin/harden/p0-testnet` into `main` (`34cf9d2`; `main` = `c4c1818`).
- All 15 remote branches were fetched and inspected; code on unmerged branches
  is classified separately below and is **not** part of the deployed system.
- Toolchain: Foundry **1.8.3** (matches CI pin), pnpm 10.33.3 (app, per
  `packageManager`), Node 24.14.0 (CI uses 20).
- Classifications describe fitness for the **v2 product**. The v0 testnet
  demo remains live and keeps working until retired; KEEP/FIX/REPLACE says
  what V1 builds on, not what gets deleted now.

## 1. Test counts — what actually reproduces

| Suite | Command | Result | Claimed elsewhere |
|---|---|---|---|
| Contracts (default profile, 10k fuzz) | `cd contracts && forge test` | **100 passed, 0 failed, 1 skipped** (21 suites), exit 0, 1m49s | README "100 tests" ✅ · HARDENING "81" ❌ stale · company pack "99" ❌ stale |
| Contracts (CI profile) | `FOUNDRY_PROFILE=ci forge test --fuzz-runs 25000` | **100 passed, 1 skipped**, exit 0; 5 fuzz tests at 25,000 runs | CI config ✅ |
| Skipped test | `test/fork/ForkAccounting.t.sol` | skips by design unless `ADDRESSES.json` has code on a fork | — |
| App | `cd app && pnpm test` · `pnpm lint` | **40 passed** (3 files), exit 0 · lint exit 0 | README "37 tests" ❌ stale |
| Domain schemas | `cd packages/domain && pnpm test && pnpm typecheck` | **15 passed** (3 files), typecheck exit 0 | sessions/01 "15 tests" ✅ |
| Branch `cursor/perpl-venue-bf3b` contracts | `forge test` (worktree) | **116 passed, 2 skipped**, exit 0 | — |
| Branch `cursor/mainnet-gates-bf3b` contracts | `forge test` (worktree) | **112 passed, 0 failed, 6 skipped** (25 suites), exit 0; one invariant suite alone took 363 s | — |
| Branch `cursor/mainnet-gates-bf3b` keeper | `cd keeper && pnpm test` | **27 passed** (7 files), exit 0 | — |

Not run: `forge coverage`, Slither, `pnpm build` (app), vessel-service (no
test suite exists), app Playwright (no suite exists), fork tests against live
state. Raw outputs are kept with the session evidence
(`docs/evidence/phase1/`).

## 2. Branch register

Every remote branch, relative to `main` (`c4c1818`). All `cursor/*` branches
fork from `c4c1818`; none is merged; none has deployed or traded on a real
venue — every `TX_KURU_SPOT` / `TX_PERPL_SHORT` / `PERPL_ACCOUNT_ID` entry on
them is still `<pending>`.

| Branch | Date | Ahead | Content | Disposition |
|---|---|---|---|---|
| `harden/p0-testnet` | 09-26 | 9 | Session 1 start (spec import, FACT_CHECKS, DECISIONS, `packages/domain`), Safe-owned deployment manifest, service hardening | **Merged** into `p-development` (`34cf9d2`) |
| `cursor/kuru-quote-token-test-bf3b` | 09-03 | 3 | Kuru quote-token invariant test, docs status generator | Harvest test into KuruAdapter work (S3) |
| `cursor/kuru-spot-router-bf3b` | 09-07 | 6 | `KuruRouter` (IRouter over Kuru CLOB, FoK), depth probe | Harvest → `KuruAdapter` (S3) |
| `cursor/perpl-keeper-bf3b` | 09-06 | 7 | Perpl short-manager keeper (Ed25519 auth, WS, policy, reconcile) | Harvest client → `services/keeper` (S3) |
| `cursor/transparency-bf3b` | 09-06 | 9 | Perpl risk page, `Live<T>`, cast-verify sandbox | Harvest UI patterns (S4/S5) |
| `cursor/envio-hyperindex-bf3b` | 09-07 | 11 | Envio HyperIndex scaffold over v0 events | Harvest → `indexer/` (S4) |
| `cursor/cre-workflow-bf3b` | 09-07 | 12 | Chainlink CRE workflow over `policy.decide()` | Out of v2 scope — ADR needed before use |
| `cursor/audit-testnet-ui-bf3b` | 09-07 | 13 | Hostile findings, invariant handler, testnet honesty UX | Harvest invariant handler + findings (S2/S7) |
| `cursor/mainnet-ready-bf3b` | 09-07 | 14 | Pause egress hatch, mainnet/audit readiness docs | Reference only; superseded by release gates |
| `cursor/dune-analytics-bf3b` | 09-08 | 15 | Dune SQL, `/analytics` page | Out of v2 scope |
| `cursor/mainnet-gates-bf3b` | 09-08 | 17 | Superset of the chain above + oracles, deposit caps, netDelta halt, dual-network app, mainnet skeleton deploy | Mixed — see §3.3 |
| `cursor/hull-series-gate-bf3b` | 09-07 | 13 | Series-001 fail-closed gate script + docs | KEEP the gate *principle*; product superseded by `HullSeries` |
| `cursor/perpl-venue-bf3b` | 09-06 | 7 | `PerplPositionReader`, intent-only `PerplVenue`, mock exchange, fork test | Reader: harvest. Venue: REPLACE (custody model) |
| `cursor/vessel-delta-neutral-vault-1a23` | 08-29 | 0 | Fully merged historical branch | None |

The linear chain is `kuru-quote-token-test → kuru-spot-router → perpl-keeper →
transparency → envio → cre → audit-testnet-ui → mainnet-ready → dune →
mainnet-gates`; `hull-series-gate` forks from `transparency`, `perpl-venue`
from `kuru-quote-token-test`.

## 3. Module classification

### 3.1 Contracts on `p-development`

| Module | Verdict | Evidence / reason | V1 destination |
|---|---|---|---|
| `Tranches.sol` | **REPLACE** | Waterfall contradicts §7 on all 8 golden vectors: reserve takes flat `fee/2` (not capped at deficit), Hull earns coupon only from positive yield (not a contractual C funded by Ballast), no loss carryforward L, reverts `HullImpairment` instead of impairing Hull. Sync join/exit (D04), open-ended Hull (D08), 20% floor only (D11). Worked comparison in sessions/01. | `core/TrancheController` + `libraries/Waterfall`, `Coupon`, `Coverage` |
| `BlitzVault.sol` | **REPLACE** | ERC-4626 pooled share with public `withdraw`/`redeem` (D03, D04). Dead-share live-supply accounting is sound and tested (`Solvency.t.sol`). | `core/AssetCustody`; port the virtual-offset + non-earning seed idea into `BallastToken` |
| `TrancheToken.sol` | **REPLACE** | Plain transferable ERC-20 (D09). | `core/HullSeries`, `core/BallastToken` |
| `EngineLite.sol` | **REPLACE** | One-shot atomic `deployLiquidity`, spot marked at router mid (±5% cap), keeper-free permissionless crank that *is* the NAV source. §6/§12 forbid a lone manipulable venue price and require async paired slices. | `risk/EngineManager` + `risk/ValuationAdapter` + keeper |
| `guards/Guardian.sol` | **FIX** | Pause-only ✅, Ownable2Step ✅; but single global flag (needs 4 dimensions) and owner **can unpause** (§20: guardian cannot resume). | `core/Governance/Guardian` + timelock-owned resume |
| `DemoUSD.sol` | **KEEP (lab/test)** | Faucet 100/h, 1,000 lifetime, no admin mint. Testnet-only by nature. | `contracts/lab` or test fixtures; mainnet manifest must reject |
| `venues/SimVenue.sol` | **KEEP (test only)** | `isSimulated()==true`; owner can set rate ±100%. Useful deterministic venue for local lifecycle tests (S2). | test fixtures behind mainnet-selection barrier |
| `mocks/MockRouter.sol`, `MockWMON.sol` | **KEEP (test only)** | 1:1 mock; live on testnet as the spot leg today. | test fixtures |
| `venues/PerplVenue.stub.sol` | **REPLACE** | Every mutative call reverts `NotImplemented` — a stub in a money path. | `venues/PerplAccountAdapter` (G01) |
| `interfaces/IVenue.sol` | **FIX** | Useful seam, but models venue as synchronous `openShort/closeShort/sweepFunding`; v2 execution is async, off-chain signed. | `venues/` read interfaces |
| `interfaces/IUniswapV2Router02.sol` | **REPLACE** | v2 spot venue is Kuru, not a UniV2 router. | `venues/KuruAdapter` |
| `lib/Decimals.sol` | **KEEP** | Small helper; re-review under 18-dec USD normalization. | `core/libraries` |
| `script/Deploy.s.sol`, `Seed.s.sol`, `SetRate.s.sol` | **FIX → REPLACE** | v0 deploy path; v2 needs manifest-driven deploy with zero admission and lab exclusion. | `scripts/` deploy + rehearse |
| `test/**` (100 tests) | **KEEP the discipline, rewrite the targets** | Reentrancy, inflation, pause-matrix, rounding, conservation and solvency fuzz patterns carry over; assertions target v0 semantics. | `contracts/test/{unit,invariant,fuzz,fork,differential}` |

### 3.2 Services, app, scripts, docs on `p-development`

| Module | Verdict | Evidence / reason | V1 destination |
|---|---|---|---|
| `packages/domain` | **KEEP** | Evidence envelope, six tags (UNAVAILABLE structurally valueless), BigInt units, golden-vector schema; 15 tests green. Holds **5** vectors — must grow to the **8** in `reference_model.py`. | `packages/domain` (+ `packages/math`) |
| `app/` (Next.js 16, wagmi, `Live<T>` Rule 0, design law) | **KEEP + FIX** | Rule 0 and design tokens are the v2 foundation (§12, §15). Screens encode v0 flows (sync join/exit); no auth, no series, no queue. 40 tests green. | `apps/web` (move deferred — ARCHITECTURE decision 1) |
| `vessel-service/src/api.ts` | **FIX** | Fastify, rate limits, `/live` `/health` `/stats` `/waterfall`. Needs `/v1/*` envelope (`schemaVersion`, `blockHash`, units), SIWE (AUTH.md), error taxonomy. | `services/api` |
| `vessel-service/src/indexer.ts`, `db.ts` | **FIX** | Resumable cursor, confirmations, `(tx_hash, log_index)` keys. §12 needs `(chainId, blockHash, txHash, logIndex)` + finalized/reverted status. | `indexer/` (Envio evaluated in S4 per ARCHITECTURE decision 5) |
| `vessel-service/src/keeper.ts` | **KEEP (v0 only)** | Crank-only, gas-limit budgeting (Monad bills the limit), stuck-tx handling. Shares a process with the public API (ARCHITECTURE decision 4 — violation accepted only while the key is gas-only). | v0 retirement; v2 keeper is new (`services/keeper`) |
| `scripts/sync.mjs` | **FIX** | ABI + address generation from `ADDRESSES.json`. v2 generates from a release manifest. | `scripts/` manifest generator |
| `scripts/verify-manifest.mjs` | **KEEP** | Per-contract verification state; refuses to inherit badges across redeploys. Currently all `unknown` for the live deployment. | release manifest pipeline |
| `scripts/check-secrets.mjs` (+ self-test) | **KEEP** | CI secret scan with planted-key self-test. | unchanged |
| `scripts/check-sizes.mjs`, `coverage-gate.mjs` | **KEEP** | CI gates. | unchanged |
| `scripts/e2e.ts`, `scripts/keeper.ts` | **REPLACE** | v0 lifecycle scripts. | S2 local lifecycle + S3 keeper |
| `.github/workflows/ci.yml` | **KEEP + FIX** | fmt, 25k fuzz, snapshot, sizes, coverage ≥95%, Slither, app test/lint/build, secrets. Needs: differential job, schema/forbidden-import checks, domain tests. | `.github/workflows/` |
| `ADDRESSES.json` | **FIX** | Testnet v0 manifest (block 57923009, Safe `0xe4f2…0279`). Lacks bytecode hashes, roles, compiler settings, commit. | `deployments/` release manifest |
| `README.md`, `FACTS.md`, `docs/security/powers.md`, `HARDENING.md` | **FIX** | Describe the superseded deployment (`0xdb46…`, Safe `0x85Fe…`); test counts stale (§1). README advertises ERC-4626. | update in the S1 docs commit |
| `OPS.md`, `SECURITY.md` | **KEEP + FIX** | Candid runbooks and disclosure; §0 token-rotation evidence still open. | `docs/runbooks/`, `docs/SECURITY.md` |
| `docs/spec/`, `DECISIONS`, `FACT_CHECKS`, `ARCHITECTURE`, `AUTH`, `TEST_PLAN`, `BUILD_STATUS`, `sessions/01` | **KEEP + FIX** | Session 1 work from `harden/p0-testnet`. Missing: D30 (Handbook v4), G09/G10, this inventory, branch assets (G08 wrongly CLOSED — see §5). | `docs/` |
| `.agents/skills/*` (Monad skills) | **KEEP** | Agent reference material, not product code. | unchanged |

### 3.3 Assets on unmerged branches

| Asset (branch) | Verdict | Evidence / reason |
|---|---|---|
| `PerplPositionReader.sol` (perpl-venue) | **KEEP → harvest** | Reads position/margin from the Exchange and reverts `FieldNotOnChain` instead of fabricating zero; testnet market 64 `priceDecimals=5`, `lotDecimals=0` recorded. Testnet-only facts — must not become mainnet defaults (gotcha 5). |
| `PerplVenue.sol` intent-only (perpl-venue) | **REPLACE** | Its own NatSpec: *"Keeper EOA owns the Perpl account. Vessel does not custody venue margin on-chain."* That is the founder-EOA custody model D13 / G01 / §11 forbid for external capital. |
| `KuruRouter.sol` (kuru-spot-router) | **KEEP → harvest** | FoK market orders, native MON wrap/unwrap, caller-supplied `minOut`. Needs oracle-reference slippage (≤30 bps), pinned market, mainnet semantics recheck (G02). Branch recheck found testnet MON-USDC `bestAsk = 0` at block 60533271. |
| `keeper/` Perpl short-manager (perpl-keeper → mainnet-gates) | **FIX → harvest** | Fact-checked Ed25519 REST/WS auth, rate limits, close-code recovery, pure `policy.decide()`, reconcile; 27 tests green. **Missing** journal, outbox, fencing, signer isolation; `KEEPER_PK` and `PERPL_API_KEY_SECRET` in one process env (§11). |
| `oracles/ManualTwapOracle.sol` (mainnet-gates) | **REPLACE** | Open `pushPrice` by keeper/CRE — a keeper-supplied mark, contrary to "ValuationAdapter … no arbitrary keeper NAV" (§6, §12, G03). |
| `oracles/RouterMidOracle.sol` (mainnet-gates) | **REPLACE** | Router mid as price — the manipulable single-venue mark §12 forbids as solvency truth. |
| `Tranches.setDepositCap` (mainnet-gates) | **REPLACE** | Deposit cap in v0 Tranches; v2 lifetime-contribution budgets live in `BetaAdmission` across all entry paths. |
| `EngineLite.setNetDeltaHaltBps` (mainnet-gates) | **Superseded** | Idea maps to EngineManager critical-delta halt; contract itself is REPLACE. |
| `VesselInvariant.t.sol` handler (audit-testnet-ui) | **KEEP → harvest** | Invariant-handler structure reusable for v2 lifecycle invariants (S2). |
| `indexer/` Envio HyperIndex (envio-hyperindex) | **FIX → harvest** | Scaffold over v0 ABIs; must adopt full event identity + finalized/reverted tracking (§12). |
| `app/lib/{disagree,sandbox,cast-verify,keeper-health,envio-tape,networks}.ts` (transparency → mainnet-gates) | **KEEP → harvest** | RPC-disagreement detection, `cast` verification recipes, dual-network config — directly relevant to S4 verifier and S5 transparency. |
| `script/assertSeries001Gate.ts` (hull-series-gate) | **KEEP principle** | Fail-closed gate that exits 1 until real venue hashes exist — same shape as the S8 gate evaluator. |
| `DeployMainnetSkeleton.s.sol` (mainnet-gates) | **REPLACE** | v0 skeleton; v2 mainnet deploy is manifest-driven with zero admission. |
| CRE workflow, Dune analytics | **Out of scope** | Not in the v2 blueprint; would need an ADR. |

### 3.4 Items the master prompt names explicitly

| Item | Finding |
|---|---|
| Current Perpl account owner | **None on-chain for Vessel.** Live `PerplVenue` at `0x59fc…aD6C` is the stub. The perpl-venue branch design assigns ownership to a keeper EOA; `PERPL_ACCOUNT_ID` is `<pending>`. → G01 remains BLOCKED. |
| Keeper clients | v0 crank keeper in `vessel-service` (live, gas-only key) and `scripts/keeper.ts`; branch Perpl keeper (never posted an authenticated order). |
| Landing assets | Separate repo `vessel-landing` (not inspected here). Handbook v4 G4 (inspected 2026-09-29): decorative counters from `v2.js` without a chain feed, static APRs, 90-day Hull term, ERC-4626 claim, dated mainnet vUSD promise → **FIX** in that repo (gotcha 25). |

## 4. Migration map — current → target tree

No workspace restructure in Session 1 (ARCHITECTURE decision 1: `app/` and
`vessel-service/` deploy standalone to Vercel/Railway with their own
lockfiles). Moves happen when their pipelines are re-tested; new code lands
directly in target paths.

| Current | Target | When |
|---|---|---|
| `contracts/src/{Tranches,BlitzVault,TrancheToken,EngineLite}.sol` | retired v0; replaced by `contracts/core/*`, `risk/*` | S2 (core), S3 (engine) |
| `contracts/src/guards/Guardian.sol` | `contracts/core/Governance/` | S2 |
| `contracts/src/{DemoUSD,venues/SimVenue,mocks/*}.sol` | test fixtures / `contracts/lab` behind mainnet barrier | S2 |
| `contracts/src/venues/PerplVenue.stub.sol` + branch reader | `contracts/venues/PerplAccountAdapter.sol` (+ reader) | S3 |
| branch `KuruRouter.sol` | `contracts/venues/KuruAdapter.sol` | S3 |
| — | `contracts/venues/CollateralAdapter.sol`, `risk/ValuationAdapter.sol`, `routes/InboundFundingAdapter.sol` | S3, S3, S6 |
| `packages/domain` | `packages/domain` (+ new `packages/config`, `packages/math`, `risk-policy`, `sdk`, `ui`) | S1 → S2 |
| `app/` | `apps/web` | when Vercel pipeline re-tested |
| `vessel-service/` (api + indexer + crank) | `services/api`; indexer → `indexer/`; crank → retired with v0 | S1 (auth), S4 |
| branch `keeper/` | `services/keeper` + new `services/signer` | S3 |
| — | `services/sentinel`, `services/mcp`, `tools/verify-cli` | S7, S6, S4 |
| `ADDRESSES.json` + `scripts/sync.mjs` | `deployments/<env>.json` release manifest + generator | S1 schema, S8 full |
| `README`/`FACTS`/`HARDENING`/`OPS` | kept; `docs/ADDRESSES.md` generated; runbooks → `docs/runbooks/` | S1 drift fix, S7 |

## 5. Findings that change existing records

1. **G08 was closed prematurely.** `FACT_CHECKS.md` marks G08 CLOSED on
   2026-09-23 without the 13 `cursor/*` branches, which hold the only Kuru,
   Perpl, oracle, cap and Envio code in the project. Reopened with this
   inventory as its evidence.
2. **A branch design contradicts D13.** The perpl-venue branch's custody model
   (keeper EOA owns the Perpl account) must not be merged as the v2 venue.
3. **Test-count drift:** HARDENING (81), app README (37), company pack (99)
   are stale; reproduced numbers are in §1.
4. **Handbook v4 D30** (inbound supported-chain funding, 2026-09-30) is not yet
   in `DECISIONS.md`; G09/G10 route gates do not exist yet.
