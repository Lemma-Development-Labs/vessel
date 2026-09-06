# Architecture — Perpl venue split (prompt 02)

## Custody model (this cycle)

**The keeper EOA owns the Perpl exchange account.** Vessel does **not** custody
venue margin on-chain this cycle. Orders are signed off-chain (Ed25519 API key
over WebSocket) by the keeper. On-chain Solidity only:

1. Records short *intent* (`PerplVenue.targetShort` / `openShort`)
2. Reads position truth (`PerplPositionReader` → Exchange `getPosition`)
3. Exposes `netDelta` / `deviation` for crank policy

`closeShort` and `sweepFunding` **revert** on `PerplVenue` — closing and
funding harvest are off-chain / custody-cycle operations. Do not fake a zero
funding sweep.

See also [`risk.md`](./risk.md) (“Keeper custody + key loss”).

## Contracts

| Contract | Role |
| --- | --- |
| `PerplPositionReader` | Pure reader: account id, signed size, entry, margin, `premiumPnlCNS` funding, quote notional. Every getter returns `block.number`. Unexposed fields revert `FieldNotOnChain`. |
| `PerplVenue` | `IVenue` adapter. Intent on write; Exchange truth on read. |
| `SimVenue` | Forced-negative sandbox. Same `IVenue` + same delta surface. |

Swap = deploy `PerplVenue` and re-wire `EngineLite` — one contract replace.

## Units (MON market 64)

Verified live 2026-09-06 against Exchange impl + `getPerpetualInfo`:

- `priceDecimals = 5`, `lotDecimals = 0`, collateral CNS = 6dec
- Quote notional (CNS) = `lotLNS * pricePNS * 10^(6-5) / 10^lotDecimals`
- PositionEnum: Long=0, Short=1 (perpl-sdk `PositionType`)

## Block state

Reads use `block.number` (Monad proposed / JSON-RPC `"latest"`). Prefer
`"safe"` / `"finalized"` for irreversible UI claims (MONSKILLS block-states).
