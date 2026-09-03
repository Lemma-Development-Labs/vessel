# /resources/capacity

## Capacity rule (hedge sizing)

Vessel capacity is capped by the **specific market’s open interest** (OI), not by venue-wide OI.

For Perpl, the operational capacity cap is driven by:

- the **market depth** (thin books are fragile),
- the ability to read and verify the hedge inputs (spot mark + position + funding),
- and the **documented cap rule**: keeper sizing must not assume liquidity that isn’t actually there.

## What to check (replayable)

1. Confirm the market you are hedging is the correct one (MON only on testnet).
2. Confirm the keeper’s sizing inputs match the exact hedge instruments.
3. Confirm you can replay the sizing arithmetic from the public inputs the keeper claims.

This page is intentionally conservative: it avoids publishing any “measured depth” numbers until those measurements are written to this repo and can be replayed from public reads.

