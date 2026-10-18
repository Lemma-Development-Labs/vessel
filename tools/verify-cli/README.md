# vessel-verify

Independent verifier (spec §12, master prompt Phase 4). Reads the release
manifest and chain state at one block — pinned by number **and** hash — and
recomputes the book without the Vessel API, database or app.

```bash
pnpm install
pnpm verify --manifest ../../deployments/testnet-v2.json --rpc https://testnet-rpc.monad.xyz          # finalized block
pnpm verify --manifest ../../deployments/testnet-v2.json --rpc https://testnet-rpc.monad.xyz --json   # evidence envelope
```

Checks: ledger identity (`lastActive = H + B + R`), recomputed A and
unsettled G, custody backing (and quarantined surplus), claim-escrow backing,
lifetime/stage/V1 caps, no Ballast units without admitted capital, engine
status (SIMULATED on testnet — not a hedge), impairment state.

Exit codes: 0 no MISMATCH · 1 MISMATCH · 2 could not verify. A pass describes
the observed state under these checks; it is not a solvency guarantee.
Hedge verification of real venues (spot + signed perp quantities) needs the
venue readers (G01–G03, BLOCKED).
