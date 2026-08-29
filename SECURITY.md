Unaudited. Do not deposit real money. There is no external security audit; this document is not a substitute for one.

## Contact

Report vulnerabilities to the maintainers of [Lemma-Development-Labs/vessel](https://github.com/Lemma-Development-Labs/vessel). Prefer a private GitHub security advisory. Do not open a public issue for an exploitable finding.

## What is real vs simulated

| Surface | Status |
| --- | --- |
| DemoUSD faucet, BlitzVault (ERC-4626), Tranches waterfall, EngineLite accounting | On-chain. Tokenomics as specified. |
| Spot leg | On-chain swap via the wired router. **Mark is pool mid (manipulable).** Per-crank spot PnL is capped at ±5% of the last marked spot value (`SPOT_PNL_CAP_BPS`). Real fix = TWAP/oracle. |
| Short-leg funding | **Simulated.** `SimVenue` implements `IVenue`. `isSimulated() == true`. |
| PerplVenue | Stub. Every mutative call reverts `NotImplemented()`. |
| dUSD | Valueless demo token. No privileged mint. Not USDC. |

## Known limitations (v0 / testnet)

1. **Spot mark is manipulable.** EngineLite `_spotValue()` uses `router.getAmountsOut` (pool mid). A6 mitigation: ±5% of last spot per crank. Mainnet gap: TWAP or dedicated oracle.
2. **Share issuance is closed (was: public ERC-4626).** `deposit`/`mint` are now `onlyTranches`; previews stay open. The original framing — "raw deposits bypass the 20% floor" — was imprecise: a raw deposit never touches `hullTvl`/`balTvl`, so the ratio was never breached. The real exposure was worse. Tranches keeps an asset-denominated book it redeems through its own vBLITZ, while `creditYield` lifts the share price for *every* holder, so an outside shareholder captured a slice of yield that `settle()` had already credited to Hull and Ballast in full — leaving the book unredeemable and the last exiters unpaid. Tests: `test/unit/ShareIssuance.t.sol`, `test/fuzz/Solvency.t.sol`. The dead-share seed is now an explicit one-shot `seedDeadShares()`.
8. **Dead-share yield leak (open).** The protocol's own 100 dUSD dead-share seed holds real vBLITZ, so every yield credit strands `g × deadShares / totalShares` in a position nobody can redeem — 11.1% at 800 dUSD of deck TVL, and roughly 65% against the 54 dUSD currently on testnet. Tranches' book therefore runs ahead of what its shares can withdraw, and a full final exit can revert. Value is misallocated, not missing: the vault still backs the book once the dead position is counted. Pinned by `test_deadShareSeedDilutesEveryYieldCredit`. Closing it is an economic change to a deployed protocol, so it is a decision, not a patch.
3. **Ledger vs vault cash.** `settle()` books Hull/Ballast/reserve/treasury NAV. Positive **spot mark** does not mint dUSD. `totalAssets == idle + deployed` always. `hullTvl+balTvl+reserve+treasuryAccrued` can exceed vault cash until `unwind()` realizes the spot leg. Unfunded `settle` (engine-only, tests) diverges by construction.
4. **Single-key owner / guardian.** Guardian is pause-only (proven by test). Mainnet gap: timelock + multisig, published guardian policy.
5. **No deposit caps.** Mainnet gap: progressive limits.
6. **SimVenue funding pot.** Positive funding is paid from a seeded pot. Empty pot reverts `InsufficientPot`.
7. **Free / testnet ops.** Keeper `/health` paging is a mainnet gap. dUSD faucet is a demo.

Until every line in the README “honest gap” is crossed, the banner stays amber and the first word stays **unaudited**.
