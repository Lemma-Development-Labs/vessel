# /product/waterfall

## Waterfall (both regimes)

Vessel’s accounting turns **gross yield** into tranche outcomes via a deterministic waterfall:

### Positive funding

```
funding (positive) -> protocol take -> Hull coupon -> Ballast residual
```

### Negative funding

```
Ballast -> reserve -> Hull (last)
```

## Conservation identity (required invariant)

Every successful settle must satisfy:

```
ΔHull + ΔBallast + ΔReserve + fees == grossYield
```

This is enforced in tests and characterized so that accounting can be replayed from public reads.

