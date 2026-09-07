# vessel-indexer (Envio HyperIndex)

Historical crank / funding / NAV / delta tape for Vessel on **Monad testnet (10143)**.

## Why an indexer is architecturally required on Monad

Monad full nodes drop arbitrary historical state. Every historical series Vessel
shows on Transparency — crank tape, funding accrual, NAV, delta over time —
**cannot** come from an archive RPC. Without HyperIndex, the page can only show
"now". That is the bounty argument: the indexer powers a core feature that is
otherwise impossible on this chain, not a decorative activity feed.

Fact-check (Envio docs, 2026-09-07):

| | |
|---|---|
| Chain id | `10143` |
| HyperSync | `https://monad-testnet.hypersync.xyz` (alt `https://10143.hypersync.xyz`) |
| HyperRPC | `https://monad-testnet.rpc.hypersync.xyz` (alt `https://10143.rpc.hypersync.xyz`) |
| Docs | https://docs.envio.dev/docs/HyperIndex/monad-testnet |

## start_block

`start_block: 57918591` — the vault deploy block from `ADDRESSES.json`
(`deployedBlock`). **Not 0.** Also recorded in `docs/ADDRESSES.md`.

## Contracts indexed today

| Contract | Address | Events → entities |
|---|---|---|
| EngineLite | `0xDE65…fC85` | Cranked / deploy / unwind → `Crank`, `DeltaSnapshot` |
| Tranches | `0xdb46…F842` | Join/Exit → `Deposit`/`Withdrawal`; Waterfall → `TrancheNav` |
| BlitzVault | `0xE1c3…70c5` | Deposit/Withdraw → tape (onlyTranches on-chain) |
| SimVenue | `0xAbE3…0FD7` | FundingSwept / RateSet → `FundingPrint` |
| Guardian | `0x150e…1208` | Paused/Unpaused → `Halt` |

**Not yet indexed (no inventing addresses/events):**

- `KuruRouter` — code on branch; not in `ADDRESSES.json` (MockRouter still live); **no events** in ABI
- `PerplVenue` live — stub at `0xaf1C…` has empty event ABI; funding tape uses SimVenue until live
- `HullSeries001` — hard-gated until `TX_KURU_SPOT` + `TX_PERPL_SHORT` (`docs/SERIES-001.md`); `HullTrade` entity reserved

## gasLimit, not gasUsed

Monad charges on **gas_limit**. Handlers read `event.transaction.gas` into
`Crank.gasLimit`. The GraphQL query the UI uses selects `gasLimit` only.

## GraphQL (Transparency)

```graphql
query CrankTape($limit: Int!) {
  Crank(order_by: { block: desc }, limit: $limit) {
    block ts actor decision gasLimit deltaBefore deltaAfter txHash
  }
}
```

UI: `app/lib/envio-tape.ts` → `fetchCrankTape()` → Transparency "Envio crank tape".
**Never** keeper JSON. Indexer down → `unavailable`, never a fabricated `0`.

## Reorg behaviour

HyperIndex defaults to `rollback_on_reorg: true`. On a reorg, entity rows from
orphaned blocks are rolled back and the canonical chain is re-applied. During
the brief window the UI may show a stale tape until the next `fetchCrankTape`
poll (30s); it will not invent zeros. Documented for the bounty review bar.

## Local

```bash
cd indexer
pnpm install
pnpm codegen
pnpm test
# optional live HyperSync smoke:
# ENVIO_LIVE_SMOKE=1 pnpm test
TUI_OFF=true pnpm dev
```

Requires Docker for Postgres when running `pnpm dev`. Set `ENVIO_API_TOKEN` for
HyperSync credits on hosted / heavy sync (see Envio docs).

## Hosted deploy (Envio Cloud)

Prereqs (do **not** run login for the user — MONSKILLS): `envio-cloud` + `gh` logged in.

```bash
envio-cloud config set-org <org>
envio-cloud indexer add --name vessel-indexer --repo Lemma-Development-Labs/vessel
# wait for build → empty commit kick (see indexer skill workflows) → promote
# then write endpoint into docs/ADDRESSES.md + app NEXT_PUBLIC_ENVIO_GRAPHQL
```

Until hosted: leave `NEXT_PUBLIC_ENVIO_GRAPHQL` empty — Transparency shows
`unavailable` with reason (honest).

## Replay check (ship)

```bash
# Compare entity counts to on-chain logs from start_block
cast logs --from-block 57918591 --address 0xDE65E58df3e3da55DD3c6e107E30E1655Fb5fC85 \
  --rpc-url https://testnet-rpc.monad.xyz
# Screenshot GraphQL Crank tape next to cast logs for the bounty submission.
```
