# Mainnet readiness — hard gates (not a marketing checklist)

**This repository is not mainnet-ready today.** Saying otherwise would be the
exact false-claim class Prompt 08 forbids. This document is the **gate**: every
box must be green before any mainnet deposit is accepted, and until then the
product banner stays **TESTNET · unaudited** (or MAINNET TARGET · not deployed).

Full decision board + correction backlog:
[`MAINNET-READINESS-REPORT.md`](./MAINNET-READINESS-REPORT.md).

A “complete security audit” means a **named third-party firm** with a published
report — not an agent review, not `docs/FINDINGS-08.md`, not Slither alone.
See [`AUDIT-SCOPE.md`](./AUDIT-SCOPE.md) for the engagement brief.

---

## Gate 0 — Honesty (always on)

| Check | Status |
| --- | --- |
| No “audited / partnered / guaranteed / APY” copy | Required |
| No present-tense Kuru / Perpl / Envio / CRE / vUSD without hash in `ADDRESSES.md` | Required |
| Market: MON only until multi-market ships | Required |
| Full product name: Engine + Hull + Ballast + vUSD/svUSD (coming up) + Proof-of-Hedge | Required |

## Gate 1 — Capital safety (code)

| Check | Status |
| --- | --- |
| Pause freezes **ingress** only (joins / deploy / crank) | ✅ |
| Pause allows **egress**: `unwind` + exits + vault withdraw/redeem | ✅ |
| Engine callbacks for unwind pause-exempt | ✅ |
| Keeper never coerces missing book → `0` | ✅ |
| Foundry invariants ≥ 10k runs (floor + vault identity) | ✅ scaffold |
| Conservation fuzz on every settle regime | ✅ fuzz; expand Handler settle coverage |
| Dead-share economics (`liveAssets`) source + live 10143 bytecode | ✅ |
| Deposit caps + progressive soft/hard | 🟡 code (`Tranches.setDepositCap`) — not on live deploy |
| TWAP / oracle path (`ISpotOracle` / `ManualTwapOracle`) | 🟡 code — live Engine still router mid |
| On-chain netDelta band / halt | 🟡 code (`setNetDeltaHaltBps`) — disabled until set |
| `vault.asset() ==` live venue quote token (no DemoUSD on mainnet) | ❌ |
| Real spot adapter (Kuru) with non-empty **on-chain** book + `TX_KURU_SPOT` | ❌ |
| Real short venue (Perpl) + `PERPL_KEEPER_ORDER` + `isSimulated()==false` only then | ❌ |

## Gate 2 — Ops / keys

| Check | Status |
| --- | --- |
| Guardian owner = real independent 2-of-3 (or better) Safe | ❌ verify signers |
| Timelock on ownership / param changes | 🟡 `DeployTimelock.s.sol` — not owning Guardian yet |
| Keeper keys offline / HSM; CRE DON for decisions when EA opens | ⚠️ simulate only today |
| Hosted Envio GraphQL + no archive RPC history reads | ❌ pending |
| Monitoring / paging on `/health` + CRE halt latch | ❌ |
| Incident runbook + pause policy published | partial (`docs/risk.md`) |

## Gate 3 — External audit

| Check | Status |
| --- | --- |
| Scope frozen (`AUDIT-SCOPE.md`) | ✅ draft |
| Firm engaged; draft report | ❌ |
| All High/Critical closed or accepted in writing | ❌ |
| Report published + banner may drop “unaudited” **only then** | ❌ |

## Gate 4 — Mainnet deploy

| Check | Status |
| --- | --- |
| Chain 143 addresses in `ADDRESSES.mainnet.json` + Sourcify | ❌ skeleton only |
| Quote token = production USDC/AUSD as designed (single stable story) | ❌ **decision open** |
| Remove DemoUSD faucet from product path | ❌ (10143 only; mainnet env disables faucet) |
| Mainnet e2e: deposit → deploy → crank → unwind → withdraw timed | ❌ |
| Legal review before vUSD / public AUM | ❌ |

---

## What “production-level” means here

1. **Testnet production-quality** — can ship now: pause egress fix, honesty UI,
   invariants, keeper halt-on-missing-book, caps/oracle/halt **scaffolds**, published findings.
2. **Mainnet-ready** — only when Gates 0–4 are green. Do not flip chips or
   marketing until hashes exist.

Agents and maintainers must not mark this file’s Gate 3/4 rows green without
external evidence (audit PDF URL, mainnet tx hashes).
