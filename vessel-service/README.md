# vessel-service

Railway-deployable Node service for Vessel: a permissionless **keeper** (`EngineLite.crank`), a **Waterfall indexer**, and a read-only **stats API**.

The keeper key is economically boring. `crank` is permissionless; the key only spends its own MON for gas and never holds protocol funds.

## Local run

```bash
cd vessel-service
pnpm install
cp .env.example .env
# set RPC_URL, CHAIN_ID, KEEPER_PK
# Anvil: CHAIN_ID=31337 and ../ADDRESSES.json from `pnpm sync`
pnpm dev          # API + indexer + keeper
# or
pnpm keeper       # crank loop only
pnpm start        # production-style (no watch)
```

Without `DATABASE_URL`, events and snapshots stay in **in-memory Maps**. That is fine for a local demo; it is empty after every restart (Railway’s filesystem is ephemeral too — use Postgres in prod).

```bash
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/stats
curl -s 'http://127.0.0.1:3000/waterfall?limit=50'
```

## Railway deploy

1. New service from this repo. Set the **root directory** to `vessel-service` (so `Dockerfile` / `railway.json` apply).
2. Add a Postgres plugin if you want durable history (`DATABASE_URL` is injected).
3. Set the env vars in the table below. Paste the live `ADDRESSES.json` into `ADDRESSES_JSON` (the image does not include the monorepo file).
4. Deploy. `railway.json` starts `pnpm start` and restarts **ON_FAILURE** (the keeper `process.exit(1)`s after three unexpected crank failures so the supervisor can bounce it).
5. Health: `GET /health`. Listen address is `0.0.0.0:$PORT`.

Fund the keeper with **≥ 0.5 MON**. Preflight refuses to start below that.

## Env

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `RPC_URL` | yes | — | JSON-RPC |
| `CHAIN_ID` | no | `10143` | Must match the RPC. Preflight exits on mismatch. |
| `KEEPER_PK` | keeper | — | `0x` + 64 hex. Gas only. |
| `CRANK_INTERVAL_SEC` | no | `300` | No overlapping cranks (single-flight). |
| `PORT` | no | `3000` | Bound to `0.0.0.0` |
| `DATABASE_URL` | no | in-memory | Postgres if set |
| `ADDRESSES_JSON` | if no file | `../ADDRESSES.json` | Full JSON: `contracts.EngineLite`, `contracts.Tranches`, `deployedBlock`, `venue` |
| `LOG_LEVEL` | no | `info` | pino |

## Behaviour

- **Keeper** — chainId check, `getCode` on EngineLite, MON ≥ 0.5. Each tick logs `netDelta`, estimates gas × 1.3 capped at 1_300_000 (never unbounded). `DtZero` / `Paused` / `NotWired` / `AlreadyDeployed` / `NothingDeployable` log `KEEPER-SKIP` and do not count as failures. RPC errors back off `interval * 2^n` capped at 5 minutes. Three consecutive unexpected failures → exit 1.
- **Indexer** — backfills `Waterfall` from `deployedBlock`, then watches new blocks. Upserts by `(tx_hash, log_index)`. Crank snapshots store `net_delta`, `funding_accrued`, `spot_value`, `short_notional`.
- **API** — GET only. CORS: `vessel.wtf` / `testnet.vessel.wtf` / `docs.vessel.wtf` / localhost:3000. Every GET has `Cache-Control: max-age=3`. No secrets in responses.

## Security

Do not put the deployer key here. The keeper key cannot move user deposits; worst case it wastes its own gas. Rotate it if the process logs are public.
