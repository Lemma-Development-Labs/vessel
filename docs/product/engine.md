# /product/engine

## Engine (infrastructure)

The **Engine** is the infrastructure that nobody “uses” directly:

- It opens and maintains the hedge:
  - **Long spot** exposure (against a WMON spot mark).
  - **Short equal notional** via the venue interface (`IVenue`), so hedge accounting is structurally testable.
- It periodically **cranks**:
  - harvests funding from the venue,
  - marks spot PnL (capped in test/sim),
  - then books the combined gross yield into `Tranches.settle`.
- It is keeper-maintained and permissionlessly crankable within the on-chain pause gates.

## Why it exists

Vessel’s thesis is verifiability: the Engine turns “funding + mark + unwind” into on-chain waterfall inputs you can replay.

