# RISK_PARAMETERS

Typed risk and policy parameters for v2. Values come from
[spec/RISK_DEFAULTS_CANDIDATE.json](spec/RISK_DEFAULTS_CANDIDATE.json) and
spec §7–§10, §19–§20. **Every value below is a design candidate**: none is
calibrated against live venue granularity, depth or latency, and none may be
relaxed silently in code — a change needs an ADR in
[DECISIONS.md](DECISIONS.md). `packages/risk-policy` (S3) will carry these as
typed values with the same unit, owner and evidence fields.

Owners are **proposed** (spec §25) and unconfirmed by the people named.

Enforcement layer: **C** contract · **K** keeper/EngineManager policy ·
**S** signer · **A** app/API · **G** governance procedure.

## 1. Capital and claims

| Parameter | Candidate | Unit | Layer | Owner | Evidence status |
|---|---|---|---|---|---|
| Absolute V1 lifetime admitted contributions | 25,000 | USDC | C (immutable) | Kunal | design |
| Stage caps A / B / C | 1,000 / 5,000 / 25,000 | USDC lifetime | C + G (48 h timelock) | Kunal | design |
| External participant lifetime cap B / C | 500 / 2,000 | USDC | C | Kunal | design |
| Participant slots B / C | 10 / 25 | count | C | Kunal | design |
| Hull term | 2,419,200 (28 d) | seconds | C | Daksh | design |
| Hull subscription window | 259,200 (72 h) | seconds | C | Daksh | design |
| Hull max subscribers per cohort | 25 | count | C | Daksh | design |
| Hull rate rule | min(15%, max(0, 0.60 × EWMA net carry)), 30-day half-life, ≥ 30 consecutive days | annual simple bps | K (derivation) + C (terms hash) | Kunal | **blocked** — P03, no real history |
| Ballast exit cooldown | 172,800 (48 h) | seconds | C | Daksh | design |
| Junior cover admission/payout buffer (current **and** projected) | 3,000 | bps of H + B (reserve excluded) | C | Kunal | design |
| Junior cover intervention floor | 2,000 | bps | K + C | Kunal | design |
| Reserve target | 200 | bps of pre-settlement active NAV | C | Kunal | design |
| Performance fee | 1,000 | bps of eligible gain after loss carryforward | C | Kunal | design |
| Reserve share of fee (max) | 5,000 | bps of F, capped at deficit | C | Kunal | design |
| Governance delay | 172,800 (48 h) | seconds | C | Kunal | design |

## 2. Execution and exposure

| Parameter | Candidate | Unit | Layer | Owner | Evidence status |
|---|---|---|---|---|---|
| Allocation idle / spot / margin | 10 / 45 / 45 | % of active NAV (reserve inside idle) | K | Daksh | design |
| Gross market notional max | 10,000 | bps of active NAV | K + S | Daksh | design |
| Perp notional / available margin equity max | 12,500 | bps | K + S | Daksh | design — venue maintenance margin may be stricter |
| Rebalance delta | 100 | bps of A | K | Daksh | design |
| Critical delta | 200 for 30 s, or unconfirmed execution | bps of A · seconds | K | Daksh | design |
| Slice size | min(100 USDC, 50 bps of A, tested depth) | USDC | K + S | Daksh | **blocked** — P10, depth unmeasured |
| Spot slippage | 30 | bps vs independent reference | C (KuruAdapter) + S | Daksh | design |
| Collateral conversion slippage | 20 + documented fees | bps aggregate | C (CollateralAdapter) | Daksh | **blocked** — G04 |
| Margin stress | survive +30% MON shock with stressed fees, no top-up | scenario | K | Daksh | design |
| Negative carry stop | 24 h net carry < 0 | sign | K | Kunal | design |
| Protocol drawdown halt | 2% from cash-flow-adjusted high-water NAV | % | K | Kunal | design |
| Short notional vs market | ≤ 1% observed OI and ≤ 5% executable depth in envelope | % | K | Daksh | **blocked** — P10 |

## 3. Freshness and valuation

| Parameter | Candidate | Unit | Layer | Owner | Evidence status |
|---|---|---|---|---|---|
| Actionable venue state max age | 10 | seconds | K + S | Daksh | design |
| Preparation snapshot max age | 30 | seconds | A | Daksh | design |
| Oracle max age | min(60, approved feed bound) | seconds | C (ValuationAdapter) | Daksh | **blocked** — G03, no feed chosen |
| Oracle divergence halt | 100 | bps between validated sources | C + K | Daksh | blocked — G03 |
| Stablecoin warn / stop | 50 / 100 | bps deviation from $1 (measured FX) | K | Daksh | blocked — G03 |

## 4. Quantity specification

Every quantity crossing a boundary carries its unit. JSON transports integer
decimal strings; TypeScript uses `bigint`; Solidity uses checked integers.
`Number` is forbidden for any row below.

| Quantity | Unit / decimals | Authoritative owner | Freshness bound | Serialization |
|---|---|---|---|---|
| Token transfer amounts | native token decimals, verified on-chain (USDC 6, AUSD 6, WMON 18 — FACT_CHECKS) | token contract | per block | `{amount: "<int>", unit: "USDC:6"}` |
| Internal valuation (A, H, B, R, G, F, FR, FT, L, C) | USD, 18 decimals | contracts (settlement) | settlement block | `"<int>"` + `"USD:18"` |
| USDC/USD, AUSD/USD, MON/USD prices | 18-decimal fixed point | ValuationAdapter (approved feed) | oracle max age | `"<int>"` + source + observedAt |
| Hull principal units | 1 unit per USDC admitted, decimals fixed at deployment (P02) | HullSeries | per block | `"<int>"` + unit |
| Ballast units | fixed at deployment with virtual offsets (P02) | BallastToken | per block | `"<int>"` + unit |
| Rates and ratios | bps (integer) or 18-decimal WAD | contracts / risk-policy | as source | `"<int>"` + `"BPS"` / `"WAD"` |
| Spot quantity, signed perp quantity | MON 18 decimals; perp size in venue lot units converted with verified lot decimals | venue + reader | venue max age | `"<int>"` + unit + blockHash |
| Timestamps | UTC | chain block / observer | — | ISO-8601 string |
| Block references | number + hash | chain | — | `"<int>"`, `0x…` |

## 5. Open parameters (must be decided before the dependent action)

| ID | Area | Decision needed | Blocks | Status |
|---|---|---|---|---|
| P01 | Valuation | Exact price feeds and venue-state authentication | core activation | OPEN (G03) |
| P02 | Precision | Unit decimals, virtual offsets, seed, rounding residual and dust destination | claim issuance | OPEN |
| P03 | Hull rate | EWMA initialization, missing-data rule, cost dataset | Hull activation | OPEN |
| P04 | Custody | Perpl account ownership, delegation, fixed withdrawal method | real execution | OPEN (G01) |
| P05 | Routes | Provider contract versions, finality, timeouts | each source route | OPEN (G09) |
| P06 | Operations | Named primary, backup and independent signers | any funded canary | OPEN (G07) |
| P07 | Participation | Entity terms and eligible jurisdictions | external cohort | OPEN (G06) |
| P08 | Queue | Priority, batch bounds, cancel rules | production lifecycle | OPEN |
| P09 | Pause | Exact action masks and resume authority | deployment | OPEN |
| P10 | Capacity | Verified depth, lot sizes, OI, stress close cost | new exposure | OPEN (G02) |

No default may be filled for an OPEN parameter; the dependent action stays
blocked until the parameter has a value, owner, evidence and review.
