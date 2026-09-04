# Vessel Perpl keeper (short-manager)

Production-oriented trading automation for Vessel's hedge short on
**Perpl testnet** (Monad chain `10143`). Built for the Metropolis
"Best use of Perpl's API" bounty.

Judges (PBJ / gvan): this README is the submission artifact. Clone → dry-run
decision → one Change order, under ten minutes.

```
                    ┌─────────────┐
   market-data WS   │  policy.ts  │  pure: state → Decision
   (10 req/min) ───►│  (no I/O)   │◄── chain reads (paid RPC)
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
           crank        reduce        halt
         (EngineLite)  (Change ord)  (kill / depth / funding)
                           │
                    trading WS (60/min)
                    reconnect → reconcile
```

## Limits (fetched 2026-09-04 from Perpl api-docs)

| | Testnet trading WS | Market-data WS |
|---|---|---|
| Requests | **60/min** (pings count) | **10/min** |
| Connections | **4 per wallet** (keys + browser share) | per connection |
| Subscriptions | — | 16 |
| Idle timeout | **10 s** (incl. sign-in frame) | n/a (data keeps alive) |

Close codes handled: `1008` (`too many requests` / `too many connections` /
`ping timeout` / `idle timeout`), `1011` (`failed to process`), `3401` (auth),
plus `1013` / `1001` / `1006`. **A close carries no per-request status — anything
in flight is lost silently → reconcile before acting.**

Docs say: **use Change orders instead of Post + Cancel.** Fee field `f` on
Order/Fill is **gross** and already includes builder `bfa` — never add them.

Monad gas (MONSKILLS `gas/`): **charged on `gas_limit`, not `gas_used`.** Crank
sends an explicit limit (ceiling 550_000).

## Connection discipline

This keeper opens **two** sockets (trading + market-data). A human logged into
`https://testnet.perpl.xyz` with the **same wallet** eats the 4-connection
budget. Do not open a browser session on the keeper wallet while it runs.

## Prereqs

- Node 22+, `pnpm` or `npm`
- Foundry `cast` (for `createAccount`)
- Testnet MON for gas ([Monad faucet](https://faucet.monad.xyz))
- Perpl testnet collateral — see GATE-0 note below
- **Paid/dedicated** Monad RPC (`MONAD_RPC_URL`). The process refuses
  `testnet-rpc.monad.xyz` unless `ALLOW_PUBLIC_RPC=1`.

## 1. Env

```bash
cd keeper
cp .env.example .env
# fill PERPL_API_KEY, PERPL_API_KEY_SECRET, MONAD_RPC_URL, KEEPER_PK
```

| Var | Purpose |
|---|---|
| `PERPL_API_URL` | `https://testnet.perpl.xyz/api` |
| `PERPL_WS_URL` | `wss://testnet.perpl.xyz` |
| `PERPL_CHAIN_ID` | `10143` |
| `PERPL_API_KEY` | opaque `X-API-Key` from enrollment |
| `PERPL_API_KEY_SECRET` | 32-byte Ed25519 seed hex |
| `MONAD_RPC_URL` | paid JSON-RPC |
| `KEEPER_PK` | gas-only EOA for `EngineLite.crank` |
| `PERPL_MARKET_ID` | testnet **MON = 64** |
| `KILL_SWITCH_PATH` | touch file → force `halt` |
| `HEALTH_PORT` | default `3001` (`0.0.0.0` for Railway) |

## 2. Enroll an API key

UI: https://testnet.perpl.xyz/apikeys (wallet signature once).

Programmatic: see [Integrations](https://github.com/PerplFoundation/api-docs/blob/main/integrations.md)
and `examples/js/enroll_api_key.js` in that repo.

Auth canonical (REST):

```
[CHAIN_ID, METHOD, TARGET, TIMESTAMP, NONCE, SHA256(body)].join("\n")
```

Headers: `X-API-Key`, `X-API-Timestamp`, `X-API-Nonce`, `X-API-Signature`
(base64url Ed25519, no padding). Timestamp window ±30s; nonce single-use.

## 3. Create exchange account + enable forwarding

Exchange (testnet): `0x1964c32f0be608e7d29302aff5e61268e72080cc`

```bash
export RPC_URL=$MONAD_RPC_URL
export SMART_CONTRACT_ADDRESS=0x1964c32f0be608e7d29302aff5e61268e72080cc
export WALLET_ADDRESS=0xYourWallet
export WALLET_KEY=0xYourKey
# Collateral token: confirm via GET /v1/pub/context — see GATE-0
export TOKEN_CONTRACT_ADDRESS=0x…   # from context.tokens[collateral]
export MIN_ACCOUNT_OPEN_AMOUNT=100000000   # from context.instances[].min_account_open_amount

cast call --from $WALLET_ADDRESS $SMART_CONTRACT_ADDRESS \
  "getAccountByAddr(address)(uint256)" $WALLET_ADDRESS --rpc-url $RPC_URL

cast send $TOKEN_CONTRACT_ADDRESS \
  "approve(address,uint256)" $SMART_CONTRACT_ADDRESS $MIN_ACCOUNT_OPEN_AMOUNT \
  --private-key $WALLET_KEY --rpc-url $RPC_URL

cast send $SMART_CONTRACT_ADDRESS \
  "createAccount(uint256)(uint256)" $MIN_ACCOUNT_OPEN_AMOUNT \
  --private-key $WALLET_KEY --rpc-url $RPC_URL

# Required for API order posting ("one-click trading"):
cast send $SMART_CONTRACT_ADDRESS "allowOrderForwarding(bool)" true \
  --private-key $WALLET_KEY --rpc-url $RPC_URL
```

## 4. Install + dry-run

```bash
cd keeper && npm install
npm run dry-run -- --once
# → prints a Decision from policy.ts; places nothing
curl -s localhost:3001/health
curl -s localhost:3001/last-decision
```

## 5. One live Change (`--once`)

```bash
npm run once
```

**Order id from our run:** `[GATE-0: no PERPL_API_KEY in this cloud agent — record rq/oid here after first live Change]`

## 6. Continuous + Railway

```bash
npm run keeper          # loop; health on :3001
# Kill: touch ./KILL
```

Deploy beside `vessel-service` (root directory `keeper/`, start `npm run keeper`,
health `GET /health`). Transparency can poll `/last-decision`.

## Architecture notes

| Module | Role |
|---|---|
| `auth.ts` | Ed25519 REST + WS sign-in; nonce ledger; clock-skew guard |
| `budget.ts` | 60/min hard ceiling + emergency reserve; queue don't drop |
| `ws.ts` | close-code → recovery |
| `marketdata.ts` | separate socket + budget |
| `reconcile.ts` | re-read fills/positions after disconnect |
| `policy.ts` | **pure** `decide(state)` — CRE reuse surface |
| `execute.ts` | Decision → Change (`t: 7`) |
| `chain.ts` | EngineLite crank / marks; gas_limit budgeting |
| `main.ts` | wiring, health HTTP, `--dry-run` / `--once` |

## What is not handled

- Opening a brand-new resting order when none exists (Change needs `oid`) — seed
  via UI or a one-shot OpenShort first.
- Builder fee codes / multi-market routing.
- Mainnet 143.
- Automatic collateral top-ups on Perpl.

## GATE-0 — collateral address drift (2026-09-04)

| Claim | Source | Live check |
|---|---|---|
| Perpl testnet collateral `0xdf5b718d8fcc173335185a2a1513ee8151e3c027` (USD) | Vessel `00` §2 + api-docs README Network table | `symbol()` → `USD`; code present |
| Context token `0xa9012a055bd4e0edff8ce09f960291c09d5322dc` (AUSD) | `GET https://testnet.perpl.xyz/api/v1/pub/context` | Listed as instance collateral |

**Do not guess which to deposit.** Re-fetch `/v1/pub/context` and use
`instances[].collateral_token_id` → `tokens[]` before `createAccount`. Report the
drift to Perpl mentors if both remain.

Exchange address matches docs + ADDRESSES references:
`0x1964c32f0be608e7d29302aff5e61268e72080cc`.
