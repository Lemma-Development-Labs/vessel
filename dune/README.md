# Vessel Dune queries

SQL templates for [Dune](https://dune.com) against **Monad testnet**
(`monad_testnet` schema). Addresses match `ADDRESSES.json`.

## Publish flow

1. Open https://dune.com → New query
2. Paste a file from `queries/`
3. Run → Save → (optional) Add to a dashboard
4. Copy the dashboard URL into `NEXT_PUBLIC_DUNE_DASHBOARD_URL`
5. Optional: copy query id into `NEXT_PUBLIC_DUNE_QUERY_OVERVIEW` and set
   `DUNE_API_KEY` for `/api/dune/overview`

Until step 4, `/analytics` shows Unavailable — by design.

See `docs/DUNE.md`.
