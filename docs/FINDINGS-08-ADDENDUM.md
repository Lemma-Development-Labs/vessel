# Findings addendum — production pause egress (2026-09-07)

| # | Severity | Class | Change |
|---|---|---|---|
| 1 | was blocker | Stuck funds / pause | **Fixed in code:** `unwind` + vault engine callbacks + tranche exits + vault withdraw/redeem are pause-exempt. Ingress (join/deploy/crank/settle/pull) still freezes. Tests: `PauseMatrix.t.sol`. |
| 10 | was medium | Keeper `?? 0` | **Fixed:** missing `bestAsk` ages market data to halt; reduce refuses missing `bestBid`. |

Remaining Gate 1–4 items: [`MAINNET-READY.md`](./MAINNET-READY.md). External audit: [`AUDIT-SCOPE.md`](./AUDIT-SCOPE.md).
