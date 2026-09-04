# /build-log

## Defect: fabricated `fundingAccrued = 0` path

### What broke

The UI had a structural half-bug where `fundingAccrued` was effectively hardcoded to `0n` (or fetched but discarded) in parts of the read → display path. This is the exact “fabricated zero” defect your `/build-log` thesis calls out: it makes a missing/failed chain read look like a correct numeric value.

### Why it mattered

`fundingAccrued` is part of the hedge verification surface. If you can’t verify the hedge, you don’t own the yield.

### How we found it

The app’s internal “Rule 0” checks catch any code path where a user-readable field can be produced without first proving it came from a successful `Live<T>` chain read.

### Structural fix

`fundingAccrued` is now treated as a `Live<bigint>` datum derived from the venue position read (`IVenue.position(id).fundingAccrued`). The provider lifts the on-chain value into the UI-facing `Live<T>` structure and marks failures as `unavailable` rather than rendering a number.

### What it says about process

We rely on static + runtime rule checks to prevent “truthy fabricated numbers” from reaching users. The system’s correctness posture is published in-code and enforced by tests.

