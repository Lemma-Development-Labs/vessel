# @vessel/sdk

Typed Vessel client. Reads the v2 book straight from the chain at one block,
wraps every result in the evidence envelope, quotes, and prepares unsigned
transactions. Holds no keys; sends nothing. See [docs/MCP.md](../../docs/MCP.md).

- `Vessel.testnet()` — reads against the bundled testnet release manifest.
- `bookState`, `ballastState`, `reserveState`, `capacity`, `engineState`,
  `riskState`, `verifyBook`, `hullSeries` — evidence envelopes.
- `hedgeState` — `UNAVAILABLE` while the testnet engine is simulated (G01).
- `prepare*` — ordered unsigned calls for the user's wallet, exact approvals,
  receiver always the owner, targets only from the manifest.

The verifier reader/checks under `src/vendor/` and the manifest under
`src/manifests/` are generated (`scripts/sync-packages.mjs`,
`scripts/sync-v2-app.mjs`) — do not edit them by hand.
