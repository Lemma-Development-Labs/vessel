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
2. **Share issuance is closed (was: public ERC-4626).** `deposit`/`mint` are now `onlyTranches`; previews stay open. Tests: `test/unit/ShareIssuance.t.sol`, `test/fuzz/Solvency.t.sol`. Dead-share seed is one-shot `seedDeadShares()`.
3. **Dead-share yield leak (open).** Protocol-owned dead vBLITZ strands a slice of every yield credit. Tranches' book can run ahead of redeemable cash for live holders. Pinned historically by `test_deadShareSeedDilutesEveryYieldCredit` (verify live bytecode). Closing it is an economic change to a deployed protocol.
4. **Ledger vs vault cash.** `settle()` books Hull/Ballast/reserve/treasury NAV. Positive **spot mark** does not mint dUSD. `totalAssets == idle + deployed` always. Book can exceed vault cash until `unwind()` realizes the spot leg.
5. **Guardian pause (ingress-only).** Pause freezes joins / deploy / crank / settle / pull. **Emergency egress is allowed:** `EngineLite.unwind`, tranche exits, vault `withdraw`/`redeem`, and engine callbacks needed for unwind. Mainnet gap: timelock + real multisig, published guardian policy.
6. **No deposit caps.** Mainnet gap: progressive limits.
7. **SimVenue funding pot.** Positive funding is paid from a seeded pot. Empty pot reverts `InsufficientPot`.
8. **Free / testnet ops.** Keeper `/health` paging is a mainnet gap. dUSD faucet is a demo.

Until every line in [`docs/MAINNET-READY.md`](./docs/MAINNET-READY.md) Gates 0–4 is green — including a **third-party audit report** — the banner stays amber and the first word stays **unaudited**. Internal FINDINGS / Slither / fuzz are not Gate 3.
