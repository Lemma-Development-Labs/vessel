# Vessel Complete Product and Company Handbook — engineering extract

Version 4.0 · 30 September 2026 · **Public engineering extract.**

This file contains chapters 1, 4, 5, 6, 7, 11, 12 of Handbook v4 verbatim, except one
redacted paragraph. Chapters 2 (product and user experience), 3 (economics and
business model), 8 (go to market), 9 (roadmap, company and fundraising) and
10 (investor questions and pitch) are **omitted** because they hold private
company, budget and financing material. Nothing in the omitted chapters changes
engineering policy: product policy comes from [spec/VESSEL_V1.md](spec/VESSEL_V1.md),
and the one Handbook policy change — **D30**, inbound supported-chain funding —
is in Chapter 6 below and in [DECISIONS.md](DECISIONS.md).

Source: `Vessel_Complete_Handbook_v4.md`, SHA-256 `5dc37529bb1ea8cf0a3446bdbfbea28a746acaf5c4fadd3e10da9097a27f292c`
(full private file, 30 Sep 2026). Chapter numbering and cross-references are
kept as in the source, so a reference to an omitted chapter points to private
material.

## Authority and interpretation

The 22 September 2026 Product and Production Build v2 remains the detailed inherited engineering baseline [P1]. The 23 September company pack supplied commercial planning and investor explanations [P3]. This handbook consolidates that material, incorporates repository evidence inspected on 29 September and a default-branch check on 30 September, and adds the supported-chain decision [D30].

The specific scope change is that inbound supported-chain deposits are now in the complete V1 build and may be activated after their gates pass. This supersedes P1's blanket V1 exclusion of cross-chain capital movement for this inbound feature only. The core remains one Monad MON strategy, with the same lifetime beta contribution ceiling, participant limits, senior and junior claims, and isolated testnet vUSD branch. Outbound cross-chain withdrawals, remote claim tokens, additional trading markets, and a proprietary exchange require later decisions.

We distinguish five statuses. **Design requirement** describes intended behavior. **Repository observed** means a specific file at a known commit supports the statement. **Founder reported** identifies history not independently corroborated here. **Planning assumption** marks forecasts, budgets, target metrics, and suggested assignments. **Activation blocked** means a needed proof or parameter is not yet available. A design requirement is not evidence that a feature is deployed.

The handbook does not certify live positions, current app uptime, mainnet readiness, customer assets, revenue, audit completion, or financing. Source inspection is a scoped review, not a complete code audit. Production decisions require the release evidence described here.

# 1 Current status and release decisions

## The implementation we could inspect

The protocol repository's main branch resolves to commit c4c18189d52e873f7a0b7830dbf5d1f019c0b395, dated 2 September 2026, in a check on 30 September. Its README identifies a demo-dollar testnet prototype. It describes MockRouter and MockWMON for spot behavior, SimVenue for short-leg funding, and a Perpl integration stub. The inspected PerplVenue.stub.sol trading methods revert with NotImplemented. The README's own live test claims are historical repository statements; we did not rerun them or independently match current deployed bytecode [G1–G3].

That evidence establishes that a prototype codebase exists and describes its boundaries. It does not prove that newer work is absent from another branch or deployment. Before implementation, inventory all relevant branches, artifacts, environments, and deployed contracts. Classify each requirement as demonstrated, partial, absent, or blocked with an evidence link.

| Area | Observed or inherited status | Required next proof |
|---|---|---|
| Demo-dollar vault and tranches | Present in inspected prototype repository | Reconcile implementation with current production economics |
| Real Kuru spot execution | Required by target design | Actual fills balances and bounded unwind |
| Real Perpl short and custody | Stub in inspected implementation | Account control execution revocation and collateral return |
| Mainnet private beta | Design and stage limits defined | Complete independent review and release gate packet |
| Cross-chain inbound deposits | Included in V1 scope by D30 | Provider qualification destination adapter and recovery evidence |
| vUSD and svUSD | Isolated testnet design | Separate lab implementation and liability proof |
| Customers revenue and financing | Not established by reviewed evidence | Dated ledgers agreements and beneficial participant records |

## Public claims that must follow evidence

The landing repository inspected on 29 September contains decorative funding and block counters, static APRs, and static multi-asset positions. Its v2.js updates the counters without a chain feed [G4]. Public copy must label illustrative data where it appears or remove it. A simulated testnet return is not realized investment income. A source block must be read from the relevant chain, not incremented in a browser timer.

The production specification uses 28-day Hull terms, custom asynchronous claim interfaces, one MON market, and no mainnet vUSD in this release. Do not carry forward the landing page's 90-day term, unconditional ERC-4626 claim, multi-market live book, or dated vUSD mainnet promise. A testnet prototype can legitimately use different contracts, but its description must identify that version.

The external story is that Vessel is building verifiable structured yield on Monad, with approved cross-chain funding paths included in the release plan. Describe Kuru and Perpl as intended execution venues until integration evidence establishes actual use. We are not building our own spot DEX, order book, bridge network, or permissionless solver marketplace.

## Decisions inherited and added

Hull's contractual rate is subject to loss and ends accruing at maturity or earlier emergency termination. Ballast takes first losses, then reserve, then Hull. Reserve is limited capital rather than insurance. The fee is 10% of eligible positive strategy gains after prior gross losses; reserve replenishment comes from within that fee. Pooled shares cannot bypass the two investor claims. Mainnet custody, valuation, and withdrawals must work before external capital enters.

The D30 addition keeps cross-chain risk outside the active strategy until accepted USDC reaches Monad and is admitted. The destination request uses the same beneficiary rules, cap accounting, and capacity tests as a native deposit. A route failure cannot be hidden by minting an unfunded Hull or Ballast position. Route integration is a deliverable in this V1 build; route activation is a separate, evidence-based decision.

# 4 Economic logic and worked engineering examples

## What a delta neutral book earns

Let qS be MON spot quantity and qP be signed MON perpetual quantity, with shorts negative. At a common reference price p, delta value is (qS + qP) × p. Normalized signed delta is that value divided by active NAV A; multiplying by 10,000 expresses it in basis points. An idle book has no active hedge and must display IDLE rather than a misleading perfect hedge percentage. Pending orders require a worst-case fill calculation in addition to the current filled delta.

For 1,000 MON spot and a short of 990 MON, net delta is positive 10 MON. At an illustrative price of 2 USDC, that is 20 USDC. With 10,000 USDC active NAV it is 0.2%, or 20 basis points. Normalizing by spot notional would produce another ratio, so every API must name its denominator. Wrapped or staked assets need a verified conversion into underlying exposure; a count of wstETH is not automatically the same number of ETH.

Funding is paid on perpetual notional, while investor return is measured on book equity. With 10,000 USDC active NAV, an illustrative 45% spot and 45% margin allocation means a short notional near 4,500 USDC. A hypothetical annualized 20% funding rate on that short contributes approximately 900 USDC a year before all other effects, or 9% on the book, not 20%. Funding can reverse, exposure can change, and rates do not stay constant. The book's marked spot gain and short loss may offset, but costs, basis, liquidation, stablecoin FX, and execution gaps can defeat that simplification.

## Settlement inputs and sequence

The settlement function accepts a validated snapshot, recognized H, B and R, previous loss carryforward L, time and principal for accrued coupon C, and cash-flow-adjusted strategy result G. All values use exact integer units. G is already net of venue and execution costs but before this epoch's performance fee. Do not subtract those costs again inside the waterfall.

The following sequence is normative for the inherited policy. First calculate eligible gains E = max(G − L, 0) and next loss carryforward Lnext = max(L − G, 0). Calculate the pre-settlement reserve deficit D = max(0, 0.02 × (H + B + R) − R). Candidate fee F = 0.10 × E, candidate reserve retention FR = min(0.50 × F, D), and treasury fee FT = F − FR. Existing impairment or wind-down forces all three fee values to zero.

For candidate fees, set S = G − F − C. If S is nonnegative, set Hnext = H + C, Bnext = B + S, and Rnext = R + FR. If S is negative, the amount needing support is −S. Consume B first, then R + FR, then reduce H + C by the remaining shortfall. Balances may not become negative. A result that exceeds all available assets triggers explicit insolvency handling and cannot be concealed by flooring a negative book to zero.

If the candidate allocation reduces Hull below H + C, repeat the entire allocation with F = FR = FT = 0. Determine final impairment from that second allocation, not from the fee-charging pass. This avoids charging a fee that creates or enlarges senior impairment. Prior gross loss carryforward still follows Lnext; fee waiver does not erase historical strategy losses or create an invented deferred fee credit.

After the final pass assert Hnext + Bnext + Rnext + FT = H + B + R + G. Treasury cash payment later reduces a previously recognized liability outside active NAV; it is not a second fee or another strategy loss. No holder payout or NAV-dependent admission may occur against an invalid snapshot.

## Settlement test vectors

These are illustrative USDC-equivalent units, using a 2% reserve target on starting active NAV and no prior impairment. Some start in intentionally stressed states that would not pass new-admission checks. Semicolons separate the three values named in each column header.

| Case | Start H B R | G and C and prior L | Final H B R | Treasury fee |
|---|---|---|---|---|
| Positive return | 7000; 3000; 200 | 100; 20; 0 | 7020; 3070; 204 | 6 |
| Positive return below coupon | 7000; 3000; 200 | 10; 20; 0 | 7020; 2989; 200.5 | 0.5 |
| Strategy loss | 7000; 3000; 200 | −100; 20; 0 | 7020; 2880; 200 | 0 |
| Reserve needed | 7000; 30; 200 | −100; 20; 0 | 7020; 0; 110 | 0 |
| Senior impairment | 7000; 30; 20 | −100; 20; 0 | 6950; 0; 0 | 0 |
| Loss recovery | 7000; 3000; 200 | 100; 20; 120 | 7020; 3080; 200 | 0 |
| Partial fee after recovery | 7000; 3000; 200 | 100; 20; 40 | 7020; 3074; 203 | 3 |
| Fee waiver at senior boundary | 100; 0; 0 | 10; 20; 0 | 110; 0; 0 | 0 |

In the first row, eligible gain is 100 and fee is 10. Starting NAV is 10,200; its 2% reserve target is 204. Reserve receives only 4, although half of the fee would be 5. The other 6 belongs to treasury. The conservation check is 20 + 70 + 4 + 6 = 100.

In the final row, charging a fee would leave Hull with 109 against an entitlement of 120. The second pass waives all fees and assigns the actual 110 assets to Hull. There is still impairment, but no fee worsens it. This row is a loss-allocation test, not an admissible starting capital stack.

## Coupon and rate calculations

For principal P, annual simple rate r, and eligible elapsed seconds t, coupon is P × r × t / 31,536,000. A 1,000 USDC Hull principal at an illustrative 8% rate for exactly 28 days accrues 6.136986 USDC before final payout rounding. That rate is an example, not Vessel's current quote. The 28-day rate is approximately 0.6137%; it must not be advertised as 8% earned during the term.

Compute cumulative accrued coupon from activation to min(current time, maturity, emergency termination), then subtract coupon previously recognized. Use high-precision fixed-point intermediates and carry fractional residuals consistently. Repeated settlement must not lose coupon repeatedly through truncation. Final user-level dust has a documented destination and bound; the sum of holder claims cannot exceed the class allocation.

The inherited Hull rate rule is min(15%, max(0, 0.60 × EWMA net annualized carry)), using at least 30 consecutive days of source history and a 30-day half-life. For regular hourly samples, the exponential decay factor is 2 raised to minus 1/720. Define each sample from realized funding less attributable costs over average deployed book equity for that interval, then annualize using a documented day-count convention. Keep raw values and coverage; do not annualize a missing observation or treat offchain subsidies as yield.

Publish the exact EWMA initialization, missing-data rule, price inputs, interval durations, cost assumptions, and dataset digest in the release manifest. These implementation conventions need a reviewed formula artifact before first issuance; a broad statement of half-life is not enough to recreate a quote. History must be real and environment-specific. A mocked funding series cannot justify a mainnet contractual rate.

## Forward pricing of Ballast

For a simplified pool with settled junior NAV B and supply Q, a deposit d buys floor(d × Q / B) units; a redemption of q units receives floor(q × B / Q), before specifically disclosed transaction costs. Production uses the reviewed virtual asset and virtual share offsets described in the core design. Those offsets and the seed amount must be fixed in the release specification rather than selected casually from this example.

Suppose Ballast has B = 3,000 and Q = 3,000, then the book suffers a 300 loss before a new user's 300 deposit is admitted. Settle first: price is 0.9 and the newcomer receives approximately 333.333333 units. Existing holders keep their prior loss. Minting at the old price of 1 would give only 300 units and transfer value unfairly to old holders. A pending deposit is excluded from B until admission.

If a user queues 100 units at price 1 and price falls to 0.9 during cooldown, the request is worth 90 before fees and constraints. If only 45 USDC can be safely funded, burn 50 units, move 45 to claim escrow, and keep 50 units exposed. The remaining amount is not a fixed debt of 45. Users can cancel remaining unfunded units according to queue rules. If B reaches zero while Q remains positive, ordinary deposits are blocked pending wind-down or a separately reviewed recapitalization.

## Coverage and payout capacity

Junior cover is B / (H + B); reserve is excluded. The 30% issuance and voluntary payout buffer must hold both now and after projected full remaining coupon and stressed closing costs. The 20% floor triggers intervention; it cannot prevent market prices from moving the book below that floor.

A conservative planning calculation assumes zero future gross strategy gain, remaining Hull coupon Cfuture, and closing cost K charged first to Ballast. For a junior payout x, projected balances are Hp = H + Cfuture and Bp = B − Cfuture − K − x. Require Bp >= 0 and Bp / (Hp + Bp) >= 0.30, as well as current cover, liquidity, and margin limits. This model is an additional conservative capacity test, not a promise about future return or a replacement for a more adverse stress model.

Solving that inequality gives x <= [B − Cfuture − K − 0.30 × (H + B − K)] / 0.70. Negative results mean zero voluntary payout capacity. For H = 6,000, B = 4,000, Cfuture = 100, and K = 50, the bound is 1,235.714286 before rounding down. Current cover alone would allow 1,428.571429; ignoring future obligations would overstate safe payout capacity. Actual funded payout is the minimum of these bounds, eligible queue demand, available unencumbered USDC, and all remaining risk limits.

For new Hull principal y with term rate c = r × 28/365 and no existing series, test Hp = H + y × (1 + c), Bp = B − y × c − K, and the same 30% ratio. Use the actual release stress model and integer rounding. A closed-form result is a sizing aid; only an onchain check at admission can authorize money movement. Reserve is never quietly added to the junior numerator to pass coverage.

## When a number is not yet specified

The document fixes inherited headline limits and the supported-chain accounting boundary. It does not invent verified venue depth, feed deployment, provider recovery timeouts, token offsets, execution fee schedules, or named operator availability. Every unresolved launch parameter must become a typed manifest value with units, owner, evidence, test, and review disposition. Until then the relevant action stays blocked. Engineers may implement the surrounding interface but may not fill a production parameter with a plausible-looking default.

The accompanying reference_model.py uses integer micro-USDC units to demonstrate settlement, selected coverage calculations, and admission reservation behavior. The production baseline uses higher-precision internal valuation and verified native token units. Passing this educational model's vectors does not validate contracts, venue integration, signing, oracle trust, cross-chain security, or full lifecycle fairness.

# 5 Architecture and engineering

Vessel V1 should use one canonical accounting and risk model across its contracts, services, app, Terminal, SDK, and MCP. Custody and claims belong to the protocol. Public interfaces read or prepare actions. A separate execution system operates within explicit permissions. This document summarizes the production architecture established in the v2 build baseline [P1]; it is an intended architecture. Chapter 1 reports the separate, scoped repository observations. Chapter 6 adds the supported-chain adapter and escrow boundary.

## System decomposition

| Layer | Components | Responsibility | Authority boundary |
|---|---|---|---|
| Experience | Consumer app, Terminal, shared UI | Explain state and guide actions | No custody or operator keys |
| Access | API, SDK, MCP, proof widget | Serve canonical data and typed preparation | No arbitrary execution |
| Evidence | Direct verifier, indexer, archive | Reconstruct state and expose history | Cannot declare authoritative NAV |
| Protocol | Custody, controller, tranches, queues, escrow | Enforce claims and money movement | No generic external-call escape |
| Execution | Venue adapters, keeper, signing broker | Maintain approved strategy | Fixed markets and destinations |
| Oversight | Sentinel, guardian, multisig, timelock | Detect failures and control policy | Pause and governance powers separated |

The browser and public services cannot connect to the signing broker. The database and indexer are rebuildable projections for financial accounting. A service outage may interrupt access or operations, but cannot justify rewriting balances. Onchain valuation must securely reconstruct required assets, positions, orders, and liabilities. If the necessary state cannot be read or validated, launch is blocked. An attested NAV model would be a material trust-model change requiring its own design review.

## Repository and stack

Use the existing repository and preserve working interfaces where they meet these boundaries. The target stack is Solidity with Foundry for contracts, TypeScript for shared schemas and services, PostgreSQL for durable operational state, Envio for indexed history, and containerized long-running execution services. Retain an existing proven keeper language if its interface and parity tests are safer than a rewrite. Pin exact dependency and compiler versions during implementation.

| Path | Ownership |
|---|---|
| contracts/core | Custody, controller, Hull, Ballast, reserve, requests and claims |
| contracts/venues and contracts/risk | Pinned external adapters, policy and valuation |
| contracts/lab | Isolated vUSD and svUSD testnet code |
| apps/web | One app shell, consumer flow, Terminal and operations UI |
| services/api, keeper, signer, sentinel, mcp | Separately deployed processes and identities |
| packages/domain, config, math, risk-policy | Shared units, schemas, rules and manifests |
| packages/sdk and packages/ui | Integrator interface and reusable UI |
| indexer, scripts, tests, docs | Projections, releases, validation and evidence |

Build ABIs from pinned contract artifacts. Generate address configuration from a release manifest. Keep environment selection explicit and fail startup on inconsistent chain, assets, schema, or module permissions. Production configuration must reject test fixtures and lab token addresses.

## Contract responsibilities

**AssetCustody** holds supported active assets and tracks transfers to pinned adapters. Pending deposits and funded claims are segregated. There is no public pooled share allowing holders to bypass the Hull and Ballast waterfall.

**TrancheController** admits deposits, coordinates settlement, issues and burns claims, and checks policy. **HullSeries** stores immutable series terms and principal units. **BallastToken** represents junior ownership and locks redemption units. Beta token transfers are limited to mint, authorized controller escrow, and burn paths.

**RequestQueue** owns request states, reservations, deadlines, cooldowns, priority, and partial fills. **ClaimEscrow** holds already-funded USDC for fixed authorized receivers. It cannot lend or redeploy that USDC. **ReserveLedger** records subordinated reserve capital and deterministic use. There is no treasury reserve withdrawal during the beta.

**EngineManager** sets permitted target exposure and engine modes. **KuruAdapter**, **CollateralAdapter**, and **PerplAccountAdapter** implement narrow actions on reviewed contracts. Their recipients are protocol destinations. **ValuationAdapter** combines vetted prices and venue equity without accepting arbitrary keeper NAV. **BetaAdmission** atomically enforces participant and lifetime budgets.

The guardian can pause specified actions immediately. It cannot resume, transfer, mint, redirect claims, or change existing terms. A 2-of-3 governance multisig uses a 48-hour timelock for ordinary changes within immutable ceilings. No proxy upgrades exist in the V1 core. Material changes require a new reviewed deployment and explicit holder migration.

## Public operation model

The intended methods include requestDeposit, cancelDeposit, processDepositBatch, requestBallastRedeem, cancelRedeem, processExitBatch, claim, settle, and closeMaturedSeries. They are design interfaces to reconcile against code, not assertions that these signatures already exist. Each request stores owner, receiver, amount or units, minimum output, deadline, tranche or series, state, and unique identifier.

Every money-moving call checks ownership, chain configuration, request status, allowed asset, recipient, deadline, pause dimensions, economic capacity, and quota. Use safe token handling, reentrancy defenses, bounded work, and explicit errors. Claim receivers cannot be changed by the operator. Fresh holder authorization is required for a receiver change.

V1 exposes custom asynchronous interfaces. Do not advertise ERC-4626 or ERC-7540 compliance simply because a function resembles a standard. Term claims, previews, redemption restrictions, and operator behavior require a full conformance review before a future wrapper makes that claim.

## Accounting implementation

Use integer token units at transfer boundaries and normalized fixed-point USD values internally. Value USDC at its measured USD price when converting to USDC-equivalent NAV. Money and quantities travel as decimal integer strings through JSON. Never use JavaScript Number for economic computation.

Define A as active net assets, H as recognized Hull NAV, B as Ballast NAV, and R as reserve NAV. After settlement, A = H + B + R. Pending subscription escrow, funded claim escrow, and treasury fee liabilities sit outside A. Separately reconcile every physical asset and liability across custody and venues.

For an epoch, G is the change in active assets before new fees, adjusted for admitted subscriptions, reserve contributions, and investor assets moved out to funded claims. Transfers between custody and a venue are internal. Spot PnL, perp PnL, funding, conversion FX, fees, and slippage enter once. A donation cannot masquerade as income.

Track a nonresettable book-level loss carryforward L. Fee eligible gains equal max(G − prior L, 0), and next L equals max(prior L − G, 0). The total fee F is 10% of eligible gains. Up to half of F can replenish reserve to its 2% target. Treasury receives only the remainder FT. The conservation test is change(H) + change(B) + change(R) + FT = G.

Accrue the Hull coupon C. Allocate net result G − F against that coupon. Ballast absorbs any shortfall, followed by reserve, followed by Hull. If the proposed settlement impairs Hull, recompute the entire epoch with all fees zero. Freeze fee accrual during impairment and emergency wind-down. Tests must cover positive gains below the coupon as well as outright strategy losses.

## State machines and timing

| Object | Main lifecycle | Important failure behavior |
|---|---|---|
| Hull series | Draft, subscription open, active, matured unwinding, claimable, closed | Cancel before activation or enter impaired recovery |
| Subscription | Requested, escrowed, admitted or refundable, claimed refund | Never deploy unadmitted funds |
| Ballast exit | Requested, cooling, eligible, partially funded, funded, claimed | Keep remaining units exposed and cancellable |
| Engine | Idle, opening, hedged, rebalancing, closing, paused, wind-down | Unknown order state forces reconciliation |
| Observation | Live, stale, unavailable, partial, mismatch, simulated | Missing numeric values cannot authorize actions |

Hull activation follows a 72-hour window and fixes the 28-day maturity. No later Hull subscription can join that series. Ballast deposits use forward-priced batches after settling existing holders. Ballast exits require 48 hours and valid current liquidity and coverage. Partial processing burns only funded units. Requests with an unmet user minimum do not block the entire queue.

At maturity or termination, senior distributions are proportional across the class. Later recoveries use cumulative per-unit accounting so earlier claimers do not obtain priority over others. Ordinary coupon accrual ends at maturity, or earlier at the recorded emergency termination time.

## Venue execution and key custody

The intended mainnet route accepts USDC, acquires MON spot on Kuru, converts required collateral to AUSD, and shorts MON on Perpl. P1 documents this route, but exact market metadata, contract ownership, prices, liquidity, and withdrawal behavior remain deployment gates. Testnet market IDs and assets must never become mainnet defaults.

Perpl documents scoped API keys and delegated accounts [E4]. This does not prove that Vessel's required contract-owned account and fixed-destination recovery work. Demonstrate them with actual deposits, orders, revocation, and withdrawals. If safe protocol-controlled custody cannot be established, external beta remains blocked. A founder EOA holding user margin would be a different custody model.

A trade-only key can destroy margin through hostile trades even without withdrawal rights. The signing broker enforces permitted market, notional, expiry, intent, and replay checks. Venue-native enforcement is preferable where available. If not all constraints are enforceable by the venue, disclose the residual compromise bound as the exposed margin and review it independently.

Open in small paired slices. Prefund margin, validate both sides, buy a bounded spot amount, then short the observed filled quantity. A failed short triggers bounded compensation or an unhedged alert. Closing also uses paired slices. Never describe asynchronous venue execution as atomic. USDC-to-MON-to-AUSD conversion is acceptable only when both conversion legs execute atomically under an aggregate output floor, or a separately reviewed route replaces it.

## Durable execution and recovery

One writer controls each venue account. A PostgreSQL transaction lock and monotonically increasing fencing token identify the active writer; the signing broker rejects stale writers. Persist decisions before dispatch through a durable outbox. The journal stores policy version, source observations, client request ID, exact units, expiry, order state, fills, reconciliation, and resulting exposure.

Network delivery may happen more than once. Economic effects become effectively once through persistent identity and venue reconciliation. A timeout is unknown, not failed. Query actual orders and fills before resubmission. Handle partial fills, cancellations racing fills, websocket gaps, reorgs, worker crashes, and standby promotion explicitly.

Restore journal state before restarting a keeper. Fence the previous instance, reconcile real venue state, and only then sign new orders. The indexer rebuild cannot restart trading by itself. Test that a database restore, old queue message, or two workers cannot create duplicate exposure.

## Evidence and data contracts

Each response carries schemaVersion, environment, chainId, blockNumber, blockHash, observedAt, source, units, status, and evidence references. Use an identified finalized block where possible. If venue observations differ in time, expose the skew and mark partial or mismatch when policy is exceeded. Do not conceal RPC disagreement by averaging values.

Proof of Hedge reports spot quantity, signed perpetual quantity, pending-order exposure, common reference price, delta, margin, account identity, and source references. A separate CLI recomputes results directly from RPC and contract state without the Vessel API. Store raw evidence with content hashes. Hashes support reproducibility; they do not turn false inputs into truth.

The API and indexer serve fast portfolio and history views. They cannot set settlement prices. Event records include transaction hash, log index, block identity, and finalized/reverted status. Enforce uniqueness and support rollback and replay. Separate operational decisions from chain-confirmed events in the activity feed.

## Authentication app and machine access

Use one wallet connection flow and one SIWE session across the consumer app and Terminal. Bind the nonce, domain, URI, chain, expiration, and session to the intended origin. Nonces are single-use. Use secure HTTP-only cookies, CSRF protection where needed, exact CORS origins, rate limits, and session invalidation. Signing in does not authorize spending.

The action pipeline is quote, validate, simulate, wallet authorize, submit, reconcile. Bind preparation to chain, target contract, ABI or method, owner, receiver, amount, minimum output, deadline, and policy version. A stale quote requires reconstruction. Keep allowance approval distinct from depositing. Refreshes must restore request status rather than submit again.

MCP begins with read and verify methods. Typed unsigned preparation has its own security gate. No arbitrary calldata, recipient substitution, token passthrough, silent transaction submission, or user key custody is permitted. A malicious document or market name is data, never an instruction to widen permissions. Host compatibility requires cold testing and does not imply a provider partnership.

## Infrastructure and acceptance

Separate app/API, MCP, indexer, keeper, signer, and sentinel deployments and service identities. Keep production secrets absent from previews. Use independent RPC providers and place the sentinel in a separate failure domain. PostgreSQL has encrypted backups and tested restoration. The action journal must be durable before dispatch even when history projections have a five-minute recovery-point target.

Engineering acceptance requires an independent reference model, differential arithmetic tests, lifecycle invariants, adversarial access-control calls, fork integration tests, real venue exit evidence, concurrency and recovery drills, reproducible builds, and a cold end-to-end user flow. A passing mock suite or coverage percentage is insufficient.

Preserve a release manifest containing source commit, locks, compiler settings, bytecode hashes, chain, asset and venue identities, role map, policy, caps, disabled modules, and review disposition. Documentation and code changes belong in the same scoped commit. Use the configured author and no Co-authored-by trailer, consistent with the v2 implementation instructions. Eight feature-complete build sessions, extended to include gated inbound supported-chain funding, are summarized in Chapter 9.

## Complete product screens and behavior

The consumer app must let a new user identify the environment, connect and authenticate a wallet, understand Hull and Ballast, read terms and capacity, request a deposit, track it through admission or refund, inspect a position, request a permitted exit, and claim funded USDC. Every financial action shows the exact asset, amount, receiver, fee treatment, minimum output, deadline, and relevant product restriction before authorization. A wallet login is not spending consent.

Native and supported-chain funding share the same product selector and terms. The source selector adds route cost, progress, and recovery without changing Hull's terms or Ballast's exposure. A user can return after a browser crash and recover request state from canonical identifiers. An operator's absence cannot be disguised with a spinner that has no terminal recovery instruction.

Terminal includes BOOK, HEDGE, CARRY, RISK, SERIES, TAPE, and OPPORTUNITIES. BOOK reconciles assets, escrows, fees, reserve, and claims. HEDGE exposes spot, signed perpetual quantity, delta, pending orders, margin, and evidence. CARRY separates funding, spot and perp PnL, stablecoin conversion, execution cost, and actual return. RISK names each limit and current mode. SERIES shows the rate calculation and obligations. TAPE distinguishes chain-confirmed events from operating decisions. OPPORTUNITIES estimates whether the approved MON book has attractive net carry and usable capacity; it cannot authorize unreviewed markets.

The operations interface adds queues, reconciliation exceptions, custody destinations, reservation usage, provider routes, incidents, pause dimensions, review status, and deployment evidence. Permission to view an operating panel does not confer signer authority. Read-only pages must remain meaningful when trading is paused.

## Proposed typed service contract

These endpoint names are an implementation proposal, not assertions about existing routes. GET /v1/book returns reconciled balances and status; GET /v1/hedge returns positions and evidence; GET /v1/series returns terms and subscription state; GET /v1/requests/{id} returns canonical request state. GET /v1/routes lists qualified route records. POST /v1/prepare returns typed unsigned native actions. POST /v1/route-quotes returns a provider quote plus Vessel preflight. GET /v1/intents/{id} returns route and subscription states separately.

Every financial response carries schemaVersion, environment, chainId, source, observedAt, blockNumber, blockHash, units, status, and evidence references. Monetary values are decimal integer strings. Missing values use a tagged unavailable state rather than numeric zero. Errors distinguish NOT_ELIGIBLE, CAP_EXCEEDED, SERIES_CLOSED, QUOTE_EXPIRED, MINIMUM_NOT_MET, STALE_DATA, ROUTE_PAUSED, RECOVERY_PENDING, and MANUAL_REVIEW. Retrying a preparation may be safe; retrying a submitted transaction without reconciliation may not be.

Persist requests, immutable request events, route intents, arrival credits, admission reservations, epoch settlements, venue order journals, indexed chain events, observations, and incident records in separate tables. Unique constraints include chain plus transaction hash plus log index for events, user domain plus nonce for authorization, provider route plus intent ID for external execution, and core request ID for admission. A database uniqueness constraint supplements onchain replay prevention; it cannot replace it.

Webhooks authenticate their source and are replay-protected. They trigger reads, not trusted balance writes. Store raw delivery evidence and current finality. A chain reorg marks orphaned projections reverted and replays from a retained checkpoint; an out-of-date indexer cannot overwrite finalized claim state. Rebuilding analytics is separate from restarting the execution writer.

## Transaction preparation and authorization example

For a Ballast subscription, obtain a fresh book snapshot, calculate an indicative unit output, bind minimum units and deadline, validate asset approval separately, simulate the exact request, and ask the user to authorize the contract call. Onchain execution repeats capacity, ownership, pause, and deadline checks. Only later does the forward-priced admission batch settle the existing book and issue units. The quote is not a guaranteed mint price.

For Hull, preparation binds the exact series. Funds remain refundable through subscription and earn nothing until activation. A user minimum rate must be satisfied by the final series rate or their subscription is excluded and refundable. The controller cannot roll the request into another series or product because the original one filled. The supported-chain adapter invokes these same constraints.

## Portable dollar testnet logic

The vUSD and svUSD branch has separate custody, assets, liabilities, parameters, and its own testnet addresses. No dollar can back both a Hull/Ballast claim and vUSD. As a lab model, define reserve book assets Av, outstanding vUSD liability V, and any junior buffer Jv independently. Minting or redeeming must preserve its specified solvency and conversion conditions; stating that minting is permissionless does not prove those conditions.

Before implementation freeze whether vUSD targets a dollar redemption amount, how fees and rounding work, which liabilities have priority, who bears losses, and how unavailable liquidity affects redemption. svUSD represents a stake in that separately defined product; do not assume its return comes from mainnet Hull or Ballast. This handbook preserves the isolated lab deliverable but does not invent an approved mainnet dollar mechanism. If exact lab mechanics are unresolved, mark the lab module experimental and keep its outputs out of mainnet app defaults and aggregate metrics.

# 6 Supported chain deposits and Monad settlement

## Product decision and purpose

Supported-chain funding is part of the complete V1 build under D30. A user should be able to select an approved source asset on an approved network, review a complete quote, and fund a Vessel subscription on Monad. The engine, Hull and Ballast ownership records, reserve, and financial settlement remain on Monad. Cross-chain funding extends access to the same product; it does not create another strategy book or guarantee a different rate.

The supported list is a release artifact, not a marketing phrase. A network is supported only for a specific asset, direction, provider route, wallet authorization scheme, amount range, and environment that have passed qualification. No mainnet inbound route is approved by this document. Start testing one EVM source chain and native USDC, with Arbitrum or Base as candidate demand hypotheses, then admit further routes independently. Solana and other non-EVM sources require explicit signing, beneficiary binding, and recovery design before appearing as options. Do not infer them from a provider's general brand claim.

Customers must understand that paying with ETH or another token converts that asset into the USDC used by Vessel. They cease holding the converted source asset and do not retain its upside merely because it funded the subscription. Quote source-asset units and destination USDC separately. Fee-on-transfer, rebasing, and unapproved wrapped assets are rejected.

## Provider role and selection

Epoch is a candidate because its published documentation describes signed intents coordinating swaps, bridges, and destination protocol actions [E7]. Its website's network list does not establish Monad support [E8]. Its documentation requires partner onboarding for new protocol actions and distinguishes testnet gasless support. Those are provider claims to qualify, not evidence of a functioning Vessel route.

Before selection, obtain the exact source-to-Monad route, canonical output token address, settlement contracts and permissions, finality model, minimum and maximum size, total costs, cancellation and recovery rules, available liquidity, and test evidence. Require scoped security review covering relevant contracts and versions. Confirm whether the provider can invoke Vessel's custom asynchronous request or can only deliver USDC. A generic vault-deposit integration is insufficient if it assumes immediate ERC-4626 minting.

Implement a provider adapter interface so quoting and status reporting are separable from Vessel accounting. Initially enable one reviewed implementation. Supporting several providers creates more operational surface; routing must choose only allowlisted paths and never silently switch to an unreviewed bridge because its quote is cheaper. Provider failure can stop new cross-chain deposits while direct Monad participation remains available where safe.

## User journey and authorization

The user selects the source chain, token, maximum spend, destination wallet, and Hull series or Ballast. A preflight checks beta eligibility, current stage, approximate capacity, subscription availability, route size, and wallet compatibility. Preflight is advisory until an onchain reservation succeeds; it cannot guarantee admission against later risk changes.

The quote displays token amounts in native units and human-readable units, route and provider, total fees, minimum USDC delivered, estimated arrival time, destination chain, intended claim beneficiary, refund destination, and the product terms. The user sees that bridge completion and Vessel admission are separate events. For a non-Monad source wallet, prove control of a compatible Monad beneficiary rather than assuming addresses or wallet capabilities carry across chains.

Bind the authorization to a versioned typed request. The destination adapter cannot accept a provider-supplied beneficiary without validating the user's signed binding. A solver pays or submits on the user's behalf but never owns the claim by virtue of being transaction sender. Require a nonce and domain separation with the destination chain and adapter. Contract wallets require their supported signature validation. Non-EVM signatures need their own reviewed verifier or a destination-wallet authorization; they cannot be treated as EVM signatures.

| Authorization field | Required meaning |
|---|---|
| requestId and nonce | Unique replay-protected user request |
| sourceChainId and sourceAsset | Exact origin network and token identity |
| maxSourceAmount | Maximum native units the user authorizes spending |
| destinationChainId and asset | Monad environment and approved USDC address |
| destinationAdapter and providerRouteId | Allowed receiver and route version |
| beneficiary and refundReceiver | Authenticated claim owner and recovery address |
| tranche and seriesId | Ballast or one exact Hull subscription series |
| minimumUSDC and maximumDepositUSDC | Minimum route output and maximum amount admitted |
| minimumUnits and minimumHullRate | User output constraints where applicable |
| quoteExpiry and admissionDeadline | Separate deadlines for routing and subscription |
| termsHash and policyVersion | Terms and limits the user accepted |

Do not expose arbitrary target addresses or arbitrary calldata in the public interface. An allowlisted route can invoke a narrow adapter operation only. The adapter validates the asset and observed transfer amount, authenticated request, beneficiary, replay protection, deadlines, and local conditions before moving money into a pending subscription.

## Separate route and subscription state machines

Route states are QUOTED, AUTHORIZED, SOURCE_COMMITTED, IN_TRANSIT, ARRIVED, RECOVERY_PENDING, RECOVERABLE, and CLOSED. Subscription states are NOT_REQUESTED, RESERVED, PENDING, ADMITTED, REFUNDABLE, and CLAIMED_REFUND. Display both states instead of collapsing them into a generic success badge. ARRIVED plus REFUNDABLE means the transfer completed but the intended investment did not.

The path from source authorization to destination arrival is asynchronous. Across different chains, we do not claim a single atomic rollback. At the destination, USDC delivery and request creation may be composed within one Monad transaction if the provider supports it; the economic admission still follows Vessel's asynchronous rules. A proof of source escrow or provider promise is not a Vessel asset.

The UI persists request identity and transaction references through refresh, wallet switching, and connection loss. Polling or a webhook can prompt reconciliation, but neither can create balances. Confirm actual destination receipts and canonical contract state. Source finality, destination finality, refundability, and route resolution remain explicit in the timeline.

## Budget reservations and admission logic

All entry paths use one BetaAdmission ledger. Let G_admitted be lifetime admitted contributions and P_reserved be current never-admitted reservations. New reservations must satisfy G_admitted + P_reserved + requestedMaximum <= stageLifetimeCap and the beneficiary's corresponding lifetime allowance. Reserve request count and participant slot consistently. Rate-limit unfunded reservations, give them bounded expiry, and require valid participant authorization so attackers cannot reserve all capacity indefinitely.

A successful reservation does not lock a Ballast unit price, waive future liquidity checks, or guarantee Hull activation. It prevents ordinary quota competition up to its expiry. Market losses, an incident, an invalid oracle, or a failed route can still prevent admission. If reservation expires in transit, arrival enters refundable escrow unless a fresh user authorization and current checks allow another request.

On arrival, allocate at most the signed maximum to the intended request. Return excess accepted USDC to a separately tracked user credit; do not silently increase the subscription. At actual admission, settle the old book, calculate units, apply minimum output, consume the reservation, and increment lifetime admitted contributions by the actual admitted amount atomically. Refunds release only never-admitted reservations. Withdrawals and losses never restore admitted lifetime budget.

Keep active exposure separate from the contribution cap. Arriving USDC does not create spot or short orders until the controller admits it and the risk policy authorizes deployment. Multiple source chains or source wallets do not give a beneficiary additional capacity. Operational identity checks remain imperfect, so the global onchain cap remains binding even if identities collude.

## Ownership and accounting while funds move

| Location or state | Economic owner | Included in active NAV | Earns Vessel returns |
|---|---|---|---|
| Source wallet | User | No | No |
| Provider lock or bridge flow | User claim under route terms | No | No |
| Monad arrival escrow | Authorized beneficiary | No | No |
| Pending Vessel subscription | Beneficiary awaiting admission | No | No |
| Admitted Hull or Ballast | Investor claim on active book | Yes | According to admitted product terms |
| Funded claim or failed subscription refund | Fixed beneficiary | No | No |

Origin routing costs reduce the user's delivered principal. They are not strategy losses charged to existing holders. For example, an illustrative source payment worth 1,000 USDC with 3 USDC total routing cost delivers 997 USDC. If admitted in full, 997 enters the book, the user's units are based on 997, and the lifetime contribution ledger increases by 997. Vessel charges no performance fee on that routing cost, and it is not Vessel revenue. Gas paid separately is an additional disclosed user cost.

Every escrow balance must reconcile to individual credits. Unmatched transfers are quarantined. A provider callback cannot claim an amount larger than the authenticated transfer or spend another request's balance. Never use total adapter balance as proof that a specific user paid. Same-asset overdelivery, unsupported tokens, unsolicited transfers, and duplicate callbacks have distinct handling.

## Failure behavior and recoverable funds

| Failure | Required behavior | Evidence for release |
|---|---|---|
| Quote expires before commitment | Requote and collect fresh authorization | No asset movement from expired request |
| Source transaction reorgs | Follow route finality and settlement model | No unbacked Vessel issuance |
| Transfer remains pending | Expose provider status and timeout recovery path | Documented recovery transaction and ownership |
| Arrives after Hull closes | Mark accepted USDC refundable on Monad | User can recover without operator discretion |
| Output below minimum | Reject subscription and preserve recoverable credit | Exact balance and fee reconciliation |
| Wrong token delivered | Quarantine and use reviewed recovery path | No accounting as approved USDC |
| Core admission paused | Do not admit or deploy arrived funds | Refund remains available where safe |
| Callback repeated or races refund | Single terminal disposition | No duplicate units or double payment |
| Ballast price changed | Apply forward price and user minimum | No stale-price dilution |
| User changes preferred product | Require new authorization | No automatic Hull to Ballast substitution |

A normal failed admission after arrival produces a claimable USDC balance on Monad. It does not promise a free automatic return to the original chain. The user may claim on Monad or authorize a separately quoted return route once that feature is supported. Before arrival, recovery follows the chosen route's lock, timeout, and refund mechanism; its exact timing must be disclosed before signature. Do not write generic timeout values into the contract until the provider's actual settlement assumptions are reviewed.

The destination design must let a signed beneficiary recover accepted funds without the normal quoting service being online. Test wallet gas availability and provide clear instructions or an approved sponsorship path. A refund is not practically usable if its only UI depends on the failed provider. Provider insolvency, contract exploits, and bridge faults can still produce losses or prolonged recovery; do not promise that the adapter removes those risks.

## Release manifest and support matrix

Each route record contains environment, source chain ID, source token address and decimals, destination chain ID, canonical USDC address and decimals, provider and version, source and destination settlement contracts, adapter address, authentication scheme, allowed wallet types, finality thresholds, size bounds, quote expiry policy, admission cutoffs, fee limits, recovery steps, monitoring owner, review evidence, and activation state.

Allowed states are CANDIDATE, TESTNET_QUALIFIED, REVIEWED, CANARY, ACTIVE, PAUSED, and RETIRED. Only ACTIVE routes appear as available mainnet choices. A chain logo alone is not a support record. Starting with one route is a rollout choice; the product architecture must support additional qualified records without adding unrestricted execution authority.

Route activation requires the native core gates, independent review of the adapter and relevant route assumptions, actual destination delivery and refund demonstrations, restart and replay tests, monitoring, and a team-funded route canary inside the existing contribution limits. Do not introduce a second uncapped beta budget for cross-chain deposits. A native Stage B or C label does not automatically authorize a route.

Keep inbound feature activation independent of native operation. A pause can stop new source commitments and new route admission without disabling safe recovery. Funds already in transit remain tracked until terminal resolution. Retiring a route requires reconciling outstanding intents and preserving withdrawal/recovery tooling.

## Commercial value and cost test

The feature is useful if eligible users want Vessel but are blocked by asset location or manual bridging. Measure quote-to-authorization, authorization-to-arrival, arrival-to-admission, total cost per admitted USDC, median and tail completion time, refund frequency, operator interventions, and repeat allocation. Separate users who would have bridged anyway from incremental customers.

Routing costs matter for a 28-day product. At an illustrative 8% annual simple return, 28 days is about 0.614% before any relevant costs or loss. A 0.5% entry cost would consume most of that illustration's term return; another exit cost can make the round trip unattractive. Compare route costs with the actual product economics and display the total, rather than hiding costs behind a one-click label. No cross-chain revenue surcharge is adopted by this handbook.

Outbound cross-chain settlement is a later extension. It can begin only after Hull maturity or a Ballast exit has produced segregated, claimable USDC. A bridge cannot bypass exit conditions or use unfunded claims as cash. Bridging the Hull or Ballast tokens themselves is outside this release because beta claims restrict transfer and must preserve participant limits.

# 7 Security beta and operations

The private beta is intended to constrain exposure while generating real operational evidence. Its contribution ceiling cannot make an unsafe custody model safe. External funds require an independent review, proven valuation and exits, and reachable operators. The following policies come from the v2 blueprint [P1] and require calibration against real venue behavior.

## Threat model and control ownership

| Threat | Preventive control | Detection and response | Residual risk |
|---|---|---|---|
| Accounting error | Independent integer model and conservation invariants | Reconciliation mismatch freezes NAV actions | Shared specification errors |
| Trade key compromise | Isolated signer, scoped actions, capped margin | Revoke key, halt openings, reconcile orders | Malicious trades can destroy exposed margin |
| Venue failure | Reviewed custody, fixed return destinations, bounded allocation | Stop entry, validate withdrawal and safe unwind | Venue insolvency or frozen collateral |
| Partial hedge | Small slices and observed-fill matching | Delta alert and bounded compensation | Price movement during one-leg exposure |
| Oracle manipulation | Independent inputs, age and divergence checks | Freeze valuation-dependent actions | Correlated or undetected bad sources |
| Stablecoin depeg or freeze | Actual FX marking and restricted conversion | Stop risk and reassess liquidity | Redemption, issuer and route failure |
| Junior depletion | Coverage gate and full-term obligation forecast | Halt issuance and junior payouts, wind down | Losses can outrun intervention |
| Governance compromise | Independent hardware keys, timelock, immutable ceilings | Monitor roles and queue changes | Quorum collusion or social compromise |
| Frontend or MCP attack | Typed preparation, recipient binding, user signing | Reject unsafe payloads and revoke sessions | Users may approve malicious unrelated sites |
| Split-brain keeper | Durable journal and signer-enforced fencing | Reconcile and fence old worker | External idempotency limitations |

No control eliminates all risk. The risk register must state where each restriction is enforced: contract, venue, signer, application, or operator procedure. A software policy is not an onchain guarantee. An independent reviewer must inspect the complete money path, not only isolated Solidity files.

## Proposed beta controls

| Control | Initial policy | Required response |
|---|---|---|
| Lifetime admitted contributions | Absolute V1 maximum 25,000 USDC | Block all excess entry paths |
| Market scope | One MON market, USDC subscription asset | Reject other markets and assets |
| Gross notional | No more than 1.0 times active NAV | Reject increases and reduce exposure |
| Perp notional to available margin equity | At most 1.25 | Recheck venue liquidation constraints |
| Delta warning | More than 1% of NAV | Bounded rebalance |
| Delta critical | More than 2% for 30 seconds or uncertain execution | Halt new risk and reconcile |
| Slice | Smallest of 100 USDC, 0.5% NAV and tested depth | Block if venue minimum is incompatible |
| Spot and collateral slippage | 30 bps spot; 20 bps aggregate conversion plus documented fees | Refuse beyond budget |
| Junior cover | 30% admission and payout buffer; 20% intervention floor | Stop issuance/payout or unwind |
| Stablecoin divergence | 0.5% warning; 1% new-risk stop | Mark actual FX and inspect conversion |
| Drawdown | 2% from cash-flow-adjusted high-water NAV | Automatic new-risk halt and wind-down review |

These thresholds are design candidates, not certified maximum-loss bounds. Actionable venue state must be no older than ten seconds. Preparation snapshots expire after 30 seconds. Oracle policy uses the stricter of 60 seconds or an approved feed bound. Incompatible granularity or latency blocks the relevant feature until a reviewed policy change is made.

Capacity is the minimum of contribution budget, senior coverage, spot and perp depth, open-interest headroom, conversion depth, withdrawable margin, stress-loss budget, and operating capacity. The baseline also limits short notional to 1% of observed market OI and 5% of executable depth inside the slippage envelope. Missing capacity data is unavailable capacity.

## Admission stages

| Stage | Lifetime global limit | Participants | Evidence before progression |
|---|---|---|---|
| A Operator canary | 1,000 USDC | Team-owned funds only | At least 72 hours, real hedge, collateral return, funded exit and incident drill |
| B Private cohort | 5,000 USDC cumulative | Up to ten participants; external lifetime limit 500 USDC each | Independent review, seven stable days, three independent funded exits and completed Hull maturity before Stage C |
| C Capped beta | 25,000 USDC cumulative | Up to 25 participants; external lifetime limit 2,000 USDC each | Reviewed Stage B evidence and 48-hour timelocked change |

The numbers are ceilings, not commitments to deploy. Team Ballast and reserve count inside them. Pending deposits atomically reserve quota. Refunds release only never-admitted reservations. Withdrawals and losses do not create lifetime room. Unsolicited transfers remain quarantined. Onchain checks apply to direct contract calls as well as the website.

At least 2% of intended active capital is pre-funded reserve before Hull activates. Junior cover must exceed 30% after remaining full-term coupon and stressed closing costs. Founder seed is real capital at risk. Track its concentration separately from independent users. If required seed, liquidity, or coverage is absent, reduce the stage or remain on testnet.

## Launch gates and decision packet

The release owner assembles one packet with PASS, BLOCKED, or NOT APPLICABLE for each gate, supporting artifact, timestamp, exact commit or block, reviewer, and next action. A gate cannot pass because a document exists; it must contain valid evidence of the required behavior.

| Gate | Required proof |
|---|---|
| Specification | Frozen terms, accounting examples, request and recovery states |
| Venues and custody | Verified contracts, account ownership, fills, revocation, fixed-destination collateral return |
| Valuation | Independent sources and reconstructable current book state |
| Economics | Measured capacity, costs, stress tests and 30-day Hull rate history |
| Security | Independent report with material issues resolved and scope disclosed |
| Claims | Deployed-liquidity exits and complete maturity rehearsal |
| Operations | Primary/backup coverage, alert delivery, restore and incident drills |
| Deployment | Two clean rehearsals, artifacts, roles, bytecode and no lab modules |
| Product and participation | Cold user journey, accurate labels, reviewed eligibility and terms |
| Machine access | Cold read/verify tests and separate preparation authorization tests |

Initially deploy with zero external admission and no automatic strategy activation. Verify configuration, ownership and monitor enrollment before an authorized canary. Code completion does not itself authorize a mainnet transaction, funding, invitations, or cap increase.

## Review and testing scope

Review contracts, the economic model, venue custody, oracle assumptions, keeper concurrency, signing, admission, frontend preparation, authentication, MCP, and deployment. No unresolved critical/high issues or custody, solvency, or withdrawal unknowns may remain for external beta. Accepted medium findings need an owner, rationale, mitigation, and explicit disposition.

Test conservation, no unsupported mint, no stale-price dilution, no fee/reserve double count, no unauthorized transfer, cap reservation races, queue fairness, partial claim funding, no junior payout below projected cover, and no lab token activation on mainnet. Use an independent reference implementation rather than testing the code against itself.

Adversarial scenarios include prolonged negative funding, plus/minus 30% and 50% spot shocks, unstable USDC/AUSD prices, thin depth, venue outage, lost acknowledgements, late fills, two keepers, failed collateral return, stale data, RPC disagreement, wiped-out Ballast, senior impairment, and simultaneous exits. Test the full path from fault to safe action and recovery. Stress cases are not statements about the worst possible outcome.

## Operating responsibilities and cadence

Proposed ownership is Kunal for product claims, cohort communication, and the release packet, with Daksh for protocol delivery if the team agrees. Before exposure, name actual primary and backup operators, key holders, risk reviewer, and independent reviewer. Two founders do not automatically constitute independent review or continuous operating coverage.

Target sentinel evaluation every five seconds where feasible, automatic new-risk halt within 30 seconds of a confirmed critical breach, human acknowledgement within five minutes, and mitigation ownership within 15 minutes. Prove these targets in drills. They cannot guarantee prevention of liquidation. Without coverage and automatic controls, do not maintain unattended exposure.

Each day reconcile custody, venues, orders, H/B/R, fees, escrows, subscriptions and claims. Each week review founder concentration, actual carry, costs, missing-data time, hedge adherence, queues, funded exits, incidents, and capacity. Before a new Hull series, recheck data coverage, quote history, eligibility, full-term cover, and live venue conditions.

Keep the signing broker separate from public workloads. Back up the action journal, configurations, and encrypted recovery material. Test restoration to a new environment and prevent the old writer from signing. History may target a five-minute recovery point and a 60-minute recovery time, while financial risk response remains automatic and independent of database restoration.

## Incident playbooks

**Unknown or partial execution.** Halt further slices, preserve client IDs, inspect fills and pending orders, and recompute exposure. Cancel increasing orders where possible. Compensate only within validated price and size limits. If compensation is unavailable, declare the unhedged state and escalate. Never blindly retry an unknown order.

**Oracle or accounting mismatch.** Freeze admission, settlement, and unfunded NAV-priced payouts. Preserve already funded claims unless their escrow is itself compromised. Compare independent sources and reconstitute the balance identity. Resume only after the discrepancy is explained and reviewed.

**Key compromise.** Stop risk, revoke venue credentials through the actual tested mechanism, fence the signer, and reconcile unknown orders. A replacement key is insufficient if the old account owner or delegate still has authority. Use the reviewed recovery owner and fixed destinations. Preserve logs without publishing secrets.

**Venue outage.** Stop openings and validate any safe cancellations or reduction. Do not sell all spot merely because the short venue is unreachable; that can leave an uncovered short. Maintain the safest verifiable state and communicate the specific uncertainty. Recovery requires proven reads, orders, and withdrawals.

**Impairment or insolvency.** Terminate ordinary coupon accrual at the recorded time, stop fees, unwind conservatively, and settle actual recoveries by the class waterfall. Senior holders share proportionally up to the frozen entitlement, then reserve restoration, then Ballast. Later recoveries must include prior claimers consistently.

Every playbook must include actual allowed commands or transaction batches, prechecks, owner and backup, evidence to preserve, communication cadence, and resume criteria before launch. This document establishes the procedure; it does not invent production commands for uninspected contracts.

## Pauses recovery and retirement

Pause dimensions are separate for admission, risk increase, valuation settlement, and claims. Ordinary risk pauses preserve already funded claims. A clearly disclosed emergency escrow pause exists only for an escrow-specific exploit concern. Do not promise unstoppable withdrawals while retaining that authority.

Resume requires reconciled assets, understood cause, corrected controls, and timelocked governance where specified. A compromised immutable deployment may require retirement. Rollback means halt, reconcile, unwind, settle, or offer holder-authorized migration; it never means editing accounting history or secretly substituting contract logic.

Participation terms require jurisdiction-specific professional review covering the entity, offering, custody and operator roles, derivatives exposure, marketing, screening, privacy, and reporting. The phrase private beta creates no assumed exemption. Signed consent explains risk but does not make an unsafe protocol safe.

## Additional supported-chain operating controls

The native risk and beta limits also govern cross-chain admissions. Reconcile pending intents, reserved quota, destination credits, admitted amounts, unmatched transfers, and recovery claims daily and after every incident. Monitor each active route independently of the mainnet keeper. A route outage pauses new commitments and admissions where necessary while preserving safe recovery; it does not justify concealing in-transit funds as active NAV. Route review and canary evidence are additional gates described in Chapter 6.

# 11 Evidence acceptance and employee handoff

## Source register

Sources establish the scope stated here; external provider descriptions are not independent security assurance. Recheck integration-sensitive facts at release. The protocol default branch was checked on 30 September 2026. Detailed repository observations refer to the same pinned commit inspected on 29 September. No transaction was sent and no current deployment audit was performed for this handbook.

| ID | Source | Use and limit |
|---|---|---|
| P1 | Vessel Complete Product and Production Build v2 dated 22 September 2026 | Inherited detailed product and engineering requirements |
| P2 | Founder supplied Vessel conversations and project history | Team background and reported recognition |
| P3 | Vessel company pack dated 23 September 2026 | Commercial hypotheses budget and investor preparation |
| D30 | Founder instructions in this conversation dated 30 September 2026 | Supported-chain inbound funding included now with gated activation |
| G1 | Protocol README at pinned commit below | Prototype and stated simulated components |
| G2 | FACTS.md at the same commit | Historical deployment reports not fresh chain verification |
| G3 | PerplVenue.stub.sol at the same commit | Unimplemented venue methods in inspected branch |
| G4 | vessel-landing index.html and v2.js inspected 29 September | Static positions and decorative counters in source |
| E1 | Official Monad network information | Network configuration reference |
| E2 | Circle USDC contract addresses | Asset identity reference to recheck at deployment |
| E3 | Kuru official documentation | Venue architecture and integration reference |
| E4 | Perpl official documentation and integration repository | Venue and delegated account reference |
| E5 | Resolv litepaper | Comparison of separated risk claims |
| E6 | Pendle introduction | Comparison of principal and yield tokenization |
| E7 | Epoch developer overview checked 30 September | Intent pattern and protocol onboarding limitations |
| E8 | Epoch website checked 30 September | Published coverage does not establish Monad support |

Pinned protocol commit: c4c18189d52e873f7a0b7830dbf5d1f019c0b395.

G1 https://github.com/Lemma-Development-Labs/vessel/blob/c4c18189d52e873f7a0b7830dbf5d1f019c0b395/README.md

G2 https://github.com/Lemma-Development-Labs/vessel/blob/c4c18189d52e873f7a0b7830dbf5d1f019c0b395/FACTS.md

G3 https://github.com/Lemma-Development-Labs/vessel/blob/c4c18189d52e873f7a0b7830dbf5d1f019c0b395/contracts/src/venues/PerplVenue.stub.sol

G4 https://github.com/Lemma-Development-Labs/vessel-landing/blob/main/v2.js and https://github.com/Lemma-Development-Labs/vessel-landing/blob/main/index.html

E1 https://docs.monad.xyz/developer-essentials/network-information

E2 https://developers.circle.com/stablecoins/usdc-contract-addresses

E3 https://docs.kuru.io/ and https://docs.kuru.io/contracts/Contract-addresses

E4 https://docs.perpl.xyz/ and https://github.com/PerplFoundation/api-docs/blob/main/integrations.md

E5 https://docs.resolv.xyz/litepaper

E6 https://docs.pendle.finance/pendle-v2/Introduction

E7 https://docs.epochprotocol.xyz/

E8 https://epochprotocol.xyz/

The earlier E1–E6 research was performed for the company pack on 23 September. Kuru and Perpl overviews were rechecked on 30 September. The handbook uses those sources for category descriptions and design context, not to declare current capacity or an approved contract address. It avoids numeric claims about current funding, APY, market size, or provider performance.

## Requirements and acceptance evidence

| Requirement | Acceptance artifact | Release consequence if missing |
|---|---|---|
| A equals H plus B plus R | Independent model and differential settlement vectors | Block financial settlement |
| Complete custody reconciliation | Assets orders escrows liabilities and venue equity reconstruction | Block NAV dependent actions |
| Real hedge and bounded execution | Fill evidence partial failures and compensation tests | No mainnet strategy activation |
| Senior fairness | Maturity impairment and cumulative recovery tests | No external Hull |
| Junior fairness | Forward pricing partial exits and minimum output tests | No external Ballast |
| Shared beta budget | Concurrent native and cross-chain admission tests | No external admission |
| Safe venue custody | Ownership revocation and fixed-destination withdrawals | No external funds |
| Correct cross-chain beneficiary | Signed binding and adversarial solver tests | Route remains disabled |
| Recoverable failed subscription | Late arrival pause and refund demonstrations | Route remains disabled |
| Replay resistance | Duplicate callbacks reorgs crashes and refund races | Route remains disabled |
| Truthful public state | No fabricated data cold user walkthrough and source links | No public launch claim |
| Operations continuity | Backup operator restore drills and incident rehearsal | No unattended exposure |

A release record contains requirement ID, test or observation, source commit, chain and block hash where relevant, contract or account, exact command or transaction, observed result, raw evidence path, reviewer, limitation, and recheck trigger. A test marked pass without its source and scope is not sufficient. Archive failures and remediation as well as successes.

## Unresolved parameters before activation

The release owner must obtain exact mainnet market IDs and lot sizes, contract-owned venue control, oracle addresses and confidence rules, actual USDC/AUSD liquidity and recovery route, Ballast virtual offsets and seed, deterministic EWMA conventions, and reviewed participant eligibility. Cross-chain work adds provider route and contract versions, source finality rules, verified beneficiary authentication, quote and recovery timeouts, source token addresses, and safe size bounds. Assign a named owner and completion artifact for each. Defaults from testnet must not leak into mainnet.

*[One paragraph on the operating budget is omitted from this public copy; see the private company pack.]*

## Working with the handbook

During onboarding, each employee should explain the two tranches, reproduce one settlement example, locate the current deployment manifest, distinguish demo from mainnet, and walk through one failed deposit and one funded exit. Engineers should also run the accompanying reference model and compare its assumptions with the contract implementation. Operators rehearse pause and recovery with a second person before joining the rota.

Keep product decisions in versioned architecture decision records. Each change states the old rule, new rule, reason, accounting and custody impact, required migration, affected tests, review owner, and activation conditions. D30 is the scope decision for inbound supported-chain funding; later provider selection is another decision. Do not edit a marketing sentence and treat it as authorization to change financial behavior.

Maintain a data room with company ownership and IP records, this product handbook, repository and manifests, economic models, review reports, operating drills, actual finances, customer research, cohort metrics, participation terms, and investor materials. Access is role-based. Never include production secrets, wallet seeds, or unredacted personal financial documents in a general investor folder.

Weekly internal review compares promised scope with demonstrated evidence, including missing work. Monthly finance review reconciles assessed fees, reserve retention, treasury receivables, cash collected, operating spend, and runway. Update external claims only after the evidence register changes. No active tester, live route, partner endorsement, or recurring revenue should be inferred from an integration plan.

# 12 Glossary

| Term | Plain meaning |
|---|---|
| Spot | Ownership of the actual asset rather than a derivative |
| Perpetual short | A derivative position whose price exposure generally opposes a long spot holding |
| Funding | Periodic payments between long and short positions which can change direction |
| Delta | Sensitivity to the underlying asset price expressed in a defined unit |
| Basis | Difference between spot and derivative prices or behavior |
| NAV | Net asset value after recognized liabilities using the stated valuation policy |
| Hull | Dated senior claim with a contractual rate subject to losses |
| Ballast | Junior ownership that absorbs losses first and receives residual returns |
| Reserve | Limited subordinated capital used after Ballast and before Hull |
| Coupon | Contractual simple accrual on Hull principal |
| Loss carryforward | Prior gross strategy losses that must be recovered before eligible performance fees |
| Admission | The moment pending funds enter the active book and receive investor claims |
| Escrow | Segregated funds held for a specified pending or claimable purpose |
| Intent | User authorization describing an outcome and constraints rather than arbitrary execution |
| Solver | A party that executes or funds a route under an authorized intent |
| Finality | The confirmation condition used before relying on chain state |
| Slippage | Difference between reference or quoted value and actual execution |
| Capacity | Capital the strategy can admit under its strictest applicable limit |
| CLOB | A central limit order book matching bids and asks; the word central does not itself mean custodial |
| MCP | A machine interface for approved reading verification and separately gated preparation |
| Claimable | Funds have actually been segregated for the authorized receiver |
| Supported chain | A chain with at least one specifically qualified active route in the relevant environment |

## Practical understanding check

A new reader should now be able to answer why a positive strategy return can still reduce Ballast, why a fixed Hull rate is not a guaranteed payout, why a 48-hour cooldown is not a payment promise, why source-chain authorization is not a Vessel deposit, why funds can arrive on Monad without becoming invested, and why a public order book does not eliminate venue or execution risk. If any answer depends on an assumed live feature, consult Chapter 1 and the release manifest before repeating the claim.
