# DECISIONS

The canonical decision register is [docs/spec/VESSEL_V1.md](spec/VESSEL_V1.md)
§3 (D01–D18), plus **D30** from [HANDBOOK_v4.md](HANDBOOK_v4.md) (30 Sep 2026),
which supersedes the blueprint only for inbound supported-chain funding.
This file tracks how the current repository stands against each
decision, and records ADRs. An implementation change to any decision requires
an ADR here stating: old rule, replacement, reason, accounting impact,
migration effect, tests, review owner. An ADR cannot make an unsupported venue
capability true.

## Repository status against D01–D18 (checked 2026-09-23)

"v0" is the deployed testnet system (dUSD / BlitzVault / EngineLite /
SimVenue). Evidence: source inspection this session and the chain reads in
[FACT_CHECKS.md](FACT_CHECKS.md).

| ID | Decision (short) | Repo status |
|---|---|---|
| D01 | One chain, MON market, USDC deposits | **GAP** — v0 deposit asset is DemoUSD (valueless faucet token). USDC verified on mainnet (6 dec) but unused. |
| D02 | Explicit USDC→AUSD collateral route | **GAP** — no AUSD code anywhere. AUSD verified on mainnet (6 dec). |
| D03 | No publicly redeemable pooled vault share | **PARTIAL** — vBLITZ exists; `deposit`/`mint` are Tranches-only, but `withdraw`/`redeem` are public to share holders (BlitzVault.sol:238-256). Only Tranches and the dead-share address hold shares today. v2 requires no external fungible custody share at all. |
| D04 | Custom asynchronous request/claim interfaces | **GAP** — v0 join/exit are synchronous; no request queue, no claim escrow. |
| D05 | Loss order Ballast → Reserve → Hull | **PARTIAL** — v0 does Ballast then Reserve, then **reverts** `HullImpairment()` (Tranches.sol:217) instead of impairing Hull into a wind-down state. |
| D06 | Reserve allocation inside total fee, not extra | **PARTIAL** (read 2026-09-30) — v0 already books only the treasury share (`fee − toReserve`) beside ΔR, so it does not double count; but its reserve share is a flat `fee/2`, not capped at the pre-settlement deficit. On golden vector `positive` v0 yields R 205 / FT 5 where the spec requires 204 / 6 ([INVENTORY.md](INVENTORY.md) §3.1). |
| D07 | Marked book economics + fee loss carryforward | **GAP** — v0 has no loss carryforward L; a recovery after a loss would be charged a fee again. |
| D08 | One 28-day Hull series, no late entry | **GAP** — v0 Hull is perpetual with open joins; no series states. |
| D09 | Nontransferable beta claims (escrow/burn only) | **GAP** — TrancheToken is a plain ERC-20, freely transferable (TrancheToken.sol; only mint/burn are gated). |
| D10 | Queue shares exposed until USDC funded + segregated | **GAP** — no queues; exits either pay immediately or revert. |
| D11 | 30% junior cover for new risk; 20% floor | **PARTIAL** — v0 enforces only the 20% floor (`THETA_MIN_BPS = 2000`); no 30% admission buffer, no projected full-term coupon cover. |
| D12 | No proxies in V1 core | **ALIGNED** — v0 core has no proxies; economic parameters are `constant`/`immutable`. |
| D13 | Trade key separate from owner/withdrawal rights | **N/A YET** — no venue keys exist; keeper key is gas-only and calls a permissionless `crank()`. Becomes real in Session 3. |
| D14 | Independent review before external beta capital | **OPEN** — no reviewer engaged (G05). |
| D15 | Eight sessions with evidence gates | **IN PROGRESS** — Session 1 running. COMMON.md matches its recorded hash; the eight prompts are imported in their baseline-embedded edition ([spec/prompts/SESSIONS_BASELINE_EDITION.md](spec/prompts/SESSIONS_BASELINE_EDITION.md)), which does not reproduce the per-file hashes. |
| D16 | One Vessel identity, one UI and auth system | **PARTIAL** — one app identity exists (app/CLAUDE.md design law); no auth system yet. Frozen design in [AUTH.md](AUTH.md). |
| D17 | No mainnet vUSD deployment | **ALIGNED** — no vUSD/svUSD code exists anywhere in the repo. |
| D18 | Gates decide launch, dates are forecasts | **ADOPTED** — [spec/RELEASE_GATES_TEMPLATE.json](spec/RELEASE_GATES_TEMPLATE.json) imported; all gates NOT_EVALUATED. |
| D30 | Inbound supported-chain funding in the V1 build; per-route activation after gates; outbound cross-chain, remote claim tokens and bridged Hull/Ballast stay out | **GAP** — no route, adapter or arrival-escrow code exists; no provider qualified (Epoch is a candidate only, HANDBOOK_v4 ch. 6). Route gates G09/G10 added in [FACT_CHECKS.md](FACT_CHECKS.md). |

### Identifier namespaces

Two private support-pack templates reuse these prefixes with different
meanings. In this repository: **D01–D18, D30** are decisions (this file);
**G01–G10** are external dependencies and route gates (FACT_CHECKS.md);
**R01–R12** are release gates (spec §24). The support pack's unresolved
parameter list (its "D01–D10") is tracked here as **P01–P10** when imported,
and its release checklist "G01–G11" maps onto R01–R12 + G09/G10.

## ADR log

Template: old rule → replacement → reason → accounting impact → migration
effect → tests → review owner → status. ADR-001…006 record the v0 rules that
the v2 decisions replace, as Phase 1.2 requires; they do not change any
decision. Review owners are **proposed** (spec §25) and unconfirmed by the
people named.

### ADR-001 — Remove the public pooled vault share (D03)

- **Old rule:** `BlitzVault` is an ERC-4626 vault issuing vBLITZ; `deposit`/`mint` are Tranches-only, but `withdraw`/`redeem` are public to any share holder.
- **Replacement:** `AssetCustody` holds assets with no external fungible share. Hull and Ballast are the only investor claims.
- **Reason:** a pooled share is a third claim that can bypass the Hull/Ballast priority (spec D03, §6).
- **Accounting impact:** active assets `A` are owned only by H, B and R; no share price exists outside the tranches.
- **Migration effect:** new deployment. v0 holders exit through v0 `exitHull`/`exitBallast`; no share migration.
- **Tests:** `no_pooled_share_escape` invariant; no public entry point transfers custody assets except claim/escrow paths (S2).
- **Review owner:** Daksh · **Status:** accepted by spec; implementation S2.

### ADR-002 — Asynchronous requests and claims (D04, D10)

- **Old rule:** `joinHull`/`joinBallast`/`exitHull`/`exitBallast` settle synchronously at current NAV.
- **Replacement:** `requestDeposit` → batch admission; `requestBallastRedeem` → 48 h cooldown → batch funding into `ClaimEscrow` → `claim`. Custom interfaces; no ERC-4626/7540 compliance claimed.
- **Reason:** forward pricing after settlement, segregated funded claims, and exits bounded by real liquidity (spec §8–§9).
- **Accounting impact:** pending deposits and funded claims sit outside `A`; `G` counts an outflow once, at funding.
- **Migration effect:** new contracts and new app flows; README and app must stop describing ERC-4626.
- **Tests:** forward-price-after-loss, partial-fill-burns-only-funded, min-output-does-not-block-queue (S2).
- **Review owner:** Daksh · **Status:** accepted by spec; implementation S2.

### ADR-003 — Fee / reserve identity (D06, D07)

- **Old rule:** fee = ceil(10% × positive G) every epoch; reserve takes a flat `fee/2` while below target; no loss carryforward; Hull coupon paid only out of positive remainder; loss beyond Ballast + reserve reverts `HullImpairment`.
- **Replacement:** eligible gain `max(G − L, 0)`; `F = 10%` of it; `FR = min(F/2, pre-settlement deficit)`; `FT = F − FR`; contractual coupon C accrues regardless of G; shortfall hits B, then R (incl. FR), then H; if Hull would be impaired, recompute the whole epoch fee-free. Conservation `ΔH + ΔB + ΔR + FT = G`.
- **Reason:** spec §7; avoids fees on loss recovery and double counting reserve replenishment.
- **Accounting impact:** v0 disagrees with all eight golden vectors in `reference/reference_model.py`.
- **Migration effect:** new `Waterfall` library; v0 `Tranches.settle` retired with v0.
- **Tests:** golden vectors across Python, TypeScript and Solidity; ≥5,000-case seeded differential; `conservation_uses_FT_not_F` (S2).
- **Review owner:** Kunal (economics) + Daksh · **Status:** accepted by spec; implementation S2.

### ADR-004 — Collateral split: USDC deposits, AUSD perp margin (D01, D02)

- **Old rule:** single asset (DemoUSD) for deposits, spot purchase and simulated venue margin.
- **Replacement:** USDC is the deposit asset; Perpl margin is AUSD reached through a bounded USDC→AUSD route that is atomic under an aggregate output floor, or the route is blocked. USDC and AUSD are valued at measured FX, never assumed to be $1.
- **Reason:** Perpl mainnet collateral differs from the vault asset (spec D02, §4).
- **Accounting impact:** conversion is internal (not a flow in `G`); FX changes enter `G` once.
- **Migration effect:** `CollateralAdapter` (S3); DemoUSD confined to lab/test fixtures.
- **Tests:** `collateral_route_refused_beyond_floor`; FX divergence halts (S3).
- **Review owner:** Daksh · **Status:** accepted by spec; blocked on G04.

### ADR-005 — Beta claim transfer restrictions (D09)

- **Old rule:** `TrancheToken` (HULL/BAL) is a freely transferable ERC-20; only mint/burn are gated.
- **Replacement:** Hull and Ballast units move only by mint, controller escrow and burn during the beta.
- **Reason:** enforce invite and per-participant limits; prevent transfer-and-redeposit quota recycling (spec §8, §19).
- **Accounting impact:** none on NAV; admission quotas become enforceable.
- **Migration effect:** new token contracts; app must state there is no secondary market in the beta.
- **Tests:** `quota_recycling_via_transfer_blocked` (S2).
- **Review owner:** Daksh · **Status:** accepted by spec; implementation S2.

### ADR-006 — Inbound supported-chain funding scope (D30)

- **Old rule:** blueprint §2 excludes all cross-chain capital movement from V1.
- **Replacement:** inbound funding is built in V1: approved source assets arrive as USDC on Monad and enter the same asynchronous subscription path and the same `BetaAdmission` ledger. Each route activates only after its own gates (G09/G10) and a team canary inside the existing budget. Outbound cross-chain, remote claim tokens and bridged Hull/Ballast tokens remain out.
- **Reason:** founder decision of 30 Sep 2026 recorded in Handbook v4 ch. 6.
- **Accounting impact:** funds in source wallets, provider locks, arrival escrow or pending subscriptions are outside `A` and earn nothing; routing cost reduces delivered principal and is neither strategy loss nor revenue.
- **Migration effect:** new `InboundFundingAdapter` (S6); route records in the release manifest.
- **Tests:** `solver_cannot_become_beneficiary`, `adapter_uses_observed_amount_not_balance`, `inbound_shares_global_cap_with_native`, `late_arrival_refundable` (S6).
- **Review owner:** Kunal (scope) + Daksh · **Status:** accepted; implementation S6; activation gated.

### ADR-007 — Target repository tree vs frozen layout (conflict log)

- **Old rule:** [ARCHITECTURE.md](ARCHITECTURE.md) decision 1 (2026-09-23) — no root workspace restructure; `app/` and `vessel-service/` stay standalone.
- **Replacement:** none yet. The 2026-09-30 master build prompt describes a target tree (`apps/web`, `services/*`, `packages/*`, root `pnpm-workspace.yaml`) and also says "do not erase working code to match the tree".
- **Resolution:** the frozen decision stands. New code lands directly in target paths (`packages/config`, `reference/`, later `contracts/core` etc.); `app/` → `apps/web` and `vessel-service/` → `services/api` move only when their Vercel/Railway pipelines are re-tested. Migration map: [INVENTORY.md](INVENTORY.md) §4.
- **Review owner:** Kunal · **Status:** recorded conflict; revisit before S5.
