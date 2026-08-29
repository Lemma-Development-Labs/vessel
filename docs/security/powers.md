# Privileged powers

Every privileged function in Vessel, who holds it, and what it can do. Verified
against the source on 2026-08-29, not recalled.

> Testnet deployment. Unaudited. dUSD is a valueless demo token. This document
> describes the current on-chain reality, not a target state — where the target
> differs, it says so.

Every role that **retains power** after deployment is held by a 2-of-3 Safe at
`0x85Fe6D9399EA584Ba5344b8d21e27137adbB5738` (Safe v1.4.1, threshold 2) — `Guardian.owner`, `Tranches.treasury` and
`SimVenue.owner`, all verified on chain.

**Read this honestly:** all three Safe signer keys were generated on the same
machine, so today it is a 1-of-1 wearing a multisig's clothes. It is *not* yet
the security property "2-of-3" normally implies, and nothing should claim it is.
What it does buy is real and was the reason to do it now: Safe owners are
swappable, so replacing two signers with independently-held keys later needs one
Safe transaction — whereas `Tranches.treasury` and `SimVenue.owner` are
`immutable` and could otherwise only be changed by redeploying the protocol
again. The address is fixed; the humans behind it are not.

The deploying EOA `0x830C52EAda6fcE4D72Ca24F25D84d163aDCf581e` holds the `deployer` role on
`BlitzVault`, `Tranches` and `EngineLite`. Every power that role has —
`setEngine`, `setTranches`, `seedDeadShares`, `wire` — is single-use and was
consumed during deployment, so it now holds nothing. It is a throwaway.

The previous deployment's roles were held by a single EOA whose key was exposed;
those contracts are deprecated and listed in the README.

---

## Powers that exist

### Guardian — `0x150e153D5aB4683EC576bC1F68b7839D86751208`

`Ownable2Step`. Owner verified on chain as the Safe `0x85Fe6D9399EA584Ba5344b8d21e27137adbB5738`.

| Function | Who | Delay | What it does |
| --- | --- | --- | --- |
| `pause()` | owner | **none — immediate** | Sets one bool. Every `whenNotPaused` path in `BlitzVault`, `Tranches` and `EngineLite` reverts. |
| `unpause()` | owner | none | Clears it. |
| `transferOwnership` / `acceptOwnership` | owner / nominee | two-step | Nominee must accept; a typo cannot brick the role. |

Pause is deliberately immediate and deliberately un-delayed. It is the one power
that must not wait, and it is also the one power that **cannot move a single
token** — the Guardian contract holds no funds, has no token approvals, and its
entire state is `bool paused`.

Note the blast radius of pause: it halts joins, exits, `crank`, `settle`,
`deployLiquidity` **and `unwind`**. A paused protocol is a frozen protocol, not a
draining one, but users cannot exit while paused.

### BlitzVault — `0xE1c3aBAd2789aC170833d9E9bd72E706284a70c5`

`deployer` is `immutable`, but every power it has is single-use and already
spent — so the role is inert. It is not the Safe, and it does not need to be.

| Function | Who | Delay | What it does |
| --- | --- | --- | --- |
| `setEngine(address)` | deployer | none, **single-use** | Wires the engine. Reverts once set. |
| `setTranches(address)` | deployer | none, **single-use** | Wires the tranche router. Reverts once set. |
| `seedDeadShares(uint256)` | deployer | none, **one-shot** | Mints the inflation-mitigation dead shares to `0x…dEaD`. Cannot be repeated. |
| `pullForEngine(uint256)` | engine only | none | Moves idle dUSD to the engine, bounded by the idle balance. |
| `returnFromEngine(uint256)` | engine only | none | Pulls principal back. |
| `creditYield(uint256)` | engine only | none | Donates realised yield; raises share price. |
| `notifyLoss(uint256)` | engine only | none | Reduces `deployed`, bounded by `deployed`. |
| `deposit` / `mint` | **`tranches` only** | none | Share issuance is closed. See below. |

**Share issuance is restricted to `Tranches`.** This is a solvency requirement,
not tidiness. `Tranches` keeps an asset-denominated book (`hullTvl + balTvl +
reserve + treasuryAccrued`) that it redeems through the vBLITZ it holds, while
`creditYield` raises the share price for *every* holder. An outside shareholder
would capture a pro-rata slice of yield that `Tranches` has already credited to
Hull and Ballast in full, leaving its book larger than what its shares can
redeem — the last exiters could not be paid.

### Tranches — `0xdb4666c3F187e73795bcF9Cfb3a6D64A875EF842`

`deployer` and `treasury` are both `immutable`. `treasury` is the Safe; `deployer` is the spent throwaway.

| Function | Who | Delay | What it does |
| --- | --- | --- | --- |
| `setEngine(address)` | deployer | none, **single-use** | Wires the engine and starts the settle clock. |
| `settle(int256)` | engine only | none | Runs the waterfall. Magnitude capped at `MAX_YIELD_BPS` (50% of TVL). |
| `claimTreasury()` | **anyone** | none | Pays accrued fees. The destination is the `immutable` `treasury` address — the caller cannot redirect it. |

### EngineLite — `0xDE65E58df3e3da55DD3c6e107E30E1655Fb5fC85`

| Function | Who | Delay | What it does |
| --- | --- | --- | --- |
| `wire(...)` | deployer | none, **single-use** | Binds vault, tranches, venue, router, WMON. Reverts once wired. |
| `crank()` | **anyone** | none | Sweeps funding, marks spot, settles. |
| `deployLiquidity()` | **anyone** | none | Deploys up to 90% of vault assets into the hedge. |
| `unwind()` | **anyone** | none | Closes the short, swaps WMON back, returns everything to the vault. |

`crank`, `deployLiquidity` and `unwind` are permissionless by design. This is why
the hosted keeper key is safe to run: it pays gas to call a function anyone could
call, holds no dUSD, and has no approvals. A leaked keeper key costs the MON in
that account and nothing else.

It is also why the app exposes `unwind` directly to users rather than hiding it
behind an owner they would have to petition — if your exit needs the hedge
unwound, you can do it yourself.

### SimVenue — `0xAbE34e4919e7Ffd5C87D5B62d35f7E7Bb4e50FD7`

`owner` is `immutable` and is the Safe. **This is the simulated venue and the
most powerful non-pause role in the system**, which is exactly why it is not an
EOA.

| Function | Who | Delay | What it does |
| --- | --- | --- | --- |
| `setFundingRateBps(int256)` | owner | none | Sets the simulated funding rate. Bounded to ±`MAX_RATE_BPS` (10,000 = ±100%). |
| `seed(uint256)` | anyone | none | Funds the pot that pays positive funding. |
| `openShort` / `closeShort` / `sweepFunding` | anyone, position-scoped | none | `closeShort` and `sweepFunding` check `p.opener == msg.sender`. |

A malicious `SimVenue` owner can set funding deeply negative, which charges
losses to Ballast and can drive `settle` into `HullImpairment`. That power exists
because SimVenue is a **simulation** whose whole purpose is to demonstrate good
and bad days on demand. It is a reason SimVenue must never be treated as a real
venue, and it disappears when Phase 6.2 replaces it with Perpl.

### DemoUSD — `0x66B5A41466b1Ab2dE34Bf3834b26F99bA4f52e05`

**No privileged functions at all.** No owner, no admin, no roles.

---

## Powers that do NOT exist

The absent powers are the interesting half. Each of these was checked against the
source, and each is a thing a reader is entitled to assume exists until told
otherwise.

- **No admin mint.** `DemoUSD` has no owner and no privileged mint. The only
  issuance path is the public `faucet()`, capped at 100 dUSD per hour and 1,000
  dUSD lifetime per address. Nobody can inflate the supply.
- **The guardian cannot move funds.** It holds no tokens, has no approvals, and
  its complete state is one boolean. Pause is the only thing it does.
- **No parameter setters.** `HULL_RATE_BPS` (800), `FEE_BPS` (1,000),
  `RESERVE_TARGET_BPS` (200), `THETA_MIN_BPS` (2,000), `MAX_YIELD_BPS` (5,000),
  `MIN_JOIN`, `SHARES_OFFSET`, `DEPLOYABLE_BPS` (9,000), `SLIPPAGE_BPS` (200) and
  `SPOT_PNL_CAP_BPS` (500) are all `constant`. **The economics cannot be changed
  by anyone, including the deployer, without deploying new contracts.** This is
  the strongest guarantee in the system.
- **No upgradeability.** No proxy, no `delegatecall` to a mutable implementation,
  no beacon. What is deployed is what runs.
- **No treasury redirection.** `Tranches.treasury` is `immutable`. Fees can only
  ever go to the address fixed at construction.
- **No re-wiring.** `setEngine`, `setTranches` and `wire` are all single-use and
  revert on a second call. The deployer cannot swap the engine for a malicious one
  after the fact.
- **No emergency withdraw.** There is no function that lets any role move user
  assets out of the vault. The engine can only pull to itself under the 90% cap
  and can only return.
- **No forced exit or blacklist.** No role can burn, freeze, or seize a user's
  Hull or Ballast tokens.
- **No pause-and-drain.** Pausing does not unlock any withdrawal path that is
  otherwise closed. It closes paths; it opens none.

---

## Key management — done, and what is still missing

| Item | Status |
| --- | --- |
| `Guardian.owner` | 2-of-3 Safe ✅ |
| `Tranches.treasury` | 2-of-3 Safe ✅ (immutable — set correctly at deploy) |
| `SimVenue.owner` | 2-of-3 Safe ✅ (immutable — set correctly at deploy) |
| `deployer` role | throwaway EOA, all powers spent ✅ |
| Safe signers independently held | ❌ all three generated on one machine |
| Timelock on parameter changes | not applicable — every economic parameter is `constant`, so there is no parameter change to delay |

The one outstanding item is the signers. Replacing two of the three with keys
held elsewhere is a single Safe transaction and needs no redeploy.
