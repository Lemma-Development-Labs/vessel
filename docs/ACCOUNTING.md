# ACCOUNTING

What the v2 core (`contracts/src/core/`) actually implements, as of Session 2
(2026-09-30). Policy source: [spec/VESSEL_V1.md](spec/VESSEL_V1.md) §7–§9 and
[HANDBOOK_v4.md](HANDBOOK_v4.md) ch. 4. Every settlement rule is judged
against the independent reference model: [reference/](../reference/).

## Units (P02, partially decided)

| Quantity | Unit | Where |
|---|---|---|
| All book values (A, H, B, R, G, C, F, FR, FT, L) | USDC base units (6 decimals), USDC-equivalent | `TrancheController` |
| Hull principal units | 1 unit per USDC base unit admitted (6 decimals), per series, non-transferable | `hullUnits[series][holder]` |
| Ballast units | 18 decimals, non-transferable (`BallastToken`) | `units = assets × (supply + vU) / (B + vA)` |
| Ballast virtual offsets | `virtualUnits`, `virtualAssets` — constructor immutables. Tests use `1e12` / `1` (1 BALLAST ≈ 1 USDC at start) | **mainnet values stay P02: release-manifest decision** |
| Rates | basis points | Hull rate ≤ 1,500 bps |

Internal valuation in 18-decimal USD (spec §7) is **not** used yet: the book
is kept in USDC base units, so the waterfall is bit-identical to the reference
model. Measured USDC/USD FX enters through the ValuationAdapter in Session 3.

## The identity

After every settlement `A = H + B + R`, where
`A = custody.activeIdle + engine value − unpaid treasury liability`.
Outside A: pending subscription escrow (`custody.pending`), funded claims
(`ClaimEscrow`), quarantined transfers (`custody.quarantined()`), and the
treasury liability itself. `lastActive` records A after every flow, so the next
settlement's `G = A_now − lastActive`.

| Event | Effect on A / `lastActive` | Counted in G? |
|---|---|---|
| Deposit request | none (pending) | no |
| Admission (Hull activation, Ballast batch) | +assets | no (flow) |
| Reserve contribution / team seed | +assets | no (flow) |
| Funding an exit or a Hull series into escrow | −payout | no (flow, counted once, at funding) |
| Claim from escrow | none (already outside A) | no |
| Custody ↔ engine transfer | none | no (internal) |
| Treasury payment | none (idle and liability fall together) | no |
| Unsolicited transfer to custody | none (quarantined) | **no — never income** |
| Engine PnL / funding / fees | changes engine value | **yes** |

## Settlement

`Waterfall.settle` (normative order): `E = max(G − L, 0)`, `L' = max(L − G, 0)`,
`F = ⌊E/10⌋`, `FR = min(⌊F/2⌋, ⌊2% × (H+B+R)⌋ − R)`, `FT = F − FR`; allocate
`G − F − C` against Hull's coupon, shortfall to Ballast, then Reserve (incl. FR),
then Hull; if Hull ends below `H + C`, redo the epoch with all fees zero.
Conservation `H' + B' + R' + FT = H + B + R + G` is asserted on-chain.
Insolvency (`H + B + R + G < 0`) reverts; it is never floored.

Once impaired: fees stay zero, the senior entitlement is frozen at
`H + C` of the impairing epoch and the reserve at its pre-impairment value;
`Waterfall.settleRecovery` restores Hull up to that cap, then Reserve, then
Ballast. New admissions, new series and engine deployments are refused.

## Rounding (direction and dust)

| Operation | Direction | Bound / destination |
|---|---|---|
| Ballast units minted | floor | favors existing holders |
| Ballast payout for burned units | floor, and computed from the burned units | never pays more than burned units are worth |
| Partial exit fraction | `unitsBurn = ⌊units × pay / value⌋`, then pay recomputed | remainder stays exposed |
| Coupon | cumulative accrual floored once per epoch (`accrued(now) − recognized`) | no compounding truncation (tested) |
| Fee / reserve share | floor (as the reference model) | — |
| Hull pooled payout | `accPerUnit` floored at funding, claim floored | **≤ 1 base unit per holder per funding event, left in the series' escrow pool**; never overpays |

## Tests

- `contracts/test/differential/Vectors.t.sol` — 8 golden + 10,000 seeded
  settlement cases, coupon, coverage bound: exact match with the reference.
- `packages/math` — independent TypeScript port, same vectors.
- `contracts/test/core/Lifecycle.t.sol` — full Hull and Ballast lifecycle,
  impairment and cumulative recovery, caps, pauses, access control.
- `contracts/test/core/CoreInvariant.t.sol` — randomized sequences: identity,
  custody/escrow backing, caps, no unbacked units.
