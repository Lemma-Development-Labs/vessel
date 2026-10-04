# Understanding Vessel

Company and product guide

Prepared for Kunal Drall and the Vessel team • 23 September 2026 • Version 3.0 company pack

Vessel is building verifiable structured yield on Monad. A single economic engine holds MON spot and an offsetting MON perpetual short. Hull gives users a dated senior claim with a fixed contractual rate subject to losses. Ballast gives users the residual return and first-loss exposure. A common evidence layer lets people inspect the positions and accounting behind both claims.

This guide explains the intended product and customer experience. The implementation baseline is Vessel Complete Product and Production Build v2, dated 22 September 2026 [P1]. This pack organizes that baseline for customers, investors, partners, and the team. It does not certify current code, deployment, custody, or financial performance.

## The problem Vessel addresses

A displayed APY does not explain who holds collateral, how a hedge is maintained, what happens when funding turns negative, or who absorbs losses. Running a spot and perpetual strategy directly also requires margin monitoring, reconciliation, execution, and incident response. Many potential users cannot justify doing that work for a small allocation.

Vessel packages the strategy into explicit claims and makes its economic state inspectable. The customer decision becomes whether the source of return, risk priority, and exit terms suit their capital. The product must make refusing an unsuitable allocation as easy as accepting one.

The target problem is a hypothesis to validate through observed allocation and repeat use. A sophisticated user might still prefer direct trading, lending, another structured product, or holding USDC. Transparency is valuable only if it helps users make decisions and the resulting economics justify the constraints.

## The product in three explanations

**One line:** Vessel turns hedged trading income into senior and first-loss yield positions you can verify.

**Thirty seconds:** Vessel is a structured yield protocol on Monad. Its engine pairs MON spot with a MON perpetual short to seek funding income while reducing directional exposure. You choose Hull, a 28-day senior claim, or Ballast, which takes first losses and receives residual returns. Vessel shows the hedge, liabilities, and settlement evidence so you can inspect what supports your position.

**Two minutes:** Perpetual markets sometimes pay shorts to hold the other side of leveraged demand. Vessel seeks that income while holding offsetting spot exposure. It accounts for both legs, funding, collateral conversion, fees, and losses. Hull receives a contractual coupon ahead of Ballast. Ballast supports Hull and can lose all its value. A reserve absorbs losses only after Ballast is exhausted. Severe losses can also impair Hull. The app simplifies participation, while Terminal and verification tools expose the underlying book. Initial mainnet use is intended to be private, reviewed, and capped. The broader portable-dollar branch remains isolated on testnet.

## Who the first product serves

| User | Job to be done | Appropriate product | Main objection |
|---|---|---|---|
| Sophisticated Monad allocator | Allocate a limited amount to a dated return profile | Hull | Loss exposure and delayed payment after maturity |
| Experienced risk capital provider | Earn residual economics for supporting senior claims | Ballast | Negative carry and junior depletion |
| Small treasury operator | Evaluate an allocation with inspectable accounting | Hull or evaluation only | Policy, custody, liquidity and eligibility constraints |
| Wallet or application builder | Show verifiable yield information in their own product | SDK and proof widget | Integration cost and reliable data |

Every cohort remains a proposed segment. Small treasury operators are discovery participants first; this pack does not suggest that operational payroll or emergency reserves belong in the beta. Users seeking a bank deposit, guaranteed principal, instant liquidity, or an unattended trading agent are outside the initial customer promise.

## The five product layers

**Engine.** The engine seeks net funding income using one approved MON book. It must prove its custody and execution paths before it accepts external funds. Carry estimates include costs and idle capital. It cannot move into an unapproved market simply because that market displays a higher rate.

**Hull.** One series runs for 28 days after activation. A 72-hour subscription window precedes activation. The contractual simple annual rate is fixed when the series begins. No mid-series entry, early redemption, automatic rollover, or transferable secondary market is offered in the beta. The rate is a promise subject to asset availability, not a guarantee of payment.

**Ballast.** Perpetual junior units receive the residual result after applicable fees and Hull accrual. Ballast also absorbs economic shortfalls before the reserve and Hull. Redemption requests have a 48-hour cooldown, but fulfillment also depends on liquidity and continuing senior coverage. A request remains exposed to losses until the corresponding USDC is funded and segregated.

**vUSD and svUSD.** These are a portable-dollar research and testnet product branch. They use a separate custody book and liability ledger. No vUSD or svUSD contracts enter the V1 mainnet beta deployment. Their eventual backing, liquidity, redemption, legal, and economic model require separate validation.

**Distribution.** The SDK, proof widget, API, and MCP provide consistent access to evidence and approved preparation flows. The partner handoff opens the first-party app, which rebuilds and verifies the requested action. The beta has no affiliate revenue sharing or unrestricted embedded deposits.

## One engine with several access surfaces

The consumer app answers “what do I own, what can I receive, when can I exit, and what can go wrong?” Terminal answers “what positions and liabilities support that result?” MCP and the SDK expose the same canonical data to software. These are interfaces to the same system, not independent strategies or competing accounting implementations.

The Opportunity Engine is a research and capacity surface within Terminal. It estimates whether the approved MON strategy has positive expected net carry and capacity. It explains why deployment is accepted or refused. It does not autonomously add assets, change capital mandates, or allocate funds based on an LLM response.

The product should work completely without natural language. If conversational assistance is added, it can explain retrieved facts and prepare typed requests. User wallets authorize user transactions. Public machine-access tools cannot obtain keeper keys or change economic policy.

## Where returns and losses come from

Funding is a transfer between market participants. A short can receive or pay it depending on conditions. Spot and perpetual gains approximately offset when the hedge is maintained, but basis differences, fees, timing, collateral FX, and liquidation mechanics can break the approximation.

Consider an illustrative book with 45% in MON spot, 45% in margin, and 10% in idle USDC. If funding paid to shorts were 20% annualized on the perpetual notional, its contribution to whole-book income would be about 9% before other economics: 45% multiplied by 20%. The funding headline is not the depositor return. This example is arithmetic, not an observed rate or forecast.

Initial allocation and thresholds are provisional risk settings from P1. Reserve capital sits inside idle USDC and is not another investor claim to spend. Capacity must reflect actual depth, open interest, conversion, withdrawals, stress loss, and operating coverage. A strategy may rationally stay idle or stop new Hull issuance.

## How Hull and Ballast differ

| Attribute | Hull | Ballast |
|---|---|---|
| Claim | Senior principal plus accrued contractual coupon | Junior residual NAV per unit |
| Return | Fixed contractual simple rate for a series, subject to loss | Variable residual result, potentially negative |
| Term | 28 days after activation | Perpetual |
| Exit | Funded settlement after maturity or emergency termination | Request, 48-hour cooldown, then safe liquidity processing |
| Loss position | After Ballast and reserve | First |
| Transfer in beta | Restricted | Restricted |
| Main risk | Senior impairment and delayed recovery | Full loss and prolonged queue |

“Senior” means higher payment priority. It does not mean risk-free. A 48-hour cooldown is a waiting requirement, not a 48-hour payment guarantee. Maturity ends ordinary coupon accrual even if the actual payout takes longer.

## The customer lifecycle

Before funding, a user sees the environment, asset, series terms, fee policy, current review scope, capacity, evidence freshness, and eligibility status. They choose a tranche after reading the relevant risks. Wallet authentication identifies the session; the wallet separately approves any token allowance and transaction.

For Hull, the deposit first enters refundable subscription escrow. Activation admits eligible capital under frozen terms and begins accrual. For Ballast, an active-book deposit enters a forward-priced admission batch after the existing book settles. A successful transaction is not automatically a successful admission. The portfolio distinguishes requested, admitted, rejected, refundable, matured, queued, claimable, and claimed amounts.

At Hull maturity, the engine closes in paired slices, retrieves collateral, converts to USDC, and settles all senior holders proportionally. Ballast redemption locks units but does not freeze their price. Only a funded portion is burned and moved into claim escrow. Claimable USDC no longer participates in strategy risk.

If the indexer fails, cached numbers carry stale labels and the independent verifier remains available where chain data permits. If valuation is uncertain, the system blocks NAV-dependent actions. It must never substitute healthy zero balances or a simulated rate in a real-money screen.

## Status and release boundaries

The team has reported a Monad testnet prototype, a Monad Blitz New Delhi V4 win, and historical automated tests. Those reports are background, not verification of the current release [P2]. The public app and repository could not be independently inspected through the available web retrieval in this preparation. This pack therefore makes no current mainnet, customer, TVL, revenue, or audit-completion claim.

The planned release builds the full user journey while limiting exposure. Stage A allows up to 1,000 USDC of team contributions. Stage B allows 5,000 USDC cumulative contributions with up to ten participants. Stage C allows 25,000 USDC cumulative contributions with up to 25 participants. These lifetime budgets include team seed and reserve. Withdrawals do not replenish admitted lifetime room. Smaller measured limits always apply.

External deposits require independent review, proven custody and withdrawals, valid valuation, operational coverage, and participation review. Launch dates remain conditional. The company can demonstrate a complete testnet product while mainnet remains blocked.

## Vocabulary and public language

**Active NAV** is the strategy book after excluded escrows and treasury liabilities. **Hedge** means the opposing spot and perpetual position. **Carry** is the economic return from holding the strategy after the specified costs. **Waterfall** is the predetermined allocation of income and losses. **Junior cover** is Ballast NAV divided by Hull plus Ballast NAV, excluding reserve. **Proof of Hedge** is an observation with source references, not a solvency guarantee.

Use “fixed contractual rate subject to loss,” “funded claim,” and “planned capped private beta.” Avoid “guaranteed APY,” “risk-free,” “instant withdrawal,” “fully audited” without scope, and “live” without transaction evidence. Distinguish technology integrations from commercial partnerships. The first enduring brand asset should be an accurate, reproducible operating record.

## References

[P1] Vessel Complete Product and Production Build v2, 22 September 2026, current project baseline read for this pack. [P2] Founder-provided project history in the Vessel conversations, including testnet and hackathon reports. External ecosystem references and claim verification rules appear in Document 08.
