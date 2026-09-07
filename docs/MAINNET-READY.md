# Mainnet readiness — hard gates (not a marketing checklist)

**This repository is not mainnet-ready today.** Saying otherwise would be the
exact false-claim class Prompt 08 forbids. This document is the **gate**: every
box must be green before any mainnet deposit is accepted, and until then the
product banner stays **TESTNET · unaudited**.

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

| Check | Status (this PR) |
| --- | --- |
| Pause freezes **ingress** only (joins / deploy / crank) | ✅ |
| Pause allows **egress**: `unwind` + exits + vault withdraw/redeem | ✅ |
| Engine callbacks for unwind pause-exempt | ✅ |
| Keeper never coerces missing book → `0` | ✅ |
| Foundry invariants ≥ 10k runs (floor + vault identity) | ✅ scaffold |
| Conservation fuzz on every settle regime | ✅ fuzz; expand Handler settle coverage |
| `vault.asset() ==` live venue quote token (no DemoUSD on mainnet) | ❌ |
| Real spot adapter (Kuru) with non-empty book + `TX_KURU_SPOT` | ❌ |
| Real short venue (Perpl) + `PERPL_KEEPER_ORDER` + `isSimulated()==false` only then | ❌ |
| TWAP / oracle for spot mark (not router mid alone) | ❌ |
| On-chain netDelta band / halt (not keeper-only) | ❌ |
| Dead-share economics resolved + bytecode matches source | ❌ |
| Deposit caps + progressive limits | ❌ |

## Gate 2 — Ops / keys

| Check | Status |
| --- | --- |
| Guardian owner = real independent 2-of-3 (or better) Safe | ❌ verify signers |
| Timelock on param changes | ❌ |
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
| Chain 143 addresses in `ADDRESSES.json` + Sourcify | ❌ |
| Quote token = production USDC/AUSD as designed (single stable story) | ❌ |
| Remove DemoUSD faucet from product path | ❌ |
| Mainnet e2e: deposit → deploy → crank → unwind → withdraw timed | ❌ |
| Legal review before vUSD / public AUM | ❌ |

---

## What “production-level” means here

1. **Testnet production-quality** — can ship now: pause egress fix, honesty UI,
   invariants, keeper halt-on-missing-book, published findings.
2. **Mainnet-ready** — only when Gates 0–4 are green. Do not flip chips or
   marketing until hashes exist.

Agents and maintainers must not mark this file’s Gate 3/4 rows green without
external evidence (audit PDF URL, mainnet tx hashes).
