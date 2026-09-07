# /risk

## Venue (capacity / funding)

- Perpl open interest (OI) is the practical capacity cap for the hedge: if the market is thin, you do not have a hedge with the size you want.
- Funding sign can flip frequently. A strategy that assumes “typical” funding without checking the on-chain (or indexer) tape is at risk.
- Hedge verification is only as good as the ability to read the exchange position + funding feed you claim to be using.
- Testnet market under consideration is **MON** (Perpl market id `64`). Do not read “ETH, BTC, MON LSTs” as present-tense product.

## Tranche wipe: Ballast can go to zero

Ballast is the first-loss underwriting seat. In stress, Ballast (and then reserve) absorb losses before Hull. If losses exceed the remaining protection, Ballast can be wiped out.

**Code truth (important):** `Tranches.settle` with a loss larger than Ballast+reserve **reverts** (`HullImpairment`). Hull NAV is **not** haircut on-chain today — the engine halts rather than writing Hull down. Copy that says “then Hull” as if Hull absorbs residual loss is wrong.

## Stuck funds — who can call `unwind()`, and what if the key is lost?

After `deployLiquidity()`, ~90% of vault cash sits at the engine (spot + short). Recovery is `EngineLite.unwind()`.

| Question | Answer |
| --- | --- |
| Who can call `unwind`? | **Anyone** (permissionless) when the Guardian is **not** paused. |
| Who can call `crank` / `deployLiquidity`? | Anyone (permissionless), subject to pause and engine rules. |
| Does the UI always expose Unwind? | It must — a hidden Unwind with capital deployed is a stuck-funds bug. |
| Empty book / router revert | Unwind can fail if the spot leg cannot quote out. Inventory stays at the engine until a quote works. |
| Dead keeper | Crank/unwind remain callable by any EOAs; hedge *maintenance* stops; waterfall can go stale. |
| **Guardian pause** | Mutative paths including **unwind, exits, withdraw** revert while paused. Deployed capital is frozen until the pause owner unpauses. **This is the highest stuck-funds class we disclose.** |
| Keeper key lost | Alone does **not** permanently stuck funds (permissionless unwind/crank), but the hedge stops being maintained. |
| Guardian / Safe key lost while paused | **Permanent freeze** of deployed capital until that key recovers. Treat pause-key custody as critical. |

### Privileged functions (access-control table)

| Surface | Function | Who |
| --- | --- | --- |
| Guardian | `pause` / `unpause` | Owner (Safe `0x85Fe…` on testnet — verify signer set independently) |
| BlitzVault | `setEngine`, `setTranches`, `seedDeadShares` | Owner (spent / one-shot where applicable) |
| BlitzVault | `deposit` / `mint` | **onlyTranches** (not public) |
| Tranches | `setEngine`, settle source | Owner / engine |
| Tranches | `joinHull` / `joinBallast` / `exit*` | Anyone (subject to floor + pause) |
| EngineLite | `wire` | Owner (one-shot) |
| EngineLite | `deployLiquidity` / `crank` / `unwind` | Anyone (subject to pause) |
| SimVenue | funding admin | Owner |
| DemoUSD | `faucet` | Anyone (rate + lifetime caps) |

There is **no upgrade proxy**. Bug fixes require redeploy + migration.

## The three-stable mismatch (explicit disclosure)

There are **three different dollar tokens** on Monad testnet (chainId `10143`). Never assume any two are the same token:

- **Circle USDC** (exists; **no Kuru market**): `0x534b2f3A21130d7a60830c2Df862319e593943A3`
- **Kuru testnet USDC** (quote of the official MON-USDC market): `0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570`
- **Perpl testnet collateral** — **GATE-0 drift**: api-docs README lists USD `0xdf5b718d8fcc173335185a2a1513ee8151e3c027`; live `/v1/pub/context` and docs.perpl.xyz list aUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`. Prefer the live context endpoint.

**Live Vessel vault asset today is DemoUSD** `0x66B5A41466b1Ab2dE34Bf3834b26F99bA4f52e05`, **not** Kuru USDC. Chips that say “asset: TESTNET USDC (Kuru)” are aspirational until `vault.asset()` matches and `TX_KURU_SPOT` is a real hash.

Mainnet AUSD at `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` does **not** exist on testnet.

## Keeper custody + key loss

This system is permissionlessly crankable, but keeper operations do require custody of the right keys and reliable transaction submission. If the keeper key is lost or never funded, the hedge can stop being maintained and your waterfall can become stale. Prefer CRE consensus for the *decision* (see `docs/CRE.md`) — simulation shipped; DON deploy is Early Access.

## Oracle / price risk on a thin CLOB

Any “spot” mark derived from a pool or order book is vulnerable to manipulation on thin markets. Even if the short leg is correct, the net delta can be wrong if the mark you use is stale or manipulable. EngineLite marks from `router.getAmountsOut` with a ±5% per-crank spot PnL cap — not a TWAP.

## Monad-specific (gas / state)

- Monad bills **gas_limit**, not gas_used. Any UI or indexer cost that uses `gasUsed` is wrong.
- Do not do historical archive reads against a public RPC; use the indexer.
- Async execution: block state can still move after inclusion; prefer `safe`/`finalized` for irreversible UX confirms when available.

## Unaudited / testnet / valueless tokens

Everything here is testnet and **unaudited**. “Demo dollars” and other testnet tokens can be valueless outside the test environment. Never claim “audited”, “partnered”, “guaranteed”, or “APY”.

## Resolv (USR/RLP) dual-tranche caution

Resolv (USR/RLP, exploited March 2026) is our direct cautionary analog: dual-tranche designs can fail in ways that look “locally correct” (accounting invariants hold) but still break economically via routing, oracle/mark choices, or mismatch between the hedged asset and the collateral identity. Readers should raise this concern first.

## Not Vessel Finance

This is **not** Vessel Finance (`vessel.finance` is a different ZK order-book DEX).
