# Vessel app — design contract

Do not restyle. Color-by-role, mono numbers, honesty chrome.

## Roles
- **Hull** (senior, 8% target): brass `#c4a36a`
- **Ballast** (first-loss): `#3d9b8f`
- **Simulated**: amber `#e3b341`
- **Real / on-chain accounting**: `#8fd9b4`
- **Impairment**: `#e25d5d`

## Type
- UI: sans
- Numbers, addresses, bps, dUSD: `font-mono tabular-nums`

## Honesty
Always show whether the short-leg venue is simulated. Never hide SimVenue behind live-looking chrome.

## Copy (do not paraphrase)
- SubordinationFloor: `Ballast must stay at or above 20% of deck TVL. Join Ballast or exit Hull.`
- FaucetCooldown: `Faucet cooling down — {seconds}s left.`
- HullImpairment: `Hull impairment — v0 halted. Ballast and reserve cannot absorb this loss.`
- Slippage: `price moved — try again`
