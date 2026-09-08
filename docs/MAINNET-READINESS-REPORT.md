# Mainnet / audit readiness report

**Date:** 2026-09-08  
**Stance:** This repo is **not** mainnet-ready and **not** externally audited.  
Companion gates: [`MAINNET-READY.md`](./MAINNET-READY.md) · [`AUDIT-SCOPE.md`](./AUDIT-SCOPE.md)

This file is the **decision + correction** board: what is red, what code now scaffolds, and what only humans/firms can close.

---

## Executive scoreboard

| Gate | Verdict | Notes |
| --- | --- | --- |
| 0 Honesty | 🟢 process | Banners / chips stay pending without hashes |
| 1 Capital safety (code) | 🟡 partial | Caps + oracle + delta-halt **scaffolded**; live venues still sim |
| 2 Ops / keys | 🔴 | Safe is 1-of-1 in practice; no timelock ownership yet |
| 3 Third-party audit | 🔴 | Firm not engaged; agent review ≠ Gate 3 |
| 4 Chain 143 + Sourcify | 🔴 | No Vessel mainnet deploy; skeleton script only |

**Product split (intended):**

| Surface | Chain | Status |
| --- | --- | --- |
| `testnet.vessel.wtf` (this app default) | 10143 | Live DemoUSD + MockRouter + SimVenue |
| Mainnet app build (same codebase, `NEXT_PUBLIC_CHAIN_ID=143`) | 143 | Scaffold only — empty `ADDRESSES.mainnet.json` |

---

## Gate 1 — Capital safety

| Item | Status | Evidence / correction |
| --- | --- | --- |
| Pause = ingress freeze; unwind/exits exempt | 🟢 | `PauseMatrix`, FINDINGS-08-ADDENDUM |
| Keeper no `?? 0` on missing book | 🟢 | keeper policy |
| Invariants ≥ 10k | 🟢 | `VesselInvariant.t.sol` |
| Dead-share economics | 🟢 source **and** live bytecode | `liveAssets()` / `deadPrincipal=100e6` on `0xE1c3…` |
| Deposit caps + progressive soft/hard | 🟡 code | `Tranches.setDepositCap` — **not** set on live 10143 deploy |
| TWAP / oracle (not router mid alone) | 🟡 code | `ISpotOracle`, `ManualTwapOracle`, `RouterMidOracle`; Engine prefers fresh oracle |
| On-chain netDelta halt | 🟡 code | `EngineLite.setNetDeltaHaltBps` + unwind clears latch |
| `vault.asset()` = venue quote (no DemoUSD on mainnet) | 🔴 | Live = DemoUSD; Kuru path needs redeploy + funded Kuru USDC |
| Real Kuru spot + `TX_KURU_SPOT` | 🔴 | Adapter shipped; **on-chain** `bestBidAsk` still empty ask (`0`); Exchange REST depth ≠ this CLOB |
| Real Perpl + `PERPL_KEEPER_ORDER` | 🔴 | Keeper code green; needs API keys + hash; `PerplVenue` still stub (`isSimulated()==true`) |
| Uniswap as primary spot | ⛔ decision | **Do not** — Engine is `IRouter`; Kuru is the spot venue. Uniswap/Puddle only optional stranger on-ramp to quote |

### Decisions required (Gate 1)

1. **Quote stable (mainnet):** USDC (`0x7547…`) vs AUSD (`0x0000…eFE3…`). Perpl collateral today drifts toward AUSD on testnet — pick one story or document an explicit bridge.
2. **Testnet cutover:** Keep DemoUSD stack for strangers **or** redeploy `SPOT_ROUTER=kuru` once CLOB asks are non-zero **and** a Kuru-USDC faucet/path exists.
3. **Oracle policy:** Accept `ManualTwapOracle` (keeper/CRE push) for early mainnet vs wait for native Monad TWAP/Chainlink. Cap remains either way.
4. **Genesis deposit cap:** Concrete hard/soft numbers (e.g. $100k / $80k) before Gate 4 broadcast.

---

## Gate 2 — Ops / keys

| Item | Status | Correction |
| --- | --- | --- |
| Independent 2-of-3 Safe | 🔴 | Publish **distinct** signer identities; current Safe keys co-located |
| Timelock on ownership / params | 🟡 code | `script/DeployTimelock.s.sol` — must own Guardian after review |
| Keeper / CRE DON | 🟡 | Simulate path only; EA DON not claimed |
| Hosted Envio | 🔴 | GraphQL env unset |
| Dune dashboard | 🟡 | SQL shipped; publish + env |
| Monitoring / runbook | 🔴 partial | `/health` exists; paging + pause policy incomplete |

### Decisions required (Gate 2)

1. Name the three Safe signers (org roles, not emails in-repo).
2. Timelock `minDelay` (default script = 2 days) — confirm.
3. Who may `ManualTwapOracle.pushPrice` (EOA vs CRE vs Safe).

---

## Gate 3 — External audit

| Item | Status |
| --- | --- |
| Scope brief | 🟢 `AUDIT-SCOPE.md` |
| Firm engaged / draft report | 🔴 |
| High/Critical closed | 🔴 |
| Public report URL | 🔴 — **only then** drop “unaudited” |

**Agent / Slither / FINDINGS-08 are not Gate 3.** Do not green this row without a PDF/URL from a named firm.

### Decisions required (Gate 3)

1. Engage firm (budget, timeline, freeze commit hash).
2. Confirm out-of-scope venues (Kuru/Perpl internals) stay out.

---

## Gate 4 — Mainnet deploy (chain 143)

| Item | Status |
| --- | --- |
| Addresses + Sourcify | 🔴 empty mainnet column |
| Quote ≠ DemoUSD | 🔴 enforced in `DeployMainnetSkeleton` |
| Remove faucet from product path | 🔴 app still DemoUSD faucet on 10143 |
| E2E deposit→deploy→crank→unwind→withdraw | 🔴 |
| Legal review (vUSD / public AUM) | 🔴 |

Skeleton: `contracts/script/DeployMainnetSkeleton.s.sol`  
Requires `MAINNET_CONFIRM=I_UNDERSTAND_UNAIDITED`, real quote, Kuru mainnet book addresses, `DEPOSIT_CAP_ASSETS>0`.

### Decisions required (Gate 4)

1. Mainnet Kuru orderbook + margin addresses (when published).
2. Whether short stays SimVenue on day-1 mainnet (honest `isSimulated`) or waits for live PerplVenue.
3. Domain: `app.vessel.wtf` vs separate mainnet hostname; WC metadata string.

---

## Real venue integration — current vs needed

### Kuru (spot)

| Layer | State |
| --- | --- |
| `KuruRouter.sol` + fork tests | 🟢 |
| Live Engine router | 🔴 MockRouter |
| On-chain book asks @ `0xa241…` | 🔴 `bestAsk=0` (REST `MON_USDC` depth is a **different** surface — do not treat as fill proof) |
| `TX_KURU_SPOT` hash | 🔴 needs funded PK + non-empty CLOB |

### Perpl (short)

| Layer | State |
| --- | --- |
| Keeper (`keeper/`) | 🟢 unit tests; needs `PERPL_API_KEY` |
| On-chain `PerplVenue` | 🔴 stub |
| Collateral vs vault asset | 🔴 GATE-0 drift (AUSD vs vault quote) |

### Uniswap

| Decision | **Out as Engine spot.** Optional UX helper to buy quote via Kuru Flow / Puddle — never claim “Uniswap integrated” for the vault path. |

---

## What this PR / branch ships (code)

- Deposit caps (soft/hard) on `Tranches`
- `ISpotOracle` + `ManualTwapOracle` + `RouterMidOracle`; Engine mark prefers fresh oracle
- On-chain `netDeltaHaltBps` latch (unwind clears)
- `DeployTimelock.s.sol`, `DeployMainnetSkeleton.s.sol`
- Dual-network app config + `ADDRESSES.mainnet.json` placeholder
- This report

**Does not ship:** live Kuru fill, Perpl order hash, audit PDF, chain-143 addresses, flipped honesty chips.

---

## Correction backlog (ordered)

1. Decide quote stable + genesis cap (human).
2. When CLOB asks > 0: redeploy testnet `SPOT_ROUTER=kuru`, land `TX_KURU_SPOT`, update `ADDRESSES.json` + chips.
3. Enroll Perpl keys → `PERPL_KEEPER_ORDER`; design real `PerplVenue` or accept off-chain short + disclose.
4. Transfer Guardian → Timelock → independent Safe.
5. Engage audit (Gate 3).
6. Mainnet broadcast only after 1–5 + Sourcify.
