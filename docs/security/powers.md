# Privileged powers

Every privileged function in Vessel, who holds it, and what it can do. Verified
against the source on 2026-08-29, not recalled.

> Testnet deployment. Unaudited. dUSD is a valueless demo token. This document
> describes the current on-chain reality, not a target state — where the target
> differs, it says so.

Roles today are all held by a **single EOA**, `0x4307C72a92063df4fa189c9e9621b741d457be7C`.
That key was exposed on 2026-08-29 (see `OPS.md` §0) and moving to a 2-of-3 Safe
is Phase 5. Read the "who holds it" column as a description of a known weakness.

---

## Powers that exist

### Guardian — `0x9f47CA6E0A5B4786362cdBfcCED3710Ea518aa4E`

`Ownable2Step`. Owner verified on chain as the deployer address.

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

### BlitzVault — `0x4E3C935c69FE55D2A21F1CaB00A95c75F4F85823`

`deployer` is `immutable` — it cannot be rotated without redeploying.

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

### Tranches — `0x9350A360b01bA4F87Df1164da97Dcc066c37986d`

`deployer` and `treasury` are both `immutable`.

| Function | Who | Delay | What it does |
| --- | --- | --- | --- |
| `setEngine(address)` | deployer | none, **single-use** | Wires the engine and starts the settle clock. |
| `settle(int256)` | engine only | none | Runs the waterfall. Magnitude capped at `MAX_YIELD_BPS` (50% of TVL). |
| `claimTreasury()` | **anyone** | none | Pays accrued fees. The destination is the `immutable` `treasury` address — the caller cannot redirect it. |

### EngineLite — `0x9FB500D00618C27088c439EdE6EED2c6FeB02455`

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

### SimVenue — `0x7E305794712DB9AdBfbe4be5E6CD43C94f7D1bf2`

`owner` is `immutable`. **This is the simulated venue and the most powerful
non-pause role in the system.**

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

### DemoUSD — `0x7e1Eca4BD693Ca17ADEC1C21cb8a8Cc3edAF6Acc`

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

## Target state (Phase 5, not yet done)

| Item | Today | Target |
| --- | --- | --- |
| Guardian owner | single EOA (exposed) | 2-of-3 Safe |
| Deployer role | single EOA, `immutable` | 2-of-3 Safe — **requires redeploy** |
| Parameter changes | impossible (all `constant`) | unchanged; nothing to timelock |
| Pause | immediate | stays immediate |

Because every economic parameter is `constant`, there is no parameter change for
a timelock to delay. A timelock would only be meaningful over the single-use
wiring setters, and those are already spent on a live deployment. The honest
Phase 5 scope is therefore **multisig ownership**, not a timelock — and moving
the `immutable` deployer role at all means redeploying.
