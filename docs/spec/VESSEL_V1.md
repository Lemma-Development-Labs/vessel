# Vessel Complete Product and Production Build

Version 2.0 | 22 September 2026 | Prepared for Kunal Drall and the Vessel engineering team

This specification defines the complete Vessel V1 product, its production architecture, the capped mainnet private beta, and eight implementation sessions. Vessel will ship a single-market verifiable capital engine with Hull senior claims, Ballast first-loss capital, a reserve, independent hedge verification, a consumer app, Terminal, MCP, and distribution tools. The vUSD and svUSD product branch will ship on an isolated testnet book; it will not be deployed into the mainnet beta.

The decision is to build the complete system while limiting its initial financial exposure. The recommended private-beta ceiling is 25,000 USDC of admitted lifetime subscriptions and reserve contributions, reached through 1,000, 5,000, and 25,000 USDC stages. These are proposed maximum budgets, not measurements of safe venue capacity. Actual admitted exposure is the smaller of these ceilings and the tested capacity and loss budgets. External-user deposits require independent security review. A finished implementation or a successful test suite does not by itself authorize launch.

This is the new implementation baseline. It explicitly supersedes conflicting design choices in Books 02, 04, 19, and 20 where the decision register says so. Historical deployment facts remain historical facts. Source code, deployed state, and transaction evidence must be inspected during Session 1 before any existing feature is classified as complete. No repository audit, live liquidity measurement, legal approval, or mainnet deployment is claimed by this document.

## 1 Product definition and customer promise

Vessel is a Monad-native structured-capital protocol. Its engine holds MON spot and an offsetting MON perpetual short to seek funding income while reducing directional exposure. Users choose Hull, a dated senior claim with a fixed contractual rate subject to losses, or Ballast, the junior claim that earns residual returns and absorbs losses first. Every interface exposes the same positions, liabilities, risk decisions, and evidence.

The customer promise is: choose your risk position, understand the exit conditions, and independently inspect the book supporting your claim. Delta neutrality does not eliminate basis, margin, venue, stablecoin, oracle, execution, or contract risk. Hull is not a bank deposit, guaranteed return, or principal-protected product. Ballast can lose its entire value. The reserve is subordinated capital, not an insurance guarantee.

The first customer cohorts are sophisticated Monad users and small treasury operators who accept explicit term and first-loss risk. Builders are a second distribution customer through the SDK, proof widget, and MCP. The beta tests whether these users value verification and will return after a complete maturity and exit cycle.

The five product layers remain Engine, Hull, Ballast, vUSD/svUSD, and Distribution. App, Terminal, MCP, and API are access surfaces over those layers. The Opportunity Engine is a research and capacity surface within Terminal: it estimates net carry and explains whether the approved MON book can accept capital. It does not autonomously select new assets or route deposits into unreviewed strategies.

## 2 Release scope

| Component | Complete V1 build | Mainnet private beta |
|---|---|---|
| MON engine | Real Kuru spot and Perpl short with reconciliation | Enabled only after custody and capacity gates |
| Hull | One 28-day series at a time with fixed terms and settlement | Enabled from the external-user stage |
| Ballast | Perpetual junior units with 48-hour exit cooldown | Enabled with onchain admission and exposure controls |
| Reserve | Segregated accounting and deterministic loss use | Pre-funded before Hull opens |
| Proof of Hedge | Direct-chain verifier and indexed history | Required |
| App | Onboarding, deposits, claims, exits, evidence, risk, health | Required |
| Terminal | Book, hedge, carry, risk, series, activity, opportunities | Required |
| MCP | Read, verify, and typed unsigned preparation | Read and verify first; prepare behind a separate gate |
| Distribution | Typed SDK, proof widget, safe app handoff | Proof widget and handoff enabled |
| vUSD and svUSD | Backing, mint, redeem, staking on an isolated testnet book | Contracts absent from deployment |
| Hull secondary market | Compatible interface and testnet trade if viable | No promised liquidity; transfers disabled in beta |
| Operations | Alerts, reconciliation, incident control, recovery | Required before capital is admitted |

Public multi-market execution, leverage products for retail traders, lending against Hull, cross-chain capital movement, unrestricted AI execution, tokens, emissions, points farming, and a native mobile application are outside V1. Additional markets may appear in a labelled research watchlist only after their data sources are verified. They cannot acquire capital permissions through a UI flag.

## 3 Decision register

The following decisions are adopted for this build specification. An implementation change requires an ADR that states the old rule, replacement, reason, accounting impact, migration effect, tests, and review owner. External facts are separately verified; an ADR cannot make an unsupported venue capability true.

| ID | Decision | Rationale or change from earlier books |
|---|---|---|
| D01 | One chain, MON market, USDC deposits | Keeps economic and operational scope bounded |
| D02 | Explicit USDC to AUSD collateral route | Current Perpl mainnet collateral differs from the vault asset |
| D03 | No publicly redeemable pooled vault share | Avoids a third claim bypassing Hull and Ballast priority |
| D04 | Custom asynchronous request and claim interfaces | Do not falsely advertise ERC-4626 compliance for term claims |
| D05 | Ballast absorbs shortfall, then Reserve, then Hull | Resolves the reserve smoothing contradiction |
| D06 | Reserve allocation is part of total fee, not an extra fee | Fixes possible double-counting in old conservation shorthand |
| D07 | Full marked book economics plus a fee loss carryforward | Includes both hedge legs and avoids fees on simple loss recovery |
| D08 | One Hull series, 28 days, no entry after activation | Removes overlapping-series priority and late-entry ambiguity |
| D09 | Nontransferable beta claims except controller escrow and burn | Enforces invite and per-participant limits; supersedes unrestricted beta transfers |
| D10 | Queue shares remain exposed until USDC is funded and segregated | Prevents stale-price exits and unfunded senior withdrawal claims |
| D11 | New Hull and Ballast exits require 30% junior cover | Adds a buffer above the 20% hard intervention floor |
| D12 | No proxies in V1 core; new deployment for material changes | Reduces mutable logic risk; migration requires holder action |
| D13 | Trade key separate from account owner and withdrawal rights | API scope alone does not secure underlying custody |
| D14 | Independent review before external beta capital | Stronger gate than internal-review-only older plans |
| D15 | Eight sessions with shared contracts and evidence gates | A small prompt set without omitting subsystems |
| D16 | Existing Vessel identity and one UI and auth system | App and Terminal must feel like one product |
| D17 | Mainnet vUSD deployment is prohibited for this release | A frontend feature flag is insufficient isolation |
| D18 | Dates are forecasts; gates decide launch | Earlier October targets do not waive unfinished work |

## 4 Verified facts and unresolved dependencies

Official documentation was checked on 22 September 2026. The addresses below are documentary references, not authorization to send funds. Session 1 must confirm bytecode, token decimals, market configuration, implementation dependencies, ownership, and current onchain state at an identified block. Recheck before deployment and record any source changes. [S1-S7]

| Reference | Documented mainnet value | Required implementation check |
|---|---|---|
| Monad chain | 143; testnet 10143 | RPC chain ID and finality behavior |
| Circle USDC | 0x754704Bc059F8C67012fEd69BC8A327a5aafb603 | Issuer, decimals, bytecode and token policy |
| AUSD | 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a | Perpl accepted collateral and live conversion depth |
| WMON | 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A | Wrapper and native accounting semantics |
| Kuru MON USDC market | 0x065C9d28E428A0db40191a54d33d5b7c71a9C394 | Base asset mode, units, lot size and permissions |
| Kuru MON AUSD market | 0x131a2e70a5b31a517a74b8c567149bc294470da9 | Conversion route and two-leg exposure |
| Perpl Exchange | 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F | ABI, account ownership, margin and pending-order reads |
| Perpl MON market ID | Resolve from mainnet context and chain | Do not reuse testnet market 64 by assumption |

Perpl documents Ed25519 API keys with read/trade scopes and no API-key withdrawals or transfers out. It also documents delegated accounts and an enrollment-origin allowlist. These features are useful inputs; the exact contract-account ownership, operator revocation, destination controls, and enforced order limits remain launch blockers until demonstrated. [S5]

Kuru publishes separate market-factory and aggregator contracts. Integration must pin the selected direct market/router path and validate its ABI, instead of assuming every contract labelled router has identical semantics. A USDC to MON to AUSD route is acceptable only if both conversion legs complete atomically with an aggregate output floor; otherwise introduce a separately reviewed route or block launch. [S3, S4]

The unresolved dependency register starts with: G01 contract-owned Perpl account and constrained recovery; G02 MON market metadata and both venues' executable depth; G03 reliable onchain MON/USD, USDC/USD, and AUSD/USD valuation inputs; G04 USDC/AUSD conversion and withdrawal limits; G05 independent reviewer availability and findings; G06 beta participant eligibility and offering terms; G07 two-person operating coverage; G08 current repository status and deployed artifacts. Owners are assigned in Session 1. Every unresolved item has an evidence requirement; no mainnet placeholder address or silently assumed capability is permitted.

## 5 Architecture and trust boundaries

Use one monorepo. Prefer the existing working stack where it already satisfies the boundaries below; do not rewrite solely for a new folder layout. Target Solidity and Foundry for contracts; TypeScript for app, API, SDK, shared schemas, risk orchestration, and MCP; PostgreSQL for durable operational state; Envio for indexed history; and containerized long-running keeper services. Keep a proven existing keeper language if a written interface contract and parity tests make it safer than a rewrite.

| Boundary | Components | Authority |
|---|---|---|
| User interface | App, Terminal, wallet, widget | Display and prepare; wallet authorizes user actions |
| Public data | API, SDK, MCP, indexer, verifier | Read and explain; cannot set NAV or sign orders |
| Protocol | Custody, controller, tokens, risk and oracle adapters | Enforces assets, claims, permissions and settlement |
| Venue execution | Kuru adapter, collateral adapter, Perpl account adapter | Narrow, allowed actions against pinned venues |
| Operations | Durable keeper, signing broker, independent sentinel | Execute bounded policy and detect failures |
| Governance | Multisig, timelock, pause guardian | Restricted configuration and incident control |

The browser must never have database credentials, operator credentials, or API signing secrets. Public MCP must have no network or secret access to the signing broker. The indexer and database are disposable projections of chain evidence for accounting purposes. Offchain observations may inform risk decisions but cannot arbitrarily mint shares or declare gains.

Contract valuation reads current permitted venue state and vetted oracle inputs. If necessary position, collateral, liability, or pending-order information cannot be read or securely validated onchain, settlement and mainnet launch are blocked. A keeper-signed NAV report is not an unannounced fallback. Adopting an attested NAV model would require a separate trust-model ADR and security review.

Suggested repository boundaries are contracts/core, contracts/venues, contracts/risk, contracts/lab; apps/web; services/api, keeper, signer, sentinel, mcp; indexer; packages/domain, config, math, risk-policy, sdk, ui; scripts; tests; and docs. The landing page can stay in its existing package. Shared types are generated from one schema source; ABI files are generated from pinned contract builds.

## 6 Contract responsibilities and interfaces

| Module | Required responsibility | Forbidden authority |
|---|---|---|
| AssetCustody | Track admitted USDC, strategy assets, segregated escrows | Arbitrary operator transfers or public pooled-share redemption |
| TrancheController | Admit, price, issue, settle and burn claims | Invent external balances or bypass risk policy |
| HullSeries | Fixed principal units, rate, dates and claim state | Mutable existing terms or unrestricted beta transfers |
| BallastToken | Junior units and locked request balances | Transfers around participant or cooldown controls |
| RequestQueue | Pending subscriptions, cooldowns, batch processing | Mark unfunded exits claimable |
| ClaimEscrow | Segregate funded USDC claims | Deploy claimable funds into strategy |
| ReserveLedger | Reserve balance and waterfall use | Treasury withdrawal of reserve during beta |
| EngineManager | Target notional, allowed actions, modes and limits | Set share price from keeper input |
| KuruAdapter | Pinned spot swaps and balance reconciliation | Arbitrary routes, recipients or delegatecall |
| CollateralAdapter | Bounded USDC/AUSD conversion and custody return | Undisclosed collateral, bridge or external custody |
| PerplAccountAdapter | Controlled account ownership and venue reads | Unbounded withdrawal destination or generic execute |
| ValuationAdapter | Consistent price and venue-equity calculation | Use a lone manipulable venue price as solvency truth |
| BetaAdmission | Participant, wallet, stage and quota checks | Rewrite already vested claims |
| Timelock and Guardian | Delayed permissions and immediate pause | Guardian transfer, mint or resume power |

The public protocol interface includes requestDeposit(tranche, seriesId, assets, receiver, minUnits, deadline), cancelDeposit(requestId), processDepositBatch(batchId), requestBallastRedeem(units, receiver, minAssets), cancelRedeem(requestId), processExitBatch(batchId, maxItems), claim(requestId), settle(), closeMaturedSeries(seriesId), and view functions for capacity, terms, requests, claimable assets, and risk state. These are intended Vessel APIs, not assertions about existing contract signatures.

Every operation validates chain configuration, caller, ownership, recipient, request state, deadlines, limits, and authorization. Use safe token handling, checks-effects-interactions, reentrancy protection, bounded loops, and explicit custom errors. Claims transfer only to the fixed request receiver or a receiver changed through fresh holder authorization. Operators cannot change that destination. All request IDs and settlement epochs are unique and evented.

There is no external fungible AssetCustody share. Hull and Ballast exhaust investor claims. ERC-4626 and ERC-7540 are useful standards references, but V1 does not claim either interface for custom term and queue semantics. A later wrapper must pass the relevant standard's preview, max, request, claim, and operator behavior requirements. [S8, S9]

## 7 Canonical accounting

All monetary accounting uses integer fixed-point arithmetic. Asset transfers use verified native token decimals. Normalize valuation to 18-decimal USD units internally; convert to USDC at the measured USDC/USD rate. Avoid JavaScript Number for money, prices, quantities, or rates. Persist decimal integers as strings in JSON and use checked fixed-point math in contracts. Version every unit definition.

Define A as net active book assets in USDC-equivalent terms, excluding unadmitted deposit escrow, already funded claim escrow, and treasury fee liabilities. It includes USDC cash, MON/WMON inventory, AUSD cash, and net Perpl account equity. Position equity includes collateral and signed marked PnL with funding and fees applied exactly once. Pending cash movements are counted at one location, not both. External debt and venue liabilities reduce A. Publish a parallel USD view; USDC is not assumed permanently worth one dollar.

Define H as recognized senior NAV, B as junior NAV, R as reserve NAV, and T as newly assessed treasury fee liability. The active-book identity is A = H + B + R after settlement. Raw managed assets additionally include pending deposits, funded claims, and unpaid treasury liabilities. A separate custodian reconciliation proves the complete physical balance identity.

For an interval, gross economic result G equals end active assets before new fee assessment minus start active assets minus admitted subscriptions and reserve contributions plus investor payouts removed from the active book. Count an investor outflow when assets are moved from the active book into funded claim escrow, not again when the user later claims that escrow. Internal venue transfers and collateral conversions are not subscriptions. Existing fee payments settle an already excluded liability and do not change G. Maintain a cash-flow ledger so deposits, donations, refunds, gas funding, and treasury payments cannot become fictitious yield.

G includes signed spot PnL, signed perpetual PnL, funding, stablecoin FX changes, venue and execution fees, realized slippage, and attributable custody costs. V1 has no staking or lending income. Operator-funded gas remains an explicitly disclosed operating subsidy; do not charge an unauditable offchain invoice to NAV. Donations are quarantined until admitted as reserve contributions and counted against the beta gross contribution budget.

Keep L, a loss carryforward on gross strategy economics. For each settlement: recover previous L from positive G first; feeEligible is max(G minus previous L, 0); next L is max(previous L minus G, 0). The total fee F is 10% of feeEligible. This is a book-level beta policy, not a claim of per-investor equalized performance fees. No administrative reset of L during a live deployment.

Up to half of F is allocated to reserve, capped at the pre-settlement reserve deficit relative to 2% of active NAV. Call this allocation FR. Treasury allocation FT equals F minus FR. Retained reserve is not an additional expense on top of F. Require:

`change(H) + change(B) + change(R) + FT = G`

Using F on the left while also counting FR inside change(R) would double-count reserve replenishment. This corrected identity supersedes the earlier shorthand. Reserve target calculations use the pre-settlement snapshot to avoid a circular fee equation.

Accrue Hull's contractual coupon C for elapsed time on issued principal. After fees, Y equals G minus F. If Y is at least C: credit C to H, Y minus C to B, and FR to R. If Y is below C: the shortfall is C minus Y; reduce B first, then R including FR, then reduce H's proposed principal-plus-accrual balance. Use a deterministic two-pass rule: if the proposed allocation impairs Hull, recompute that entire epoch with F, FR and FT set to zero. Fees remain zero throughout impaired or emergency wind-down states. Never allow negative tranche balances; a deficit beyond all available claims is an insolvency event, not integer wraparound.

Do not pay fees, permit exits, or open a new Hull series from uncertain, stale, or unreconciled valuation. Treasury fees can be paid only from unencumbered USDC after maturity obligations, reserve requirements, margin safety, and funded-claim segregation are satisfied. Fee accrual and cash payment are distinct events.

### Worked settlement examples

The examples below use abstract USDC units, no prior loss carryforward, and a reserve target of 2% of starting active NAV. They are deterministic test vectors, not return forecasts.

| Case | Start H B R | G and coupon C | Fee F and reserve share FR | End H B R and treasury FT |
|---|---|---|---|---|
| Positive carry | 7000 3000 200 | G 100; C 20 | F 10; FR 4 | 7020 3070 204; FT 6 |
| Positive but below coupon | 7000 3000 200 | G 10; C 20 | F 1; FR 0.5 | 7020 2989 200.5; FT 0.5 |
| Loss absorbed by Ballast | 7000 3000 200 | G -100; C 20 | F 0; FR 0 | 7020 2880 200; FT 0 |
| Reserve used | 7000 30 200 | G -100; C 20 | F 0; FR 0 | 7020 0 110; FT 0 |
| Senior impairment | 7000 30 20 | G -100; C 20 | F 0; FR 0 | 6950 0 0; FT 0 |

The last two examples intentionally begin in a stressed undercollateralized state; admission policy would not create them. They test loss handling. A positive G of 100 following a loss carryforward of 120 charges no fee and leaves L equal to 20.

## 8 Hull terms and lifecycle

Hull issues one ERC-20-style principal unit per USDC of admitted principal, with the unit decimals explicitly specified. Beta transfers are restricted to minting, controller escrow, and burning; users cannot send claims to another participant or a DEX. The app must say there is no early redemption or secondary market in the beta. Public transferability requires a new reviewed version.

There is one active series at a time. States are DRAFT, SUBSCRIPTION_OPEN, CANCELLED, ACTIVE, MATURED_UNWINDING, CLAIMABLE, CLOSED, and IMPAIRED. The 72-hour subscription window holds USDC in refundable segregated escrow. No yield accrues and no strategy uses those funds until activation. Freeze the ordered eligible subscriptions and activate atomically or through a reviewed bounded process that cannot leave partially active economics. Maximum cohort size is 25 participants, limiting activation complexity.

On activation, set principal, rate, start time, and maturity exactly 28 days later. All subscribers receive the same terms and principal price; no mid-series Hull issuance. Refund users excluded by capacity, expiry, eligibility, minimum-unit constraints, or a cancelled launch. No automatic rollover. A later series can open only after the earlier series has completed funded settlement.

Rate policy: compute hourly net funding carry on total deployed book equity using realized funding less execution, collateral conversion, and expected unwind costs. Apply a 30-day half-life EWMA with at least 30 consecutive days of source data, a 40% haircut, and a 15% annualized simple-rate cap. Proposed rH is min(15%, max(0, 0.60 times EWMA net carry)). This is intentionally conservative and expressed on the whole-book equity denominator, not perpetual notional. Missing history does not become zero or fabricated history: delay issuance. Publish the dataset digest, sample coverage, formula, assumptions, and output.

Coupon accrues as principal times rH times elapsed seconds divided by 365 days; no compounding. Ordinary accrual ends at maturity. Full promised coupon is not guaranteed to be paid. Before admission, test projected full-term senior obligation and stressed NAV; cap the issuance below this forecast capacity. Once fixed, the rate cannot be repriced for existing holders.

At maturity stop new deployment, cancel risk-increasing orders, close the hedge in paired slices, withdraw collateral, convert to USDC, and reconcile the realized book. Coupon stops on time even if withdrawals are delayed. Fund every holder proportionally from final senior allocation, then mark claims available; this avoids a first-claimer advantage during a shortfall. Subsequent funds recovered after an incident use cumulative per-unit distributions so earlier claimers are neither advantaged nor excluded.

An emergency termination stops accrual at the recorded termination timestamp or maturity, whichever is earlier. It freezes the maximum senior entitlement at principal plus accrued coupon, triggers global wind-down, and exposes that early termination can lower the total coupon. Recoveries first restore all senior holders up to that frozen entitlement, then depleted reserve up to its frozen pre-impairment entitlement, then Ballast. No new subscriptions or fee accrual until the deployment is retired or a separately reviewed recovery plan is executed.

## 9 Ballast and redemption fairness

Ballast units represent B divided by total junior supply. Implement virtual asset/share protection and a nonredeemable minimal seed with audited rounding treatment; do not rely on first-depositor benevolence. Reject zero-unit deposits, dust extraction, fee-on-transfer assets, and rebase assumptions. Unsolicited transfers do not set the exchange rate. OpenZeppelin's discussion of ERC-4626 inflation attacks is relevant even though this pool exposes a custom claim API. [S10]

Ballast deposits are asynchronous whenever the book is active. Requested USDC is refundable and excluded from active NAV until a forward-priced admission batch. Settle the old book before admission; mint at the post-settlement price. Apply user minimum units and deadline, then recalculate capacity. New junior capital does not retroactively pay for losses before it acquired units.

If B is zero with existing supply, block ordinary deposits. Do not mint near-infinite units into a wiped-out class. Wind down or create a newly reviewed recapitalization series after old claims are resolved. The beta does not include an ad hoc bailout mint path.

An exit request locks units for 48 hours. Locked units still earn returns and bear losses; their cash value is not fixed at request time. Users can cancel the unprocessed remainder, releasing units; a new request restarts cooldown. Requests are not transferable. Receiver changes require holder authorization.

At each processing epoch, settle first and determine safe liquidity after senior obligations, margin, reserve, and projected full-term Hull cover. Process eligible requests in timestamp order with bounded work. Permit partial processing by burning only the funded fraction, moving exact USDC into ClaimEscrow, and retaining the rest as junior units. Slippage minimums are proportional for partial fills. A request whose minimum cannot be met is marked user-limited and skipped without blocking the whole queue; the user can amend it with an explicit new authorization and disclosed priority rule. Use the original cooldown but assign a new queue priority when the minimum is loosened after expiry.

Subordination uses junior NAV B divided by H plus B; reserve is excluded. Hard intervention floor is 20%; risk-increasing Hull activation and voluntary Ballast payouts require at least 30% both now and under full remaining Hull coupon obligations plus modeled close costs. Market losses can push the ratio below the floor; the system responds by stopping new risk and unwinding rather than claiming the invariant can prevent market movements. No cooldown is a guaranteed payment deadline.

## 10 Capital allocation and risk policy

Initial target allocation, excluding segregated escrows, is 10% idle USDC, 45% MON spot, and 45% Perpl margin valued in USDC. Short notional targets the spot quantity at a common reference price. This is roughly 0.45 times book NAV on each leg, not a two-times levered book. Reserve assets are ring-fenced in idle USDC and included within the idle allocation. Increase idle allocation when projected obligations require it.

Maximum gross market notional is 1.0 times active NAV, measured as absolute spot value plus absolute perp notional. Perpl short notional divided by available margin equity must not exceed 1.25. These provisional ceilings do not replace venue maintenance-margin calculations or stress tests. They may be reduced before launch; raising them requires a new risk review and delayed governance.

| Control | Initial beta rule | Action |
|---|---|---|
| Signed delta | abs(net MON delta value) above 1% of A | Rebalance in bounded slices |
| Critical delta | Above 2% of A for 30 seconds, or unconfirmed execution | Stop opening; reconcile and de-risk |
| Execution slice | At most min(100 USDC, 0.5% of A, tested depth) | Block if venue minimum makes safe slicing impossible |
| Spot slippage | Maximum 30 bps against independent valid reference | Refuse larger cost; no unlimited emergency swap |
| Collateral conversion | Aggregate maximum 20 bps plus documented venue fees | Refuse route beyond budget |
| State freshness | At most 10 seconds for actionable venue state | Refuse new risk when exceeded |
| Snapshot age | At most 30 seconds for preparation | Require re-quote and fresh simulation |
| Oracle age | No more than min(60 seconds, approved feed bound) | Block valuation actions; new feed review if infeasible |
| Oracle divergence | Above 1% between validated comparable sources | Halt new risk and inspect |
| Stablecoin divergence | Above 0.5% warning; above 1% stop new risk | Use measured FX; de-risk only with valid pricing |
| Margin stress | Must survive plus 30% MON shock and stressed fees without top-up | Reduce approved exposure or block launch |
| Negative carry | Negative 24-hour net carry estimate | Stop new Hull; review orderly exposure reduction |
| Junior cover | Below 30% warning; below 20% critical | Halt issuance and junior payouts; reduce or unwind |
| Protocol drawdown | 2% from cash-flow-adjusted high-water NAV | Enter wind-down review; automatic new-risk halt |

These are launch candidates that require calibration with real market granularity, latency, and executable depth. They are not claims that a 30% shock is the largest possible loss. If a threshold is incompatible with the venue, update the reviewed specification; never silently relax it in code. Display zero exposure as a separate idle state rather than dividing by zero or showing a perfect hedge ratio.

Capacity is the minimum of remaining beta budget, admissible Hull coverage, spot depth, perpetual depth, Perpl OI headroom, collateral conversion depth, withdrawable margin, loss-budget capacity, and operational capacity. Cap short notional at 1% of observed market OI and 5% of executable depth inside the slippage envelope, unless a stricter measured bound applies. Missing OI or unverified liquidity means unavailable capacity. Depth must be measured over time and under stressed removal of liquidity, not from a single screenshot.

## 11 Execution and custody

Own the Perpl account through a reviewed protocol-controlled contract arrangement that returns collateral only to AssetCustody or the dedicated collateral adapter. A governance multisig controls exceptional recovery through enumerated operations. A hot API trade key can request only approved MON orders. If Perpl cannot enforce the required account control or support that arrangement, external mainnet beta is blocked. Do not transfer user margin into a founder's ordinary EOA and label it non-custodial.

A trade-only API key can still destroy margin through abusive orders. State this explicitly. Require market restrictions, size limits, and bounded risk at the strongest supported venue/account boundary. When venue-native restrictions are incomplete, record the remaining compromise loss bound as the entire exposed margin, isolate the key in a signing broker, cap margin, and require an independent reviewer to assess that residual risk before launch. The broker cannot turn a software check into an onchain guarantee.

The keeper has a durable action journal and one active writer per venue account. Use PostgreSQL transaction locks and a monotonic fencing token checked by the signing broker. A second instance is standby; a simple Redis lease is not sufficient to prevent split-brain signing. The journal records inputs, block references, planned quantity, policy version, request IDs, order state, fills, reconciliation, and resulting delta. Use an outbox to couple persisted decisions with dispatch; venue delivery is at least once and reconciliation produces effectively once effects.

Open paired positions in slices. Prefund margin, validate both quotes, acquire a bounded spot slice, and short only the observed filled quantity. A failed hedge triggers cancellation and a compensating spot unwind within budget. If compensation is unavailable, enter UNHEDGED_ALERT and halt further slices. Do not describe asynchronous trading as atomic. On close, cancel open orders, reconcile both legs, and unwind in paired slices; avoid selling the entire spot leg while the short remains outstanding.

Every order has a persistent client request identifier, expiry, reduce-only intent where applicable, and exact quantity units. Before retrying after a timeout, query exchange state. A missing acknowledgement is not a failed trade. Partial fills, cancellation races, stale nonces, websocket sequence gaps, chain reorgs, and worker crashes all require reconciliation before the next action. Mainnet market IDs, precision, order semantics, and idempotency behavior come from current official documentation and replay tests. [S6, S7]

Pending orders count in worst-case exposure and reserved margin. Claimed delta must include native MON and WMON inventory, Kuru free/locked balances, in-flight fills, and the signed perpetual quantity without double-counting. Separate operator gas funds from strategy inventory. Test native receive callbacks and wrapping paths for reentrancy and unaccounted dust.

## 12 Oracle and evidence model

Use an approved independent onchain price input for MON and independently validated stablecoin FX, with freshness and confidence/deviation checks appropriate to the feed. Venue marks are needed for margin and venue PnL; an independent reference is needed for cross-leg risk. Document both. No specific oracle deployment is declared verified by this plan. If reliable USDC/AUSD valuation and conversion liquidity cannot be established, G03/G04 remain blocked.

For each book snapshot read all accessible same-chain contracts at one identified finalized block and block hash. If a venue state is only available at a different reference, include both observation times and expose PARTIAL or MISMATCH when skew exceeds policy. RPC disagreement blocks financial preparation; it is not resolved by blindly averaging values. Settlement must operate against valid current state and enforce conservative consistency bounds.

Proof of Hedge returns spot quantity, signed perp quantity, common reference price, signed delta, normalized delta, account identity, pending-order exposure, margin, valuation method, and source references. It proves an observed hedge under specified inputs; it does not prove future solvency, honest offchain execution, or absence of venue risk.

Use a shared tagged type: LIVE, STALE, UNAVAILABLE, PARTIAL, MISMATCH, or SIMULATED. Include schemaVersion, environment, chainId, blockNumber, blockHash, observedAt, source, units, and evidence references. Missing data has no numeric value. A cached last-good number may be shown only with its timestamp and stale label; it cannot authorize new risk.

Provide an independent CLI that reads RPC and contract data without the Vessel API, recomputes hedge and waterfall identities, and prints a machine-readable comparison. Save raw source evidence with content hashes for reproducibility. The indexer records finalized/reverted status and supports rollback and replay. Use a canonical event identity of chain ID, block hash, transaction hash, and log index; do not deduplicate solely by transaction hash.

## 13 Data and service design

Use PostgreSQL migrations for participants, wallets, invitations, consent versions, sessions, action intents, deposit and exit projections, series, snapshots, orders, fills, keeper actions, alerts, audit events, and transactional outbox records. Chain-derived tables are projections; API writes cannot change onchain claim ownership or NAV. Keep operational journals separate from indexer-owned tables and privileges.

Uniqueness constraints enforce wallet-to-participant ownership, intent idempotency, venue client request IDs, event identity, and session nonces. Store timestamps in UTC; money as explicit decimal strings or fixed-precision numeric values with units. Use request IDs across logs, intents, orders, and evidence. No private keys, API secrets, seed phrases, or raw wallet signatures in analytics logs.

Read APIs cover /v1/book, /hedge, /risk, /series, /positions, /requests, /capacity, /evidence, /history, /integrations, and /health. Auth APIs cover SIWE nonce, verify, refresh, logout, invitation status, and consent acceptance. Preparation APIs return typed unsigned intents. There is no public API to set NAV, mark a request paid, or trigger arbitrary keeper calls.

An intent includes ID, expiry, environment, chain, account, action enum, immutable terms hash, target address, selector, arguments, value, required allowance, expected effects, minimum output, fee estimate, state references, simulation result, and content digest. At signing, recompute allowlisted target and arguments from typed inputs; re-simulate if expired or stale. An intent digest is a consistency check, not proof of safety. Track chain receipts and replacements to completion; refresh optimistic UI state against canonical evidence.

Read caches use short TTLs and always retain source age. Capacity is advisory until the contract checks it. Rate limit public and authenticated endpoints separately. Validate all inputs, deny SSRF to private networks and metadata endpoints, use safe HTTP timeouts, and apply strict CORS, CSP, CSRF defenses, cookie settings, and payload-size limits. Public proof data may be anonymously read; personal invitation and support data may not.

## 14 Authentication and private access

Use wallet connection for viewing public chain positions and SIWE for private beta profile and consent actions. Validate domain, URI, chain ID, one-time nonce, issuance time, expiry, and recovered address. Support contract-wallet signatures through the appropriate verification path only after tests. A wallet connection is not an authenticated server session. [S11]

Choose secure HttpOnly SameSite cookies, 15-minute access lifetime, and revocable refresh sessions up to seven days, with rotation and theft detection. Logout revokes refresh state; wallet/account changes clear cached private queries and require new authentication. Invite codes are random, single-use, hashed at rest, and bound to a participant after wallet proof. Email is optional for support and must never become authority to transfer funds.

Each beta participant has one active funded wallet. BetaAdmission maps the wallet to an opaque participant ID and enforces stage, quota, and accepted policy version onchain. Avoid personal data onchain. Global admission bounds are authoritative even if a participant evades identity checks with another invitation. Record that per-person uniqueness is an operational control rather than a cryptographic Sybil guarantee.

Deposits need active eligibility; existing holders can still request and claim exits after an invitation expires. An eligibility revocation stops new subscriptions but does not confiscate or erase claims. Wallet recovery requires proof, documented governance review, and a holder-authorized migration when possible; there is no unauthenticated support reset. Loss of a private key is not silently repaired by the team.

Operators use a separate identity provider with MFA and separate network access. Multisig signing uses hardware wallets and separate devices. Frontend admin buttons prepare restricted actions; they do not hold signing keys. No shared global administrator password or production secrets in preview deployments.

## 15 App and design system

Preserve Vessel's existing instrument-like identity, wordmark, and approved landing-page assets after a repository/asset inventory. Hull remains steel and Ballast brass as semantic accents; accessibility must not depend on color. Extract a single token set for colors, spacing, type, borders, radius, number formatting, chart styles, focus, and motion. Do not borrow Markov's branding or introduce a separate Terminal aesthetic.

Use one responsive app shell, wallet connection component, network switcher, authentication state, risk banner, transaction drawer, error taxonomy, and notification system. Target desktop and 360-pixel mobile widths, keyboard navigation, reduced motion, and WCAG 2.2 AA contrast and interaction behavior. Prefer existing stable framework versions after security review; pin exact dependency versions and lockfiles in Session 1 rather than guessing latest versions here.

| Route | Complete user outcome |
|---|---|
| / and /how-it-works | Understand the product and follow the current live status |
| /onboarding | Redeem invite, prove wallet, read terms, check eligibility |
| /deposit | Compare risk, inspect capacity, preview, authorize, track admission |
| /portfolio | See Hull, Ballast, pending deposits, requests, and funded claims |
| /series/:id | Terms, rate derivation, subscription clock, maturity and settlement |
| /withdrawals | Request, cancel, inspect queue reason, and claim funded exits |
| /transparency | Recompute hedge, inspect balances, waterfall and evidence |
| /terminal | Book, hedge, carry, risk, series, tape and Opportunity Engine |
| /risk | Venue, liquidation, depeg, contract, key, liquidity and term risks |
| /health | Service health, source freshness and current operating mode |
| /docs and /developers | Verification recipe, SDK, MCP, integration guide |
| /activity and /support | Receipts, request IDs, troubleshooting and issue reporting |

Deposit flow: connect wallet, authenticate if required, confirm network and asset, choose tranche, inspect rate/first-loss and exit terms, enter amount, see capacity and minimum units, acknowledge policy, approve exact amount, submit, then track pending admission or refund. Show approvals and deposits as separate transactions. Never request unlimited allowance by default.

Transaction states are preparing, awaiting approval, awaiting wallet signature, submitted, confirming, finalized, replaced, reverted, cancelled, expired, and unknown. Unknown means reconcile; it must not invite blind resubmission. Deposit success means a receipt exists; admission success means units were actually minted. Withdrawal success means funded USDC is claimable or received, not merely that a request was created.

Every route must handle disconnected wallet, wrong chain, expired session, ineligible participant, cap full, insufficient balance/gas, closed series, queued junior exit, blocked minimum, stale oracle, indexer outage, venue outage, engine pause, and impaired series. Preserve entered values after recoverable errors. Refreshing the page restores request and transaction status from server and chain evidence.

Mainnet banner says PRIVATE MAINNET BETA and REAL FUNDS AT RISK, with exact review scope and date. Testnet says TESTNET, NO REAL VALUE, and the actual audit status. Never retain a no-real-value banner on mainnet. Do not show a fabricated APY, animated earnings without fresh accrual data, or healthy zeros during outages.

## 16 Terminal and Opportunity Engine

BOOK reconciles active capital, investor claims, reserve, fee liabilities, escrow, deployed assets and idle cash. HEDGE displays quantities, signed delta, open-order bounds, margin, and source block. CARRY separates funding, marked PnL, FX, fees, slippage, and realized returns. RISK shows limits, current values, source freshness, modes and intervention history. SERIES shows terms and rate derivation. TAPE combines chain events and separately labelled operational decisions.

The Opportunity Engine answers whether the approved strategy has positive expected net carry and executable capacity. Show gross funding estimate, observation window, expected trading and conversion costs, idle-capital drag, net book-equity carry, proposed Hull rate, subordination usage, liquidity capacity, confidence, and why entry is allowed or refused. Historical returns and forecasts are visibly different. Do not rank missing data as a zero-yield opportunity.

A command palette invokes typed read, verify, navigate, and prepare operations. Natural language is optional; the product is complete without an LLM. The model never invents prices, changes risk parameters, or executes trades. User text and external market metadata are untrusted data, not instructions to expand tool permissions.

## 17 MCP and distribution

Public MCP exposes book_state, hedge_state, risk_state, engine_state, market_state, funding_history, waterfall_history, hull_series, ballast_state, reserve_state, capacity, verify_hedge, verify_waterfall, verify_hull_series, and get_evidence. Methods return the same schemas as the API. Read and verify may be publicly available subject to abuse limits; portfolio/private data requires appropriate authorization.

Typed quote and prepare tools can construct Hull subscriptions, Ballast subscriptions, exit requests, cancellations, and claims after the preparation security gate. Public MCP never holds user keys, submits a transaction silently, exposes arbitrary calldata execution, or discovers operator tools. Preparation always returns the wallet authorization boundary and expiry. A host integration must be cold-tested before any compatibility claim. A working connector does not imply an AI-provider partnership.

For authenticated remote MCP, follow the current official transport and authorization requirements, validate intended token audience, never pass arbitrary third-party tokens through to internal services, and handle malicious tool inputs. Pin the supported protocol version and record host test dates. Read-only endpoints and authenticated preparation may be separate deployments if that makes the trust boundary simpler. [S12]

SDK methods reuse the same types and address manifests. Proof widget is sandboxed and read-only. The beta deposit embed provides a signed-context-free deep link into the first-party app with a validated referral code and requested action; the app independently rebuilds the quote. Never trust iframe postMessage without exact origin validation. Partners cannot set the recipient, spend approval, oracle, or routing address. Revenue-share accounting is designed but disabled during the beta; no affiliate reward can override eligibility or caps.

## 18 vUSD and svUSD testnet product

Implement the portable-dollar branch as an isolated testnet deployment using the same reviewed engine modules but a different custody book and liability ledger. USDC deposits into that book create vUSD claims; reserve and junior capital support the book under its own policy. Hull collateral is not simultaneously counted as backing another independent dollar liability. Do not simply mint vUSD against the total NAV already owed to Hull and Ballast.

V1 testnet minting is asynchronous and uses conservative verified backing after fees and haircut. Mint at most the supported dollar liability, with user minimum output and maximum delay. vUSD redemption burns or locks the claim through a request-and-funded-claim process with explicit liquidity constraints. A market peg is not established by a mint transaction. Test stablecoin FX changes, losses, insufficient backing, and pro-rata wind-down.

svUSD holds vUSD and issues staking shares. Yield enters only through realized distributable value from the dedicated book after required protection; it is not a privileged mint with no backing. Protect initial share price and donation behavior, enforce consistent reward accounting, and prevent front-running of distributions. Staking does not eliminate vUSD loss or redemption risk.

No admin mint, no hidden collateral reuse, and no testnet-to-mainnet bridge. Supply, backing, pending redemption liabilities, and staking liabilities are independently reconstructable. Show a complete deposit, mint, stake, unstake, redeem, and stress-loss demonstration. Mainnet manifest validation must fail if any vUSD/svUSD address, role, deployment artifact selection, or activation action is present. Mainnet activation is a future separate release requiring peg, liquidity, economic, security, and legal work.

## 19 Private beta admission and caps

The beta is staged. A cap limits admitted principal, not all possible future asset appreciation. Enforce both cumulative lifetime gross contribution budgets and active NAV/exposure gates. Gross subscriptions do not replenish after withdrawals or losses. Pending deposits reserve budget before transfer, refunds release only never-admitted reservations, and every entry path uses the same atomic accounting. Seed Ballast and explicit reserve contributions count against the global budget. Unsolicited transfers are quarantined and cannot increase deployment capacity.

| Stage | Maximum admitted lifetime contributions | Participants and limits | Graduation evidence |
|---|---|---|---|
| A Operator canary | 1,000 USDC | Team-owned funds only; no public solicitation | At least 72 hours, real hedge, collateral return, full exit and incident drill |
| B Private cohort | 5,000 USDC cumulative | Up to 10 participants; 500 USDC lifetime per external participant | Independent review; seven stable operating days; at least three independent users complete funded exits |
| C Capped beta | 25,000 USDC cumulative | Up to 25 participants; 2,000 USDC lifetime per external participant | First full 28-day Hull settlement, reconciliation and review of Stage B |

Team seed contributions have a separately declared aggregate allowance inside the global budget. They are not counted as independent demand. Publish founder concentration. At least 2% of intended active capital must be pre-funded reserve before Hull activation; target at least 30% junior cover after full-term coupon and stress close costs. Seed funds are committed capital with loss exposure, not an unfunded founder promise.

Stage transitions require a written gate packet and a 48-hour timelock. The immutable V1 maximum remains 25,000 USDC admitted contributions; higher exposure requires a new deployment and independent review. A smaller venue or loss limit always wins. Reaching a stage is optional, not automatic. If the team cannot fund seed or provide coverage, reduce the stage or remain on testnet.

Onchain checks enforce global budget, tranche capacity, wallet/participant allowance, market exposure, request reservation, and pause. Offchain invite checks are supplementary. Claim transfers are disabled, preventing simple transfer-and-redeposit quota recycling. Collusion or multiple identities remains a disclosed operational limitation; the global cap still bounds admitted funds.

Before invitations, counsel should review eligible participant jurisdictions, structured-return offering treatment, disclosures, privacy, and any screening obligations. No jurisdictional exemption is assumed from the phrase private beta. This document does not determine legal eligibility or replace that review. Beta consent explains possible total loss, delayed exits, key and venue risks, review scope, and absence of guaranteed repayment; consent is not a security control.

## 20 Permissions and emergency controls

Use a 2-of-3 governance multisig with independently controlled hardware keys and verified signer availability. Ordinary parameter and role changes wait 48 hours. Immutable hard ceilings constrain all governance-set values. Existing Hull terms cannot change. Guardian can immediately pause new admission, new risk, or settlement only where necessary; guardian cannot resume, transfer, mint, change recipients, or sweep funds.

Pause dimensions are separate: admission, risk increase, valuation settlement, and claims. Funded claims remain available during an ordinary risk pause. If ClaimEscrow itself is implicated in an exploit, a separate clearly documented emergency claim pause may be exercised and must be monitored. Do not market withdrawals as unstoppable while retaining a hidden all-purpose pause.

Emergency operator functions cancel orders, reduce exposures, withdraw to fixed custody destinations, and convert using bounded slippage with valid prices. They cannot route funds to an operator wallet. Governance may schedule lower caps; the guardian can immediately stop risk instead of waiting for that schedule. Resume requires verified reconciliation, reviewed cause resolution, and timelocked governance. A detected exploit can force a deployment retirement rather than a risky resume.

Audit every external-call target, allowance, delegate, operator enrollment, account owner, timelock proposer/executor, and token transfer exemption. Remove deployer privileges. Monitor changes to venue proxy implementations and external trust assumptions as well as Vessel contracts. No rescue function may transfer supported strategy assets, claim escrow, or admitted collateral to treasury.

## 21 Failure handling and runbooks

| Event | Immediate action | Recovery evidence |
|---|---|---|
| One hedge leg fills | Halt further slices; inspect actual position; compensate within policy | Reconciled quantities and signed delta |
| Venue outage | Stop openings, cancel where possible, preserve existing hedge | Reads and controlled unwind proven |
| Oracle stale or divergent | Freeze NAV-dependent actions; keep funded claims usable | Valid feeds and consistent snapshot |
| Indexer failure | Show stale history; continue direct verification | Replay to finalized head with no duplication |
| Stablecoin depeg | Mark actual FX; stop issuance and unsafe conversion | Executable liquidity and risk review |
| Margin deterioration | Cancel increasing orders and reduce paired exposure | Venue margin and delta within bounds |
| Key compromise | Revoke trade key and pause risk; use recovery owner | Revocation effective, unknown orders reconciled |
| Accounting mismatch | Freeze admission, settlement and unfunded payouts | Independent balance identity matches |
| Frontend or API outage | Publish status; provide verified direct claim tooling | Service recovery without accounting edits |
| Insolvency or venue default | Global wind-down and pro-rata class settlement | Real recoveries and cumulative distributions |

Each runbook specifies detection, automatic action, primary and backup owner, exact allowed commands/transactions, safety checks, communication owner, resumption gate, and evidence to preserve. Store runbooks where an operator can reach them if the main app is down. Incident messages must distinguish known facts from estimates and identify whether funds are frozen, exposed, or already lost.

Do not liquidate all spot merely because Perpl becomes unreachable. That may turn a hedged position into an uncovered short. If no safe action can be validated, stop new risk, retain evidence, and escalate. Emergency does not authorize unlimited slippage or blind value transfers.

## 22 Production operations and infrastructure

Deploy public app/API, MCP, indexer, keeper, signer, and sentinel as separate processes with least-privilege identities. Use separate environments, secrets, databases, and address manifests for local, testnet, and mainnet. Public app servers cannot reach signing credentials. Place the sentinel on an independent provider/RPC so one infrastructure outage does not blind execution and monitoring together.

Use managed PostgreSQL with encryption, point-in-time recovery, and restore drills. Back up configuration manifests and encrypted recovery material separately. Restore operational intent state before restarting a keeper and reconcile against live venues before signing. Database RPO target is five minutes for nonfinancial projections; the action journal must be durably committed before dispatch. RTO target is 60 minutes for API/history; financial risk response is automatic and must not wait for a database restore.

Use two independent RPC providers, explicit timeouts, circuit breakers, and finalized-state selection. RPC health must include disagreement and lag, not only HTTP availability. Protect the signing broker with authenticated service identity, network isolation, an allowlist of typed requests, request replay protection, and an auditable key rotation process. Use a signing technology supporting the required algorithm; do not assume a cloud KMS supports a particular Ed25519 flow without checking.

Operational targets: critical sentinel evaluation every 5 seconds when feasible, automatic new-risk halt within 30 seconds of confirmed critical breach, human acknowledgement within 5 minutes, and mitigation ownership within 15 minutes. These are targets to prove in drills, not promises that human response can prevent liquidation. If primary and backup coverage cannot be provided, do not maintain unattended market exposure.

Daily reconcile full custody, venue balances, positions, orders, H/B/R, fees, subscriptions, claims, and projections. Weekly publish anonymized capital, founder concentration, funding capture, execution cost, delta-band uptime, stale-data time, withdrawals and incidents. Track verified snapshots as the denominator for hedge adherence and separately report missing intervals; missing data cannot improve uptime.

Keep financial evidence and incident records according to the retention policy agreed with counsel. Default application telemetry excludes IP-to-wallet marketing profiles and AI conversations. Retain operational logs for 90 days and minimal audit evidence longer only as needed under the approved policy. Estimate infrastructure, independent review, seed capital, and operating coverage separately; do not treat grants or beta TVL as revenue or available operating cash.

## 23 Verification and security gates

The complete test strategy is driven by economic and authorization risks. Coverage percentages alone are not release evidence. Maintain an independent integer reference model for the waterfall and request lifecycle, with golden examples shared across Solidity and TypeScript. The reference must not simply call the implementation under test.

Mandatory invariants include conservation, custody reconciliation, no unsupported mint, no pooled-share escape, no unauthorized transfer, single recognition of venue equity and fees, caps across all entry paths, no junior payout below the projected cover threshold, no claimable exit without segregated funds, no old-holder dilution from stale pricing, no double settlement, bounded rounding, and no mainnet lab token activation.

Scenario tests include first depositor/donation manipulation; loss then recovery; positive G below coupon; reserve target crossing; full Ballast wipeout; Hull impairment; negative funding for 30 days; plus/minus 30% and 50% spot shocks; stablecoin depeg; thin depth; rejected conversion; partial fills; lost acknowledgements; websocket reconnect; two keepers; key rotation; stale oracles; RPC disagreement; reorg replay; paused claims; refund races; queue starvation; and all holders exiting around maturity. Stress shocks are test cases, not certified loss bounds.

CI runs deterministic unit tests, schema generation checks, static analysis, secret/dependency scans, contract invariants, adapter replay tests, and browser journeys. Nightly run at least 100,000 randomized lifecycle actions over recorded seeds plus extended invariant campaigns; retain failing seeds and shrink reproducers. Increase campaigns only to cover concrete untested behavior. Static warnings receive triage, not blanket suppression. Mainnet fork tests are pinned to block hashes and cannot substitute for live venue signing/withdrawal evidence.

Pre-beta review must cover contracts, economic model, venue custody, oracle assumptions, signing broker, admission caps, auth, deployment scripts, and wind-down. Use an independent qualified reviewer and record scope and limitations; do not label a narrow review a full audit. No unresolved critical/high findings or solvency/custody/withdrawal unknowns. Accepted medium findings need owner, rationale, mitigation, and explicit release disposition.

## 24 Release gates and launch sequence

| Gate | Required evidence | Failure result |
|---|---|---|
| R01 Specification | Frozen decisions, accounting vectors, state transitions | Continue local/testnet only |
| R02 Venues | Correct assets, account control, fills, collateral withdrawal | No mainnet capital |
| R03 Valuation | Independent sources and onchain reconstruction | No NAV-dependent actions |
| R04 Economics | Capacity, costs, 30-day rate history, stress models | Delay Hull or lower cap |
| R05 Security | Independent report and resolved material findings | No external deposits |
| R06 Claims | Deployed-liquidity exits and complete maturity rehearsal | No external deposits |
| R07 Operations | Monitoring, coverage, restore and incident drills | No unattended exposure |
| R08 Deployment | Two clean rehearsals, bytecode and role verification | Do not activate deployment |
| R09 Product | Cold mobile/desktop path and truthful labels | Fix before invitations |
| R10 Participation | Terms, eligibility and consent version | No external invitations |
| R11 Machine access | Cold MCP read/verify; separate prepare security tests | Disable unpassed tools |
| R12 Stage increase | Operating evidence and timelocked cap change | Remain at current or lower stage |

Prepare a reproducible release manifest containing source commit, dependency locks, compiler and optimizer settings, artifact hashes, chain ID, addresses, constructor arguments, linked libraries, external implementations, deployment receipts, role assignments, caps, oracle/feed IDs, market IDs, policy version, disabled modules, verification links, and reviewer disposition. Generate ADDRESSES.md from this manifest.

First rehearse from a clean machine on local fork/testnet. Repeat from a second clean environment and independently compare artifacts. Freeze the release candidate. Deploy mainnet with zero external admission and no automatic strategy activation, verify source/roles/configuration, and enroll monitoring. Only a reviewed GO packet can activate Stage A with team-owned funds.

Run the Stage A canary and a complete funded exit. Resolve any operational findings, then authorize Stage B only with all external-user gates passed. Seed reserve and Ballast, open the subscription window, activate the Hull series, and monitor the full 28 days. Advance to Stage C only after maturity and withdrawal evidence. The initial eight sessions can prepare all tooling; they cannot compress 30 days of data or a 28-day live maturity into a few development days.

Rollback means stop admission and new risk, reconcile, unwind, and settle or migrate through explicit holder action. It does not mean deleting a database row, rewriting financial history, or secretly replacing immutable contract logic. If a release fix changes critical code after review, repeat the affected security and deployment gates before activating it.

## 25 Ownership and execution sequence

Suggested accountability: Kunal owns product, user terms, public claims, beta cohort, and final release packet; Daksh owns protocol and integration delivery if agreed by the team. Assign an explicit risk reviewer, independent security reviewer, and primary/backup operations coverage before launch. Two founders do not automatically equal two independent reviews. Record actual owners and availability rather than assuming acceptance of these proposed roles.

| Session | Completed outcome | Dependency |
|---|---|---|
| 1 | Reconciled repository, frozen architecture, shared schemas, authenticated app shell | Existing repository and official sources |
| 2 | Executable accounting model and full local Hull/Ballast lifecycle | Session 1 contracts and decisions |
| 3 | Real venue execution, collateral route, custody and durable keeper | Session 2 core; verified external capabilities |
| 4 | Direct verifier, indexed history, APIs and reconciliation | Sessions 2 and 3 events and readers |
| 5 | Complete consumer app, Terminal, Opportunity Engine and operations UI | Canonical APIs and contracts |
| 6 | MCP, SDK, proof widget and isolated vUSD/svUSD testnet lifecycle | Shared data and authorization boundaries |
| 7 | Security candidate, production infrastructure and incident rehearsals | Complete tested system |
| 8 | Reproducible release packet, staged activation tooling and beta operations | Independent review and release gates |

A session is an outcome-bounded work unit, not a promise to finish in one chat context or one day. If context runs out, resume the same session from its checkpoint until its deliverable passes. Do not create many small prompts that lose architectural continuity. Finish a useful vertical feature in each session; blocked external work must remain explicitly blocked while independent work continues.

## 26 Required supporting documents

Session 1 imports this blueprint into docs/spec/VESSEL_V1.md and creates a requirements-to-test matrix. Each subsequent session updates the canonical documents in the same commit as behavior changes. Documentation must describe what the code does and show live evidence separately from intended behavior.

| File or directory | Required content |
|---|---|
| AGENTS.md | Build rules, authority order, tests, commits and stop conditions |
| docs/DECISIONS.md and docs/adr | D01-D18 plus reviewed changes |
| docs/FACT_CHECKS.md | Claim, source, date, environment, onchain check and uncertainty |
| docs/ARCHITECTURE.md | Boundaries, deployment topology and data flow |
| docs/ACCOUNTING.md | Units, NAV, G, fees, waterfall, rounding and worked vectors |
| docs/STATE_MACHINES.md | Events, guards, transitions and emergency semantics |
| docs/INTEGRATIONS.md | Pinned ABIs, assets, market metadata, custody and failure paths |
| docs/SECURITY.md and docs/THREAT_MODEL.md | Privileges, threats, findings, residual risks and disclosure route |
| docs/API.md and docs/MCP.md | Versioned schemas, intents, examples and host matrix |
| docs/UX.md and docs/AUTH.md | Shared components, journeys, states and session boundaries |
| docs/RISK_PARAMETERS.md | Units, authority, candidate values, calibration and limits |
| docs/BETA.md and docs/RELEASE_GATES.md | Caps, cohort, evidence, review and GO packet |
| docs/ADDRESSES.md and deployments | Generated manifest and verified source/role evidence |
| docs/runbooks | Pause, de-risk, key compromise, maturity, restore and incident response |
| docs/TEST_PLAN.md and evidence | Exact commands, results, seeds, reports and transaction references |
| docs/BUILD_STATUS.md and docs/sessions | Completed work, blockers, commits and next resume instruction |
| docs/KNOWN_LIMITATIONS.md | Actual custody, liquidity, review and reliability limits |

## 27 Build prompt operating contract

The companion prompt pack contains eight numbered prompts and one common operating contract automatically included in each standalone prompt file. Use them in order inside the actual Vessel repository, with this blueprint available. They instruct the coding agent to inspect the repository, preserve user work, verify facts, implement complete slices, test meaningful risks, document changes, and make scoped commits using the configured author without Co-authored-by trailers.

Do not paste all eight sessions as one task and accept scaffolding as completion. Start Session 1, review its concrete evidence and blockers, and continue in order. Sessions may overlap only after stable shared interfaces exist and repository coordination is explicit. Running the prompts does not replace independent security review or authorize uncontrolled mainnet spending.

The full prompt text is included after the source register in the Word edition and in separate copyable Markdown files in the build pack.

## 28 Source register

Project sources read for this revision: Vessel Product Bible v1.0; Technical Bible v1.0; Metropolis Playbook v1.0; Master Reference v1.1 Terminal MCP Amendment; Access Layer Book 19 v1.1; and Complete Build Plan Book 20 v1.0. These establish the historical product direction, not verified current repository state.

Official sources consulted on 22 September 2026 are listed below. External facts must be checked again at implementation and deployment. Risk limits, caps, allocations, and implementation decisions in this blueprint are design recommendations rather than values certified by these sources.

| ID | Official source | Use |
|---|---|---|
| S1 | https://docs.monad.xyz/developer-essentials/network-information | Chain configuration |
| S2 | https://developers.circle.com/stablecoins/usdc-contract-addresses | Native USDC reference |
| S3 | https://docs.kuru.io/contracts/Contract-addresses | Tokens and market addresses |
| S4 | https://docs.kuru.io/contracts/Router | Router versus market integration semantics |
| S5 | https://github.com/PerplFoundation/api-docs/blob/main/integrations.md | Key enrollment, scopes and delegated accounts |
| S6 | https://github.com/PerplFoundation/api-docs | Mainnet configuration and market context |
| S7 | https://github.com/PerplFoundation/api-docs/blob/main/websocket.md | Trading transport and message semantics |
| S8 | https://eips.ethereum.org/EIPS/eip-4626 | Tokenized-vault standard boundaries |
| S9 | https://eips.ethereum.org/EIPS/eip-7540 | Async request and claim standard reference |
| S10 | https://docs.openzeppelin.com/contracts/5.x/erc4626 | Inflation and rounding defenses |
| S11 | https://eips.ethereum.org/EIPS/eip-4361 | Wallet sign-in requirements |
| S12 | https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices | MCP security boundaries |

The readiness answer at the end of any session must be one of: local complete, testnet evidenced, review candidate, canary eligible, external beta eligible, or blocked. Production ready is reserved for a specific frozen release that has passed its stated gates; it is never a synonym for code generated.
