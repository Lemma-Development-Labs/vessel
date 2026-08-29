# HARDENING.md

**Not an audit.** Testnet-production engineering. Tokenomics and the waterfall spec were not changed. Structural issues are listed as red flags, not papered over.

Date: 2026-08-29. Branch: `cursor/vessel-delta-neutral-vault-1a23`.

## Numbers

| Check | Result |
| --- | --- |
| `forge test --offline` (local fuzz 10k) | **81 passed**, 0 failed |
| `forge test --fuzz-runs 25000` | **81 passed** locally with `FOUNDRY_PROFILE=ci` |
| Line coverage `src/` ex Perpl stub | **482/483 = 99.79%** — [contracts/coverage-report.md](./contracts/coverage-report.md), `contracts/coverage/lcov.info` |
| Slither | 38 results, **0 High**. All triaged below. Zero unexplained. |
| Max runtime bytecode | EngineLite **7328** bytes (limit 128 KiB) |
| `pnpm e2e` | **PASS** on Anvil 31337 (table below). **Not run on live 10143** (no funded burner/deployer in this environment). |
| `pnpm build` (app) | green |

---

## A. Smart-contract security sweep

### A1. ERC-4626 inflation

- `BlitzVault._decimalsOffset() = 6` (`DECIMALS_OFFSET`).
- `Deploy.s.sol` faucets the deployer and deposits **100 dUSD** to `0x000000000000000000000000000000000000dEaD` before the vault is public.
- `test/unit/Inflation.t.sol`: donation + 1-wei first deposit; attacker finishes **poorer**; victim keeps ≥99% principal.

### A2. CEI + reentrancy

- `nonReentrant` on every mutative external in Vault / Tranches / Engine (`deposit/mint/withdraw/redeem`, `pull/return/creditYield/notifyLoss`, `join/exit/claimTreasury/settle`, `wire/deployLiquidity/crank/unwind`).
- Join: TVL + mint, then `safeTransferFrom` + vault deposit.
- Exit: TVL updated, then `burn`, then `withdraw`.
- `returnFromEngine`: `deployed` reduced, then `transferFrom`.
- Router/venue/vault: `forceApprove(0)` then amount.
- Tests: `Reentrancy.t.sol` (HookToken + ReenteringVenue). Both expect revert.

### A3. Rounding (protocol + senior)

| Op | Rule | Test |
| --- | --- | --- |
| Share mint | floor `(assets * supply) / tvl` | `Rounding.t.sol` 1-wei |
| Share burn | floor assets out | 1 share → 0 dust |
| Hull accrual | `mulDiv` Floor | `test_hullAccrualFloors` |
| Protocol fee | Ceil | `G=1` → fee 1 |
| Loss vs Ballast | full wei | `settle(-1)` drops `balTvl` by 1 |

**Note:** fee ceil is wei-level vs a floor-only fee. Rates (`HULL_RATE_BPS=800`, `FEE_BPS=1000`) unchanged. Conservation still holds (`G=1` → fee 1, remainder 0).

### A4. int256 waterfall

- `grossYield == type(int256).min` → `ImplausibleYield`.
- `|G| > 50%` of `hullTvl+balTvl+reserve` (`MAX_YIELD_BPS=5000`) → `ImplausibleYield`.
- Solidity 0.8 checked math on `funding + spotPnl`.
- Engine: `IntOverflow` if `funding == int256.min` or `uint→int` overflow.
- Tests: `test_int256MinYieldReverts`, `test_settleAtYieldCapConserves`, `test_settleNegativeCapDrainsBallast`.

### A5. Access-control matrix

| Selector | Function | Who |
| --- | --- | --- |
| `0xde5f72fd` | `DemoUSD.faucet` | anyone (cooldown/cap) |
| `0x0e830e49` | `BlitzVault.setEngine` / `Tranches.setEngine` | deployer, once, not paused |
| `0x6e553f65` `0x94bf804d` `0xb460af94` `0xba087652` | vault `deposit/mint/withdraw/redeem` | anyone, not paused |
| `0x4d69029b` `0x848a49fc` `0xe5c58e5b` `0x61f3d110` | `pullForEngine` / `returnFromEngine` / `creditYield` / `notifyLoss` | engine only |
| `0x0aa80dc0` `0x909f9c95` | `joinHull` / `joinBallast` | anyone, not paused, `MIN_JOIN=1e6` |
| `0x23951cba` `0x7018e471` | `exitHull` / `exitBallast` | anyone, not paused |
| `0x003bdc74` | `claimTreasury` | anyone, not paused (pull to immutable treasury) |
| `0x5d0f3959` | `settle` | engine only |
| `0xb8bc6235` | `EngineLite.wire` | deployer, once |
| `0x4086bf89` `0x9c16a9e8` `0x807763ab` | `deployLiquidity` / `crank` / `unwind` | anyone, not paused |
| `0x8456cb59` `0x3f4ba83a` | `Guardian.pause` / `unpause` | Ownable2Step owner only |

Wire-once: `EngineAlreadySet` / `AlreadyWired` tests green.

Guardian **cannot** move funds: `GuardianFundsTest` — no `transfer`/`pullForEngine`/`withdraw` on the guardian contract; pause/unpause does not change vault balances. Owner calling `vault.pullForEngine` reverts `NotEngine`.

Pause matrix: `PauseMatrixTest.test_everyMutativeSelectorRevertsWhenPaused` covers the selectors above plus `setEngine` on a fresh Tranches. Views (`totalAssets`, `deckStats`, `netDelta`) still work.

### A6. Oracle / spot mark

Engine marks spot from `router.getAmountsOut` (pool mid). **Manipulable.**

Mitigation: `SPOT_PNL_CAP_BPS = 500` (±5% of `lastSpotValue` per crank). Event `SpotPnlCapped`. Tests: `test_spotPnlCapEmits`, `test_negativeSpotPnlIsCapped`.

Loud limitation: README, SECURITY.md, this file. Real fix = TWAP/oracle (mainnet gap). `lastSpotValue` is set to the **uncapped** mark so a persistent manipulation is not fully ignored — only the per-crank PnL booked into `settle` is capped.

### A7. Token hygiene

- `SafeERC20` + `forceApprove` on all non-mint transfers.
- `src/lib/Decimals.sol`: 6↔18 (`dusdToWmon`, `wmonToDusdDown`, `wmonToDusdUp`). Tests in `Decimals.t.sol`. MockRouter uses it.

### A8. Griefing

- Faucet: cooldown + lifetime cap tested (`DemoUSD.t.sol`).
- `MIN_JOIN = 1e6` (1 dUSD). Dust reverts `BelowMinJoin`.
- 100 cranks in one block: first `crank` succeeds; next 99 revert `DtZero` (`test_hundredCranksSameBlockOnlyFirstSucceeds`). Harmless (dt-based).

### A9. Slither (38 results, 0 High)

Config: `contracts/slither.config.json` (`filter_paths` lib/test/script).

| Detector | Impact | Count | Verdict |
| --- | --- | --- | --- |
| `uninitialized-local` | Medium | 11 | **FP.** Solidity zero-inits `fee`, `funding`, `shortNotional`, etc. We rely on 0. |
| `incorrect-equality` | Medium | 5 | **FP.** Intentional `dt == 0`, empty-balance, empty-denom checks. |
| `reentrancy-no-eth` | Medium | 4 | **FP.** `nonReentrant`. TrancheToken burn has no hooks. Engine venue/router called under the same guard; `test_maliciousVenueCannotReenterCrank`. |
| `unused-return` | Medium | 4 | **FP.** ERC-4626 `deposit`/`withdraw` return values unused by design; `position()` second field unused. |
| `reentrancy-benign` | Low | 3 | **FP.** Same guard; state after external calls is `lastSpotValue`/`lastCrank`/`shortId`. |
| `timestamp` | Low | 8 | **FP.** dt-based faucet/crank/funding is the design. |
| `missing-zero-check` | Low | 1 | **Fixed.** `MockWMON.setRouter(0)` reverts `NotRouter`. |
| `unindexed-event-address` | Info | 1 | **Accepted.** Changing `Wired` would break ABI; not a fund-flow issue. |
| `immutable-states` | Opt | 1 | **Fixed.** `Tranches.treasury` is `immutable`. |

No High. No unexplained Medium.

---

## B. Test depth

- Inflation, reentrancy, rounding, pause matrix, guardian funds, implausible yield, 100-crank, empty hull/ballast, rate flip, unwind, claimTreasury, fork skip.
- Invariants (`Conservation.t.sol`, 10k local / 25k CI):
  - conservation `ΔH+ΔB+ΔR+ΔT == G`
  - floor on joins/exits
  - hull never down while `bal+reserve > 0`
  - vBLITZ `previewRedeem` monotone under `G≥0`
  - `totalAssets == idle + deployed` after those sequences
- Fork: `test/fork/ForkAccounting.t.sol` skips unless `ADDRESSES.json` is chain 10143 with code.

### Red flag — ledger vs vault cash (B2 “sum-of-parts”)

`settle()` books Hull/Ballast/reserve/treasury **without** moving dUSD. Identity that **always** holds:

`vault.totalAssets() == IERC20(dUSD).balanceOf(vault) + vault.deployed()`

Identity that **does not** hold after an unfunded settle or a positive **spot mark**:

`hullTvl + balTvl + reserve + treasuryAccrued == totalAssets`

Characterization: `test_unfundedSettleDivergesLedgerFromVaultCash`. Engine path credits **funding** cash via `creditYield` before settle; **spot PnL is marked**. Full Hull exit after `deployLiquidity` needs `unwind()` so idle ≥ payout (10% buffer otherwise). e2e step 6a2 documents this.

Public ERC-4626: anyone can `vault.deposit` and skip the 20% floor. Engine deploys 90% of **all** vault assets. Spec kept standard 4626.

---

## C. Gas + Monad

Explicit limits (`app/lib/gas.ts`), ~1.3× observed test usage, capped. Monad charges the **limit**.

| Write | Limit |
| --- | --- |
| faucet | 200_000 |
| approve | 80_000 |
| join | 650_000 |
| exit | 550_000 |
| crank | 1_300_000 |
| deployLiquidity / unwind | 1_500_000 |

Snapshot: `contracts/.gas-snapshot` (excludes `testFuzz` and fork). CI: `forge snapshot --check --tolerance 10`.

Worst-case user writes are under their constants. `test_hundredCranksSameBlockOnlyFirstSucceeds` is 6.9M because it is 100 calls, not one crank.

Sizes: max runtime 7328 bytes.

---

## D. App + keeper

- Global `ErrorBoundary` (designed failure screen). Mutations: `runTx` try/decode/toast. Clicks `void`. `switchNetwork` catch on add-chain.
- Join disabled unless numeric, ≤6 dp, `≥ MIN_JOIN`, `≤ balance`. Mock path enforces `MIN_JOIN`.
- `fallback()` transport: `NEXT_PUBLIC_RPC` CSV + `NEXT_PUBLIC_RPC_FALLBACK`.
- Stale chip: `stale · reconnecting` when the multicall query errors (devtools offline).
- Keeper: chainId match, `getCode` on every `ADDRESSES` entry, MON ≥ 0.5, heartbeat every cycle, **3 consecutive unexpected failures → `process.exit(1)`**. `DtZero`/`Paused`/… are skips, not failures. No tight retry (interval). Gas cap `GAS.crank`.
- Secrets: `.env.example` on all three surfaces. `scripts/check-secrets.mjs`. Deployer ≠ seeder/keeper ≠ e2e burner (Anvil 0 / 1 / 2).

`USE_MOCK=1` remains the stage fallback (`NEXT_PUBLIC_USE_MOCK` defaults on).

---

## E. CI + disclosure

- `.github/workflows/ci.yml`: `forge fmt --check`, `FOUNDRY_PROFILE=ci` 25k fuzz, coverage gate, snapshot ±10%, slither `--fail-none` (findings triaged here), sizes, app `pnpm build`, secrets scan.
- Badge in README: `https://github.com/Lemma-Development-Labs/vessel/actions/workflows/ci.yml/badge.svg`
- [SECURITY.md](./SECURITY.md) unaudited first line.
- Addresses: README + [docs/ADDRESSES.md](./docs/ADDRESSES.md). Testnet 10143 broadcast 2026-08-29 at block 57874280; Sourcify submitted (`solc 0.8.24` / 200 / via-ir).

---

## e2e PASS table (Anvil 31337)

`pnpm e2e` — burner `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`. Wait: `evm_increaseTime(60)` (testnet would be 60s wall clock). Negative epoch via `setFundingRateBps(-2400)` then crank. Conservation from `Waterfall` fields: `hullAccrual+toBallast+toReserve+toTreasury-fromBallast-fromReserve == gross` (21 wei). Hull NAV unchanged on the shortfall epoch; Ballast NAV decreased by `fromBallast` exactly. Full Hull exit after `unwind` paid **40000008** = 40e6 + 8 wei accrued.

| step | expected | actual | tx |
| --- | --- | --- | --- |
| PASS preflight getCode all ADDRESSES | non-empty | 11 contracts | — |
| PASS 1 faucet +100 dUSD | 100000000 | 100000000 | `0x53cb841fded2df169973decbd386823db072e4e3aa37b787b4a79edbd3390074` |
| PASS 2a joinBallast 60 shares > 0 | >0 | 60000000000000000000 | `0x8457512d7f7d69875d13c5b9db2d8bb2db49944d3bf2f5140bb35a20e992af06` |
| PASS 2b joinHull 40 shares > 0 | >0 | 40000000000000000000 | `0x3620527f4966590a521530fa8fe9037d6d224cb3cd521620941490a94e420e22` |
| PASS 2c subordination ≥ 20% | >= 2000 bps | 6000 | `0x3620527f4966590a521530fa8fe9037d6d224cb3cd521620941490a94e420e22` |
| PASS 3a spot WMON > 0 | >0 | 90000000000000000000 | `0xde7c150a3c747330ebda06730f88061e6fcacb4ddfdd92186aae9444a0bb05a1` |
| PASS 3b shortNotional > 0 | >0 | 90000000 | `0xde7c150a3c747330ebda06730f88061e6fcacb4ddfdd92186aae9444a0bb05a1` |
| PASS 3c \|netDeltaBps\| ≤ 100 | <= 100 | 0 | `0xde7c150a3c747330ebda06730f88061e6fcacb4ddfdd92186aae9444a0bb05a1` |
| PASS 4 conservation identity (wei) | 21 | 21 | `0x4d1c457d975e669757bdf57c31f24da87dd46d35ee8039db4fe9374a1e55e99a` |
| PASS 5a hull NAV unchanged | 40000008 | 40000008 | `0x2f4f22c9c95d07a23ceb6d572d75c827bbd3a761684217ce8fbd5f83e4ee05a7` |
| PASS 5b ballast NAV − shortfall | 59999964 | 59999964 | `0x2f4f22c9c95d07a23ceb6d572d75c827bbd3a761684217ce8fbd5f83e4ee05a7` |
| PASS 6a floor after partial ballast exit | >= 2000 bps | 5744 | `0xad151512a0817f6de11f6456b1bc0ed0501c7e345be0fb76da076c543c57825e` |
| PASS 6a2 unwind for idle cash | success | success | `0xdf5f4b5a8024d2f3d221897f4fe2af7c19d5aa61921d9683d9df691837985e36` |
| PASS 6b exitHull payout = principal + accrued | 40000008 | 40000008 | `0x245289833a0f43ed361d94ac58ed0306d6e317c06d281b8bf9067d7719a8ac01` |

Screenshot: [docs/e2e-pass.html](./docs/e2e-pass.html) (open locally). Live testnet + explorer VERIFIED marks: **not done here**.

---

## Red flags (do not ship real deposits)

1. Unaudited. External audit is the whitepaper gate.
2. SimVenue, not Perpl. Spot mark is pool mid; ±5% cap is a tripwire.
3. Public ERC-4626 bypasses Ballast floor.
4. Ledger NAV can exceed vault cash (unfunded settle / marked spot). Large exits need `unwind`.
5. Single-key deployer/guardian. No deposit caps.
6. No testnet/mainnet verify in this environment.

Until every line of the README honest gap is crossed, the banner stays amber.
