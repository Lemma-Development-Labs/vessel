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
| Deployer private key (`67a9f48c…`) → `0x85Fe6D9399EA584Ba5344b8d21e27137adbB5738` | **The deployer.** Verified on chain: `Guardian.owner()`, `BlitzVault.deployer()`, `SimVenue.owner()`, and the `Tranches` treasury address. Holds 36.677891042 MON. | Rotate. See 0.3. |
| Railway API token `c37ac07b-…` | Full Railway account access, including the ability to read service env vars — which is where `KEEPER_PK` lives. | Revoke in Railway → Account → Tokens. |
| Vercel token `vcp_…` | Full Vercel account access. | Revoke in Vercel → Account → Tokens. |

### 0.1 Exposure surface — measured, not assumed

A secret shown to **one party** is a trust problem. A secret on a **public
surface** is a race against scrapers that is already lost. The two demand
different postures, so the question was answered with tools rather than memory.

The stakes are not hypothetical: `Lemma-Development-Labs/vessel` **is a public
repository** — `gh repo view --json visibility` returns `"PUBLIC"`,
`"private": false` — and all three branches (`main`, `harden/p0-testnet`,
`cursor/vessel-delta-neutral-vault-1a23`) are pushed and match their remotes.
Anything committed here is world-readable within seconds.

Every check below was run on 2026-08-29 and is reproducible.

| Surface | How it was checked | Result |
| --- | --- | --- |
| Git history, all refs | `git log -p --all -S '67a9f48c'` | empty — no commit adds or removes it |
| Git history, all revs | `git grep -n '67a9f48c' $(git rev-list --all)` over 18 commits | 0 hits, completed well inside a 120 s cap |
| **Every git object** | all 749 blobs — reachable *and* unreachable, loose and packed — enumerated with `git cat-file --batch-all-objects` and piped through `git cat-file --batch` | **0 hits.** `git fsck --unreachable --dangling` finds exactly one unreachable blob, `e69de29`, which is the empty blob |
| gitleaks 8.28.0, full history | custom rule anchored on the key's first and last 8 hex chars, `--log-opts=--all` | 17 commits / 4.24 MB scanned — **0 hits on the key rule** |
| gitleaks 8.28.0, filesystem | `gitleaks dir` over 858 MB: working tree, untracked files, `node_modules/`, `.next/`, `contracts/out/` | **0 hits on the key rule.** The three files >20 MB it skipped were grepped directly — also 0 |
| trufflehog 3.90.10 | git history *and* filesystem, `--results=verified,unknown` | 197 findings, **all 197 the same `Infura` demo key vendored upstream in `forge-std`** (`contracts/lib/forge-std/src/StdChains.sol:204`, plus copies compiled into `contracts/out/`). Not ours, already public |
| Working tree | `grep -rn` for both the 8-char fragment and the full 64-hex key | 0 hits |
| `.env` files | `find` returns only four `*.env.example` and `app/.env.production` | no `.env` exists anywhere in the tree, so there is nothing to leak. `app/.env.production` is tracked but holds only RPC URLs, chain id and the explorer URL |
| `.env` in history | `git log --all --diff-filter=A --name-only` filtered to `.env` | only the four `.env.example` files and `app/.env.production` were ever added. No real `.env` has ever been committed |
| GitHub Actions logs | all **13** workflow runs downloaded with `gh run view --log` and grepped for the fragment, the address, and any `0x`+64-hex string | **0 matches across all 13 runs** |
| GitHub Actions secrets | `gh api repos/…/actions/secrets` → `{"total_count":0,"secrets":[]}`; `ci.yml` has no RPC, deploy or signing step | CI holds no key and touches no chain, so it cannot print one |
| PR / issues / gists | PR #1 body, comments and reviews; `gh issue list`; `gh api /gists` | 0 hits; no issues; no gists |
| Deployed app | live Vercel HTML fetched (HTTP 200, 340 KB) and grepped; app source searched for `process.env.*PK` / `PRIVATE_KEY` / `SECRET` | 0 hits — **the frontend never reads a private key at all** |
| Local shell history | `~/.bash_history` (no zsh/fish history present) | 0 hits |

**What *is* public is the address, never the key.** `0x4307C72a…` appears in 7
places across 4 commits — `README.md`, `FACTS.md`, `docs/ADDRESSES.md`,
`docs/security/powers.md` and this file. That is intended: deployment addresses
are meant to be published, and an address discloses nothing the chain does not
already show.

**Conclusion, stated precisely.** We checked; we did not assume. The deployer
key was disclosed to **one chat transcript and to nothing else we can observe**.
It is not in the repository, not in any git object reachable or otherwise, not
in a CI log, not in the deployed bundle, not in any file on disk, not in shell
history. **It never reached a public surface.** This is a single-party
disclosure, not a public leak — so the rotation is deliberate hygiene on a
deadline we control, not a race we have already lost.

Two caveats keep that honest:

- **The transcript is outside our instrumentation.** This covers the surfaces we
  control and can scan; it says nothing about how the chat provider stores,
  retains or processes that transcript. The key stays classified as compromised
  regardless. The scan establishes *scope*, not absolution.
- **Our own scanner would have missed it in Markdown.** `scripts/check-secrets.mjs`
  flags any `0x`+64-hex in tracked files that is not one of ten allowlisted Anvil
  keys, and also scans the last 50 commit messages — but it excludes `.json`,
  `.md`, `.gas-snapshot`, `lcov.info`, `contracts/lib/` and `.agents/`. Probed
  with a synthetic key: a `.ts` file is caught (`possible key material in …:
  0xdeadbeef…`, exit 1); the identical key in a `.md` file is **silently
  ignored**. In a repo whose addresses, runbooks and this very file live in
  Markdown, that gap is real. It also reads only tracked files, so it can say
  nothing about chat transcripts, CI logs, platform env vars, or `.gitignore`d
  files — none of those are code-review surfaces. Nor is GitHub a backstop here:
  `security_and_analysis` reports secret scanning, non-provider patterns,
  validity checks **and push protection all `disabled`** on this repo, and stock
  gitleaks reports "no leaks found" because a bare EVM private key matches none
  of its default rules. **A leaked key would have to be caught by a human.**

### 0.2 Has anyone else used the key?

No. Measured against `https://testnet-rpc.monad.xyz` (`eth_chainId` → `0x279f` =
10143) at head block 57,906,203:

| Reading | Value |
| --- | --- |
| `eth_getTransactionCount` (`latest`) | `0x14` = **20** |
| `eth_getTransactionCount` (`pending`) | `0x14` = **20** — identical, so nothing is queued |
| `eth_getBalance` | `0x1fd020b932ce45400` = **36.677891042 MON** |
| `eth_getCode` | `0x` — a plain EOA, no EIP-7702 delegation |

Latest and pending nonces agree, so no transaction is in flight. Binary search
over historical `eth_getTransactionCount` (the public RPC serves archive reads
for this) pins the last nonce increment, 19 → 20, to block **57,875,449**,
timestamp `0x6a929611` = **2026-08-29 08:19:29 UTC** — transaction
`0x81ff7f98…dce81fb1`, sent to `SimVenue` (`0x7E305794…f7D1bf2`), inside the
deployment window that opens at `deployedBlock` 57,874,280. The key has signed
nothing in the 2 h 37 min since, which covers every minute after the exposure
was recorded in commit `39ce4ed` at 10:21:14 UTC. The balance is unchanged: the
36.67 MON noted earlier is this same 36.677891042, truncated. **No third party
has touched this account.**

Re-check before and after the redeploy. The watermark to compare against is
**nonce 20 / 36.677891042 MON**; any movement means the key is being used by
someone else and the redeploy becomes urgent rather than scheduled.

```
curl -s -X POST https://testnet-rpc.monad.xyz -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionCount","params":["0x85Fe6D9399EA584Ba5344b8d21e27137adbB5738","latest"]}'
```

### 0.3 Blast radius on the current deployment

Whoever holds the key can:

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
