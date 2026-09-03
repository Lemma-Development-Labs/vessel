# /resources/verification

This page is the reproducibility contract for Vessel’s hedge verification.

It is written so a stranger can replay the hedge **from public reads** without trusting our UI.

> If something below is marked **[GATE-0]**, we could not verify the exact callable surface (function signature / query shape) from the documents fetched in this session. We refuse to guess.

---

## 1. The spot leg (mark you can recompute)

### Contract

- `EngineLite` — reads spot as “pool mid mark” by routing the current `wmon` balance through its `router.getAmountsOut`.

### Call (example)

```bash
# 1) read engine component addresses
cast call $ENGINE "wmon()(address)" --rpc-url $RPC
cast call $ENGINE "dUsd()(address)" --rpc-url $RPC
cast call $ENGINE "router()(address)" --rpc-url $RPC || true

# 2) read engine-held WMON balance (spot input amount)
cast call <WMON> "balanceOf(address)(uint256)" $ENGINE --rpc-url $RPC

# 3) recompute routed dUSD output (spot mark)
cast call <ROUTER> "getAmountsOut(uint256,address[])(uint256[])" \
  <WMON_BAL> "[\"<WMON>\",\"<DUSD>\"]" --rpc-url $RPC
```

### Expected output shape

- `balanceOf(...)` returns a single `uint256`.
- `getAmountsOut(...)` returns a `uint256[]` whose element `[1]` is the routed dUSD output.

---

## 2. The short leg (Perpl account → on-chain position)

### Exchange contract (testnet)

- Perpl Exchange: `0x1964c32f0be608e7d29302aff5e61268e72080cc`

### Call 1: `getAccountByAddr`

Orders are signed off-chain via the Perpl API key. What matters on-chain is the resulting **exchange account** and its positions.

Use the exchange’s `getAccountByAddr`:

```bash
cast call --from $WALLET_ADDRESS 0x1964c32f0be608e7d29302aff5e61268e72080cc \
  "getAccountByAddr(address)(uint256)" $WALLET_ADDRESS --rpc-url $RPC
```

### Call 2: position read

We need to read the on-chain position that corresponds to the account/market.

[GATE-0] Perpl docs fetched in this session describe `getAccountByAddr`, but we did not find a verified on-chain function signature for reading positions from the exchange contract (the “position read” step). Do not guess—please fetch the missing contract surface and append the verified function signature here.

### Why the position is on-chain (not “order placement by contract”)

Perpl’s API authentication only authorizes programmatic access; placing orders through the API forwards them on-chain and updates on-chain exchange accounts/positions.

---

## 3. Net delta arithmetic

Net delta is the arithmetic difference between:

- **Spot mark (dUSD routed output)**
- **Short notional (venue/account position notional, expressed in the same quote/collateral units)**

```
netDelta = spotMark - shortNotional
```

---

## 4. Funding (where the accrual comes from)

Funding accrual for the short leg must come from the exchange position data (or an indexer derived from exchange events), at a specific reference block/timestamp.

[GATE-0] We have not verified the exact Perpl contract field(s) or indexer-derived field names for “accrued funding” in the on-chain position read path. Once the position-read function is verified (Section 2), we should map:

- “funding accrued” → the corresponding on-chain field(s) / indexer output field(s)
- reference block/timestamp → the block where the funding snapshot applies

---

## 5. The tape (Envio HyperIndex query)

The tape should come from Envio’s HyperIndex (not an archive RPC call), because Monad drops arbitrary historical state on RPC.

Envio endpoints (Monad testnet):

- HyperIndex (GraphQL): [use the Envio HyperIndex endpoint configured for your indexer]
- HyperRPC: `https://monad-testnet.rpc.hypersync.xyz`
- HyperSync: `https://monad-testnet.hypersync.xyz`

[GATE-0] We did not verify the exact HyperIndex schema / event type names for the “hedge verification tape” query (what exact GraphQL fields to select for perps funding + position PnL). Do not guess—append a verified query that returns funding/settle inputs with the expected JSON shape.

---

## 6. Where we could still be lying to you (and how to check)

1. **Keeper custody + key loss**
   - If the keeper EOA is the only entity that can (or does) harvest/sweep, verify it can’t silently diverge by checking persisted on-chain events for deploy/unwind/crank.
2. **Testnet collateral identity mismatch**
   - Testnet margin collateral is a different testnet token from any vault asset you may assume. The “three-stable mismatch” is a real risk.
3. **Quotes from a thin book**
   - Verify the spot mark is computed from the exact pool/router path and at the exact reference time used by the keeper.
4. **Position-read function surface**
   - Until Section 2’s “position read” callable surface is verified, we can’t claim this page is fully reproducible end-to-end.

