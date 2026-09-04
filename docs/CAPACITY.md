# Capacity — Kuru MON-USDC depth

Source measurements from `script/measureDepth.ts` against the official Kuru
testnet market `0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9` (quote =
`0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570`).

**Rule:** if **1,000 USDC** of market-buy size moves the book more than
**50 bps** vs mid, the genesis deck must shrink to match realised depth.

## Probe — 2026-09-04 (UTC morning slot)

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

### Reading

There is **no sell-side depth** on the official MON-USDC book at this block.
Realised slippage for 100 / 500 / 1,000 / 5,000 USDC cannot be computed until
makers post asks. Until then:

- Genesis AUM for a live Kuru spot path is **zero** (cannot enter).
- `TX_KURU_SPOT` cannot ship honestly.
- Re-run at three times of day once the book is live:

```bash
MEASURE_SLOT=morning   npx tsx script/measureDepth.ts | tee -a docs/CAPACITY.md
MEASURE_SLOT=afternoon npx tsx script/measureDepth.ts | tee -a docs/CAPACITY.md
MEASURE_SLOT=evening   npx tsx script/measureDepth.ts | tee -a docs/CAPACITY.md
```

Prefer `MONAD_TESTNET_RPC` = paid endpoint when available (public RPC is fine
for read-only probes).

## GATE-0 open items

1. Is the Kuru testnet deployment actively maintained? (Python SDK archived;
   TS SDK + docs addresses still resolve.) Ask Vaibhav (Metropolis mentor).
2. How does a stranger mint/acquire Kuru testnet USDC
   (`0x3bA3…1570`)? No public faucet path was found in-repo.
