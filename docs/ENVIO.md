# Envio HyperIndex — Vessel transparency tape

## Why this is not decoration

Monad full nodes drop arbitrary historical state. Every historical series Vessel
shows — crank tape, funding accrual, NAV, delta over time — **cannot** come from
an archive RPC. The indexer is not a nice-to-have; without it Transparency can
only show "now". That is what "meaningfully use" means for the Best Use of Envio
bounty.

## Fact-check

| | |
|---|---|
| Chain | Monad testnet `10143` |
| HyperSync | `https://monad-testnet.hypersync.xyz` |
| HyperRPC | `https://monad-testnet.rpc.hypersync.xyz` |
| Docs | https://docs.envio.dev/docs/HyperIndex/monad-testnet |
| `start_block` | `57918591` (`ADDRESSES.json` `deployedBlock`) — **not 0** |

## UI contract

Transparency crank tape is served by HyperIndex GraphQL (`fetchCrankTape` in
`app/lib/envio-tape.ts`). Keeper `/last-decision` is for operator health only —
**not** the historical tape. Indexer down → `unavailable`, never `0`.

## Reorgs

HyperIndex rolls back orphaned entity writes (`rollback_on_reorg` default true).
UI re-fetches every 30s; during a reorg window the tape may lag one poll behind
canonical state.

## Hosted endpoint

Recorded in [`ADDRESSES.md`](./ADDRESSES.md) as `ENVIO_GRAPHQL` once Envio Cloud
is promoted. Until then the env var stays empty and the UI stays honest.
