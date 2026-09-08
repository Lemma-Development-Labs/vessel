# Dune Analytics — Vessel

## Stance

Dune is the **shareable analytics** layer. Envio owns historical crank tape for
Transparency; vessel-service owns live waterfall. Dune does **not** replace either.

Do **not** claim “powered by Dune” or show charts as Dune-sourced until a real
dashboard URL or query ID is configured. Empty env → honest `unavailable`.

## Why Dune (not only Envio)

| Job | Owner |
| --- | --- |
| Live hedge / net delta | Chain reads (`app/lib/chain.tsx`) |
| Live waterfall rows | `NEXT_PUBLIC_STATS_URL` / chain logs |
| Crank tape (HyperIndex) | Envio GraphQL (`NEXT_PUBLIC_ENVIO_GRAPHQL`) |
| Public dashboards, SQL, shareable charts | **Dune** (`monad_testnet.*`) |

Monad **testnet** is indexed on Dune as schema `monad_testnet`
([docs](https://docs.dune.com/data-catalog/evm/monad-testnet/raw/logs)).
Mainnet Vessel deploys do not exist yet — queries target **chainId 10143**.

## Layout

```
dune/
  README.md
  queries/
    01_cranks.sql
    02_waterfall.sql
    03_joins_exits.sql
    04_overview.sql
  addresses.sql          -- bind Vessel testnet addresses once
```

Ship these into a Dune account (Create Query → paste → Save → Publish).
Record the resulting query IDs / dashboard URL in `docs/ADDRESSES.md` and env.

## App wiring

| Env | Purpose |
| --- | --- |
| `NEXT_PUBLIC_DUNE_DASHBOARD_URL` | Public dashboard link / embed (empty = unavailable) |
| `NEXT_PUBLIC_DUNE_QUERY_OVERVIEW` | Optional public query id for overview cards |
| `DUNE_API_KEY` | Server-only. Required for `/api/dune/*` result fetch |

Route: `/analytics` — SourceChip style “Dune · external” when live; otherwise
Unavailable with reason.

## Submit ABI for decoding (optional)

Raw `monad_testnet.logs` works with `topic0` filters (queries use that).
For decoded tables, submit ABIs on Dune for EngineLite + Tranches at the
addresses in `ADDRESSES.json`.

## Review bar

- Query SQL filters Vessel addresses from `ADDRESSES.json`?
- UI invents series without API/dashboard? → blocker
- Banner / chip says Dune live while env empty? → blocker
