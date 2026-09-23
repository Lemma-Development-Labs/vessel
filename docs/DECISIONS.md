# DECISIONS

The canonical decision register is [docs/spec/VESSEL_V1.md](spec/VESSEL_V1.md)
§3 (D01–D18). This file tracks how the current repository stands against each
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
| D06 | Reserve allocation inside total fee, not extra | **VERIFY IN S2** — v0 charges 10% of positive gross and tops up reserve; whether its identity matches the corrected `ΔH+ΔB+ΔR+FT = G` split needs a Session 2 reading of `Tranches.settle`. |
| D07 | Marked book economics + fee loss carryforward | **GAP** — v0 has no loss carryforward L; a recovery after a loss would be charged a fee again. |
| D08 | One 28-day Hull series, no late entry | **GAP** — v0 Hull is perpetual with open joins; no series states. |
| D09 | Nontransferable beta claims (escrow/burn only) | **GAP** — TrancheToken is a plain ERC-20, freely transferable (TrancheToken.sol; only mint/burn are gated). |
| D10 | Queue shares exposed until USDC funded + segregated | **GAP** — no queues; exits either pay immediately or revert. |
| D11 | 30% junior cover for new risk; 20% floor | **PARTIAL** — v0 enforces only the 20% floor (`THETA_MIN_BPS = 2000`); no 30% admission buffer, no projected full-term coupon cover. |
| D12 | No proxies in V1 core | **ALIGNED** — v0 core has no proxies; economic parameters are `constant`/`immutable`. |
| D13 | Trade key separate from owner/withdrawal rights | **N/A YET** — no venue keys exist; keeper key is gas-only and calls a permissionless `crank()`. Becomes real in Session 3. |
| D14 | Independent review before external beta capital | **OPEN** — no reviewer engaged (G05). |
| D15 | Eight sessions with evidence gates | **IN PROGRESS** — Session 1 running; session prompt files 01–08 not yet in repo (only COMMON.md). |
| D16 | One Vessel identity, one UI and auth system | **PARTIAL** — one app identity exists (app/CLAUDE.md design law); no auth system yet. Frozen design in [AUTH.md](AUTH.md). |
| D17 | No mainnet vUSD deployment | **ALIGNED** — no vUSD/svUSD code exists anywhere in the repo. |
| D18 | Gates decide launch, dates are forecasts | **ADOPTED** — [spec/RELEASE_GATES_TEMPLATE.json](spec/RELEASE_GATES_TEMPLATE.json) imported; all gates NOT_EVALUATED. |

## ADR log

None yet. The first ADR number is ADR-001; template: old rule → replacement →
reason → accounting impact → migration effect → tests → review owner → status.
