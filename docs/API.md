# Vessel API — `/v1` evidence routes

Spec §12–§13. Served by `vessel-service` (`src/v2/api.ts`) when a v2 release
manifest is configured (`V2_MANIFEST_PATH` / `V2_MANIFEST_JSON`). The SDK and
MCP return the same envelope ([MCP.md](MCP.md)).

Current balances are read **from the chain at the finalized block** with the
independent verifier's own reader and checks (vendored from
`tools/verify-cli`), so the API and `vessel-verify` agree by construction.
History comes from the reorg-aware indexer and is a projection, not an
authority.

## Envelope

Every response:

| Field | Meaning |
|---|---|
| `schemaVersion` | `1` |
| `environment`, `chainId` | from the release manifest |
| `blockNumber`, `blockHash` | the block the data was read at (`null` when unavailable) |
| `observedAt` | block time (ISO-8601) |
| `source` | e.g. `rpc:testnet-rpc.monad.xyz (finalized block, direct chain read)` or `indexer (…)` |
| `units` | `dUSD:6` — money is decimal strings of base units |
| `status` | `LIVE` · `SIMULATED` (engine reports a simulation) · `MISMATCH` (an independent check failed) · `UNAVAILABLE` |

Failures are explicit: HTTP 503, `status: "UNAVAILABLE"`, `error: "STALE_DATA"`,
and a `reason`. No route returns an empty success or a zero in place of
missing data. All responses carry `Cache-Control: no-store`.

## Routes

### `GET /v1/book`

The whole book plus the verifier's checks.

```json
{
  "schemaVersion": 1, "environment": "testnet", "chainId": 10143,
  "blockNumber": "67198107", "blockHash": "0x…", "observedAt": "…",
  "source": "rpc:… (finalized block, direct chain read)", "units": "dUSD:6",
  "status": "SIMULATED",
  "data": {
    "hullNav": "80000000", "ballastNav": "900000000", "reserveNav": "20000000",
    "treasuryLiability": "0", "recordedActive": "1000000000", "lossCarry": "0",
    "epoch": "4", "impaired": false,
    "lifetimeAdmitted": "1000000000", "pendingReserved": "0", "stageCap": "25000000000",
    "custody": { "pending": "0", "activeIdle": "200000000" },
    "escrow": { "totalFunded": "0" },
    "ballastSupply": "900000000000000000000",
    "engine": { "simulated": true, "value": "800000000", "observedAt": "…" }
  },
  "checks": [{ "id": "book.identity", "verdict": "PASS", "summary": "recorded A equals H + B + R", "values": {} }]
}
```

`engine` is `null` until governance wires one.

### `GET /v1/series/:id`

One Hull series at the finalized block: `state` (`SUBSCRIPTION_OPEN`,
`ACTIVE`, `MATURED_UNWINDING`, `CLAIMABLE`, `CLOSED`, `CANCELLED`,
`IMPAIRED`), `rateBps`, `termsHash`, `subscriptionEnd`, `activation`,
`maturity`, `principal`, `recognizedCoupon`, `accPerUnit`, `subscriptions`.
`400` for a malformed id, `404 SERIES_NOT_FOUND`.

### `GET /v1/requests/:id`

One deposit request: `owner`, `receiver`, `tranche` (`HULL`/`BALLAST`),
`seriesId`, `deadline`, `createdAt`, `status` (`ESCROWED`, `ADMITTED`,
`REFUNDABLE`, `REFUNDED`), `assets`, `minOut`. `404 REQUEST_NOT_FOUND`.
A request id is a canonical identifier: a user can recover its state after a
browser crash.

### `GET /v1/history?limit=50`

Indexed controller events, newest first, canonical rows only:
`blockNumber`, `blockHash`, `txHash`, `logIndex`, `event`, `args` (bigints as
strings), `finalized`. `limit` 1–200. The envelope's block is the indexer's
cursor. `503` until the indexer completes its first pass or when no index is
configured. Event identity is `(chainId, blockHash, txHash, logIndex)`; rows
orphaned by a reorg are kept as `REVERTED` and never served here.

## Limits and access

- Public, read-only, `GET`/`HEAD` only.
- Per-client rate limit on every `/v1` route: `RATE_LIMIT_MAX` requests per
  `RATE_LIMIT_WINDOW_SEC` (defaults 60 / 60 s) → `429`.
- CORS: exact-match `ALLOWED_ORIGINS` (no wildcards).
- No portfolio or private data is served; per-wallet state is read by the
  wallet's own client from the chain.

## Verify it yourself

```bash
cd tools/verify-cli && pnpm verify --manifest ../../deployments/testnet-v2.json --rpc https://testnet-rpc.monad.xyz
```

Exit code 0 PASS, 1 MISMATCH, 2 UNAVAILABLE.
