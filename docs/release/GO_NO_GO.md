# GO / NO-GO — testnet v2 release · 2026-10-01

Release record: [testnet-v2-release.json](testnet-v2-release.json) · commit
`a6accd6` on `p-development` · manifest
[deployments/testnet-v2.json](../../deployments/testnet-v2.json).

## Decision

| Scope | Decision | Why |
|---|---|---|
| **Testnet demo** (invited wallets, demo dollars, simulated engine) | **GO — conditional** | Contracts deployed, verified and governed by the Safe + timelock; app, Terminal, SDK, MCP, API, keeper and independent checker built and tested. Two conditions below must be met first. |
| **Mainnet private beta** (real funds) | **NO-GO** | R02 venues, R03 valuation, R04 economics, R05 security review, R07 operations and R10 participation are blocked (G01–G07 open). `activationAuthorized: false`. |

### Conditions for the testnet GO

1. **Safe batch 01 executed** (engine, stage cap 25,000, close cost, 20 dUSD
   reserve, simulated funding rate). Until then the book reads stage cap 0 and
   deposits are closed — the app shows this correctly.
2. **v2 keeper running** with `V2_KEEPER_PK` (funded: 5 MON) and the v2
   manifest on the service host; `NEXT_PUBLIC_STATS_URL` set for the app's
   evidence panels.

Then batch 03 (tester allowances), and batch 02 (Hull series 1) once Ballast
and the reserve can cover it.

## Gates

| Gate | Status | Evidence / blocker |
|---|---|---|
| R01 Specification | PASS | ADR-008; 10,008 settlement cases agree across Python, TypeScript and Solidity; ACCOUNTING and STATE_MACHINES docs |
| R02 Venues | BLOCKED | G01, G02, G04 — testnet short leg is a labelled simulator |
| R03 Valuation | BLOCKED | G03 — no oracle; on-chain reconstruction exists (`vessel-verify` PASS) |
| R04 Economics | BLOCKED | 30-day rate history needs 30 days of observed carry |
| R05 Security | BLOCKED | G05 — no independent review |
| R06 Claims | PARTIAL | Local deposit → deploy → settle rehearsal; no full 28-day maturity on testnet |
| R07 Operations | BLOCKED | G07 two-person coverage; drills not run |
| R08 Deployment | PARTIAL | Anvil rehearsal + testnet deploy; Sourcify exact ×7; roles checked on chain. Mainnet path not rehearsed |
| R09 Product | PARTIAL | All screens on v2, desktop + phone; live read checked. Cold wallet path waits on batch 01 |
| R10 Participation | BLOCKED | G06 — terms and eligibility not reviewed |
| R11 Machine access | PASS | Cold stdio MCP test on testnet; prepare security tests; prepare off by default; no host claim |
| R12 Stage increase | N/A | Stage cap 0; increases only via Safe + timelock |

## What would change the mainnet decision

G01 (contract-owned venue account), G03 (approved valuation feeds), G05
(independent review) and G06 (counsel-reviewed terms) are the hard blockers;
R04 additionally needs 30 days of observed carry. None can be closed by
engineering time alone.
