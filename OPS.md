# OPS — Vessel testnet operations

> This system is a hardened public testnet deployment. It is not audited, holds no real value, and is not mainnet-ready. Mainnet is gated by external review and the Gate-0 register, neither of which is a code change.

Last verified: 2026-08-29. Every number below was measured against Monad testnet
(chainId 10143) on that date, not recalled. Re-verify before trusting it.

---

## 0. URGENT — credential rotation required

Three secrets were pasted in plaintext into a chat transcript on 2026-08-29 and
must be treated as fully compromised.

| Secret | What it controls | Action |
| --- | --- | --- |
| Private key `0x67a9…24c5` → `0x4307C72a92063df4fa189c9e9621b741d457be7C` | **The deployer.** Verified on chain: `Guardian.owner()`, `BlitzVault.deployer()`, `SimVenue.owner()`, and the `Tranches` treasury address. Holds ~36.7 MON. | Rotate. See blast radius below. |
| Railway API token `c37ac07b-…` | Full Railway account access, including the ability to read service env vars — which is where `KEEPER_PK` lives. | Revoke in Railway → Account → Tokens. |
| Vercel token `vcp_…` | Full Vercel account access. | Revoke in Vercel → Account → Tokens. |

**Blast radius of the deployer key on the current testnet deployment.** Holder can:

- `Guardian.pause()` — halt every mutative path in vault, tranches and engine,
  indefinitely. Two-step ownership means they can also transfer the Guardian away.
- `SimVenue.setFundingRateBps(-10000)` — drive funding maximally negative, which
  charges losses to Ballast and can push `settle` into `HullImpairment`.
- Receive all protocol fees: `Tranches.treasury` is the deployer address
  (`Deploy.s.sol` passes `deployer` as `treasury_`).

It cannot mint dUSD (there is no privileged mint — `DemoUSD` issues only through
the public faucet) and cannot directly move user funds.

No real value is at risk: this is testnet, dUSD is valueless, and MON is free.
The reasons to rotate anyway are that a griefer can pause the public demo, and
that the same key must never be reused on mainnet. **Redeploying is the only way
to move `Guardian` ownership off this key** — `deployer` is `immutable` on
`BlitzVault`, `Tranches` and `EngineLite`, so it cannot be rotated in place.
Guardian ownership alone can be transferred with `Ownable2Step`.

This is the concrete argument for Phase 5: the owner should be a 2-of-3 Safe, so
one leaked key is not one leaked protocol.

---

## 1. Verified Monad facts

### Gas — Monad charges the LIMIT, not usage

Source: `.agents/skills/gas/SKILL.md`.

```
gas_paid = gas_limit * price_per_gas
```

This exists because Monad executes blocks asynchronously — consumption is not
known at inclusion time. Consequences:

- An inflated gas limit is a **direct overcharge**, not a safety margin.
- The skill's guidance is a buffer of **at most 10%** over a real estimate.
- Never let a wallet fall back to its own default limit: if `eth_estimateGas`
  reverts, MetaMask substitutes a very large limit and the user pays all of it.

| Parameter | Value | Source |
| --- | --- | --- |
| Block gas limit | 200M (docs) / **150M observed on testnet** | skill + `eth_getBlockByNumber` |
| Transaction gas limit | 30M | skill |
| Minimum base fee | 100 MON-gwei | skill |
| `baseFeePerGas` (measured) | **100 gwei** — at the floor | `eth_getBlockByNumber` |
| `eth_gasPrice` (measured) | **102 gwei** | `eth_gasPrice` |

Cold state access is repriced **upward** vs Ethereum — cold `SLOAD` 8,100 (vs
2,100), cold account access 10,100 (vs 2,600); warm access unchanged. Foundry gas
numbers therefore **understate** Monad cost on cold-heavy paths. Measure on chain.

### Measured gas — live `eth_estimateGas` against the real deployment

| Call | Monad live | Foundry suite max | Old app limit | Overcharge |
| --- | --- | --- | --- | --- |
| `crank()` | **127,425** | 237,917 | 1,300,000 | **10.2×** |
| `deployLiquidity()` | **469,430** | 356,148 | 1,500,000 | 3.2× |
| `unwind()` | **121,989** | 224,715 | *(no limit set)* | — |
| `faucet()` | **121,347** | 113,700 | 200,000 | 1.6× |
| `approve()` | **52,114** | 46,282 | 80,000 | 1.5× |
| `joinHull` / `joinBallast` | not estimable (needs allowance) | 167,393 / 210,672 | 650,000 | ~3× |
| `exitHull` / `exitBallast` | not estimable (needs position) | 96,961 / 97,159 | 550,000 | ~5.7× |

Live estimates were taken with `shortId == 0` (no hedge open), so the
position-open paths cost more. `app/lib/gas.ts` now estimates at call time with a
10% buffer and treats the constants as a ceiling only.

### Keeper runway — compute from the limit

```
costPerCrank    = gasLimit × gasPrice
cranksRemaining = balance ÷ costPerCrank
```

Worked, at the measured 102 gwei:

- At the old 1,300,000 ceiling: 0.1326 MON per crank. The keeper's **8.0 MON**
  balance is **~60 cranks ≈ 5 hours** at `CRANK_INTERVAL_SEC=300`.
- At a realistic 165,000 limit (estimate + buffer): 0.0168 MON per crank →
  ~475 cranks ≈ 40 hours.

The old `MIN_BAL = 0.5 MON` alarm was meaningless: at the ceiling it is under
four cranks — roughly 19 minutes of runway. **Budget on limits, alarm on runway.**

### RPC providers supporting Monad testnet

Source: <https://docs.monad.xyz/tooling-and-infra/rpc-providers.md> (fetched 2026-08-29).

Alchemy · Ankr · BlockPI · Blockdaemon · Chainstack · Dwellir · Envio ·
GetBlock · OnFinality · QuickNode · Spectrum · Tatum · Validation Cloud ·
dRPC NodeCloud · thirdweb

The keeper and indexer must not run against the public `https://testnet-rpc.monad.xyz`:
a polling crank loop plus a `getLogs` backfill will be rate limited. The docs page
does not publish a specific public-endpoint rate limit — **it is unstated, not
known to be generous.**

The indexer additionally needs **archive** access: `vessel-service/src/indexer.ts`
calls `multicall`/`readContract` at a historical `blockNumber`. On a non-archive
endpoint those reads fail. Confirm archive support with the provider before
choosing one.

### Explorer URL — unresolved discrepancy

`.agents/skills/addresses/SKILL.md` gives the Monad testnet explorer as
**`testnet.monadscan.com`**. This repo hardcodes **`testnet.monadvision.com`** in
`ADDRESSES.json`, `app/lib/wagmi.ts`, `app/.env.example` and the transparency
screen. Both return HTTP 403 to `curl` (bot protection), so neither could be
confirmed or ruled out from the CLI. **Verify in a browser and make the repo
consistent with whichever is canonical** — every "verify it yourself" link on the
transparency screen depends on it.

---

## 2. Environment registry

No secret belongs in the repo. `.env` is git-ignored; `.env.example` is the
contract and must stay current.

### App (Vercel)

| Variable | Purpose | Holder / rotation |
| --- | --- | --- |
| `NEXT_PUBLIC_CHAIN_ID` | `10143`. Must match `ADDRESSES.json`. | Not secret. |
| `NEXT_PUBLIC_RPC` | **Dedicated** endpoint, not the public one. Comma-separated for fallback. | Provider dashboard; rotate by reissuing the key. |
| `NEXT_PUBLIC_RPC_FALLBACK` | Secondary endpoint(s). | As above. |
| `NEXT_PUBLIC_STATS_URL` | Hosted `vessel-service` base URL. Empty ⇒ chain fallback, and the UI says so. | Not secret. |
| `NEXT_PUBLIC_WC_PROJECT_ID` | WalletConnect Cloud project id. Without it the WC connector is omitted and the picker explains why. | WalletConnect Cloud; rotate there. |
| `NEXT_PUBLIC_EXPLORER` | Explorer base URL — see the discrepancy above. | Not secret. |
| `NEXT_PUBLIC_APP_URL` | Canonical app URL, used in WalletConnect metadata. | Not secret. |
| `NEXT_PUBLIC_MONAD_FAUCET` | Gas faucet link shown before the dUSD faucet. | Not secret. |
| `NEXT_PUBLIC_USE_MOCK` | `0` in production. Anything else serves the demo provider. | Not secret. |
| `NEXT_PUBLIC_ADDR_*` | Generated from `ADDRESSES.json` by `pnpm sync`. | Not secret. |

Note: everything `NEXT_PUBLIC_*` is embedded in the client bundle and is public
by construction. Never put a key that must stay private behind that prefix — an
RPC URL with an embedded API key is visible to anyone who opens devtools. Use a
provider that supports domain-restricted keys.

Preview deploys must point at the same testnet contracts but a **separate**
`NEXT_PUBLIC_STATS_URL`, or none. A preview branch must never write to production
state.

### Service (Railway)

| Variable | Purpose | Holder / rotation |
| --- | --- | --- |
| `RPC_URL` | Dedicated endpoint. Archive access required by the indexer. | Provider dashboard. |
| `CHAIN_ID` | `10143`. Boot fails if it disagrees with `ADDRESSES.json` or the chain. | Not secret. |
| `DATABASE_URL` | Postgres. Unset ⇒ in-memory store, lost on restart. | Railway/Neon; rotate by rolling the DB password. |
| `KEEPER_PK` | **Gas-only key.** `crank()` is permissionless, so this key can never move user funds — see §3. | Generate fresh; fund with MON only. |
| `CRANK_INTERVAL_SEC` | Default 300. | Not secret. |
| `CONFIRMATIONS` | Reorg depth the indexer stays behind head. | Not secret. |
| `MIN_CRANKS_RUNWAY` | Low-balance alarm threshold, in cranks (computed from the gas limit). | Not secret. |
| `START_BLOCK` | Backfill origin; defaults to `ADDRESSES.json` `deployedBlock` (57874280). | Not secret. |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist. | Not secret. |
| `SENTRY_DSN` | Error reporting. | Sentry project settings. |
| `PORT` | Injected by the platform. | Not secret. |

---

## 3. Why the keeper key is safe to host

`EngineLite.crank()` has no access control — it is `whenNotPaused nonReentrant`
and nothing else. The keeper's only job is to pay gas to call a function anyone
could call. It is never granted an allowance, never holds dUSD, and is not the
`deployer` of any contract.

This is a genuine design strength and should be stated as one: a leaked keeper
key costs the MON in that account and nothing else.

`EngineLite.unwind()` is likewise permissionless. The app exposes it directly
(see the exit flow and the transparency screen) rather than hiding it behind an
owner the user has to petition.

Keep these three testnet keys distinct, as `FACTS.md` requires:
deployer `0x4307…be7C`, seeder `0x25dd…4235`, keeper `0x19B2…08dc`.

---

## 4. Runbooks

### Deploy the service (Railway)

1. Revoke and reissue the Railway token first — the one in the transcript is burned.
2. New project → deploy from repo, root `vessel-service/`, Dockerfile builder
   (`railway.json` already selects it).
3. Add a Postgres plugin, or a Neon database, and set `DATABASE_URL`.
4. Set every Service variable from §2. Generate a **fresh** `KEEPER_PK` and fund
   it with MON sized from §1's runway formula — at least
   `MIN_CRANKS_RUNWAY × gasLimit × gasPrice`.
5. Point the platform healthcheck at `/health`. It returns 503 when degraded, so
   a wedged process restarts instead of sitting there looking healthy.
6. Confirm in logs: `preflight ok`, then `indexed range`, then `cranked`.

### Deploy the app (Vercel)

1. Revoke and reissue the Vercel token.
2. Import the repo, root directory `app/`, framework Next.js.
3. Set Production and Preview variables **separately** (§2).
4. Add `testnet.vessel.wtf` and configure DNS early — propagation is the long pole.
5. Verify: the testnet banner is present, the SIM VENUE chip is present, and
   with `NEXT_PUBLIC_STATS_URL` unset the history panel shows
   `reading from chain · history limited`.

### Verify a contract

See `FACTS.md` for the per-contract runsheet. Toolchain must match
`contracts/foundry.toml`: solc 0.8.24, optimizer 200, via-ir, evm cancun.

---

## 5. Monitoring

| Alarm | Condition | Why it matters |
| --- | --- | --- |
| Keeper liveness | no successful crank in N intervals | A silently dead keeper stops the waterfall accruing and **nothing on screen says so**. This is the one that matters most. |
| Keeper runway | `cranksRemaining < MIN_CRANKS_RUNWAY`, computed from the gas **limit** | Budgeting on historical usage under-counts on Monad and the keeper runs dry looking funded. |
| Net delta drift | `abs(netDeltaBps)` over threshold | Protocol health, not infrastructure. |
| Indexer lag | safe head − cursor over threshold | History silently stops advancing. |
| Reserve vs target | reserve below `RESERVE_TARGET_BPS` | Buffer depleted. |
| App / service uptime | `/health` non-200 | — |

`/health` is public and must stay honest: it reports keeper last-run, indexer lag,
net delta and RPC reachability, returns `null` (never `0`) for anything it cannot
read, and returns 503 with an explicit `degraded` list when the system is broken.

---

## 6. Known gaps

These are open, not solved. Listing them is the point.

- **Per-address position history.** `principal`, `boardedAt` and the sparkline
  need an address-indexed history service. Until one exists the live provider
  reports them `unavailable`; it previously showed a zero principal and an empty
  sparkline, which read as real data.
- **Spot mark is manipulable.** `EngineLite._spotValue()` is pool mid with a ±5%
  per-crank cap. That was adequate against `MockRouter`; against a live pool it
  is an attack surface. Resolve before Phase 6.1 (PuddleSwap) — TWAP, an oracle,
  or an explicit accepted-risk entry in the register with the cap as the stated
  mitigation.
- **Owner is a single key.** Phase 5. See §0.
- **SimVenue is simulated.** The label comes off only when a real Perpl short is
  open and readable on the transparency screen — not when the code merges.
- **Explorer URL discrepancy.** §1.
