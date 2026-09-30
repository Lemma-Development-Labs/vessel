# Vessel Architecture and Engineering

System boundaries implementation model and technical acceptance

Prepared for the Vessel engineering team and technical reviewers • 23 September 2026

Vessel V1 should use one canonical accounting and risk model across its contracts, services, app, Terminal, SDK, and MCP. Custody and claims belong to the protocol. Public interfaces read or prepare actions. A separate execution system operates within explicit permissions. This document summarizes the production architecture established in the v2 build baseline [P1]; it is an intended architecture, not a repository audit.

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

Preserve a release manifest containing source commit, locks, compiler settings, bytecode hashes, chain, asset and venue identities, role map, policy, caps, disabled modules, and review disposition. Documentation and code changes belong in the same scoped commit. Use the configured author and no Co-authored-by trailer, consistent with the v2 implementation instructions. Eight feature-complete build sessions and their gates are summarized in Document 06.

## References

[P1] Vessel Complete Product and Production Build v2, 22 September 2026, sections 3–27. [E4] Perpl official integration documentation, checked 23 September 2026. The complete source register and unresolved dependencies are in Document 08. All implementation interfaces and policies in this document are specifications unless supported by separate release evidence.
