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

### Call 1: `getAccountByAddr` → AccountInfo

Orders are signed off-chain via the Perpl API key. What matters on-chain is the resulting **exchange account** and its positions.

Live ABI (PerplFoundation/dex-sdk `Exchange.json`, verified 2026-09-06) returns
**AccountInfo**, not a bare `uint256`. The api-docs README cast snippet that
decodes as `(uint256)` is incomplete.

```bash
EX=0x1964C32f0bE608E7D29302AFF5E61268E72080cc
cast call $EX \
  "getAccountByAddr(address)((uint256,uint256,uint256,uint8,address,(uint256,uint256,uint256,uint256)))" \
  $WALLET_ADDRESS --rpc-url $RPC
# → (accountId, balanceCNS, lockedBalanceCNS, frozen, accountAddr, positionsBitmap)
```

`PerplPositionReader.accountId(owner)` wraps this and returns `0` when absent
(never reverts).

### Call 2: `getPosition(perpId, accountId)` → PositionInfo

```bash
# MON market id = 64. Args are (perpId, accountId) — order matters.
cast call $EX \
  "getPosition(uint256,uint256)((uint256,uint256,uint256,uint8,uint256,uint256,uint256,uint256,int256,int256,int256),uint256,bool)" \
  64 $ACCOUNT_ID --rpc-url $RPC
# PositionInfo: accountId, next, prev, positionType (0=Long,1=Short), depositCNS,
#   pricePNS, lotLNS, entryBlock, pnlCNS, deltaPnlCNS, premiumPnlCNS
# + markPricePNS, markPriceValid
```

Quote notional (6dec CNS) for stranger math (MON: priceDecimals=5, lotDecimals=0):

```
notionalCNS = lotLNS * pricePNS * 10^(6 - priceDecimals) / 10^lotDecimals
netDelta    = spotInventoryCNS - abs(notionalCNS)   # short ⇒ negative lots
```

### Deploy reader + venue (testnet, live Exchange)

On-chain `0xaf1C…7C21` is still the **stub** (`openShort` / `position` / `sweepFunding`
revert `NotImplemented`). Redeploy with a real `DEPLOYER_PK` (Anvil well-known keys
must not be used on 10143):

```bash
export RPC=https://testnet-rpc.monad.xyz
export DEPLOYER_PK=0x…                 # funded testnet key — NOT Anvil account 0
export PERPL_POSITION_OWNER=0x…        # keeper EOA that owns / will own the Perpl account
cd contracts
forge script script/DeployPerpl.s.sol:DeployPerpl --rpc-url $RPC --broadcast -vv
# then Sourcify-verify both addresses (solc 0.8.24, optimizer 200, via-ir)
# append PERPL_POSITION_READER / PERPL_VENUE + deploy txs to docs/ADDRESSES.md
```

Via Vessel reader (after deploy):

```bash
cast call $PERPL_READER "accountId(address)(uint256,uint256)" $KEEPER --rpc-url $RPC
cast call $PERPL_READER "position(uint256)(int256,uint256,uint256,int256,uint256)" $ACCOUNT_ID --rpc-url $RPC
cast call $PERPL_VENUE "netDelta(uint256)(int256,uint256)" $SPOT_INVENTORY_CNS --rpc-url $RPC
```

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

On-chain funding/premium accrual for an open position is `PositionInfo.premiumPnlCNS`
(perpl-sdk `Position.premium_pnl`). `PerplPositionReader.position` returns it as
`fundingAccrued` with the read block. Liquidation **price** is **not** on
PositionInfo — `liquidationPrice` reverts `FieldNotOnChain` (do not invent a band).

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
   - `getPosition` + `premiumPnlCNS` are verified (Section 2). Stranger path uses
     `PerplPositionReader` / raw `cast call` above — re-check if Exchange upgrades.

