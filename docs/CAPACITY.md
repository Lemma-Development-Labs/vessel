# Capacity — Kuru MON-USDC depth

Source measurements from `script/measureDepth.ts` against the official Kuru
testnet market `0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9` (quote =
`0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570`).

**Rule:** if **1,000 USDC** of market-buy size moves the book more than
**50 bps** vs mid, the genesis deck must shrink to match realised depth.

## Probe — 2026-09-04 (UTC morning)

| Field | Value |
| --- | --- |
| Slot | `2026-09-04T06:58:49Z` |
| Block | `59560667` |
| bestBid | `type(uint256).max` (empty-book sentinel) |
| bestAsk | `0` |
| pricePrecision | `1e8` |
| emptyBook | **true** |

| USDC in | baseOut (MON) | mid | effective | slippage bps | note |
| --- | --- | --- | --- | --- | --- |
| 100 | — | — | — | — | no ask liquidity at block 59560667 |
| 500 | — | — | — | — | no ask liquidity at block 59560667 |
| 1,000 | — | — | — | — | no ask liquidity at block 59560667 |
| 5,000 | — | — | — | — | no ask liquidity at block 59560667 |

## Probe — 2026-09-04 (UTC afternoon)

| Field | Value |
| --- | --- |
| Slot | `afternoon` |
| Block | `59645259` |
| bestBid | `type(uint256).max` |
| bestAsk | `0` |
| emptyBook | **true** |

| USDC in | baseOut (MON) | mid | effective | slippage bps | note |
| --- | --- | --- | --- | --- | --- |
| 100 | — | — | — | — | no ask liquidity at block 59645259 |
| 500 | — | — | — | — | no ask liquidity at block 59645259 |
| 1,000 | — | — | — | — | no ask liquidity at block 59645259 |
| 5,000 | — | — | — | — | no ask liquidity at block 59645259 |

### Reading

There is **no sell-side depth** on the official MON-USDC book across morning and
afternoon probes. Realised slippage cannot be computed until makers post asks.
Genesis AUM for a live Kuru spot path remains **zero**. `TX_KURU_SPOT` cannot
ship honestly. Evening probe still outstanding:

```bash
MEASURE_SLOT=evening npx tsx script/measureDepth.ts
```

Prefer `MONAD_TESTNET_RPC` = paid endpoint when available.

## GATE-0 open items

1. **Is Kuru testnet actively maintained?** Docs addresses still match
   ([Contract addresses](https://docs.kuru.io/contracts/Contract-addresses));
   TS SDK works; Python SDK is archived. Book has been empty for hours —
   ask Vaibhav (Metropolis mentor) whether makers are expected back.
2. **Stranger path for Kuru testnet USDC (`0x3bA3…1570`):** Official docs list
   the token but **do not** document a faucet. Community guides describe:
   claim test MON via the Kuru UI faucet → Lite Swap MON→tUSDC. Treat that as
   **unverified** until confirmed with Kuru / Vaibhav — token itself has no
   on-chain `faucet()` that succeeds.
3. **Ship scripts ready** (need `DEPLOYER_PK` + ask liquidity):
   - `forge script script/DeployKuruRouter.s.sol --rpc-url $RPC --broadcast`
   - `KURU_ROUTER=0x… forge script script/SwapViaKuruRouter.s.sol --rpc-url $RPC --broadcast`
   - Verify via `https://agents.devnads.com/v1/verify` (scaffold skill)
   - Append `TX_KURU_SPOT` to `docs/ADDRESSES.md`, then flip logo / SIM chip
