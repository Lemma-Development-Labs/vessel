# Vessel MCP and SDK

Spec §17. Two access surfaces over the same reads as the `/v1` API and the
independent verifier:

- **`packages/sdk`** — typed TypeScript client. Reads the book straight from
  the chain at one block and wraps every result in the evidence envelope;
  quotes; and *prepares* unsigned transactions. It holds no keys and sends
  nothing.
- **`tools/vessel-mcp`** — an MCP server (stdio) that exposes the SDK as
  tools. It reuses the SDK through the vendoring script, not a second copy of
  its logic.

Both read with `tools/verify-cli`'s own reader and checks (vendored by
`scripts/sync-packages.mjs`), so the SDK, MCP, API and `vessel-verify` cannot
silently disagree about the book.

## Evidence envelope

Every read returns:

```json
{
  "schemaVersion": 1,
  "environment": "testnet",
  "chainId": 10143,
  "blockNumber": "67198107",
  "blockHash": "0x…",
  "observedAt": "2026-10-01T…Z",
  "source": "rpc:testnet-rpc.monad.xyz (direct chain read)",
  "units": "dUSD:6",
  "status": "LIVE | SIMULATED | MISMATCH | UNAVAILABLE",
  "data": { "…": "money as decimal strings of base units" }
}
```

`UNAVAILABLE` carries `reason` and no `data` — never a zero standing in for a
failed read. `MISMATCH` means one of the independent checks failed at that
block. `SIMULATED` means the wired engine reports itself as a simulation.

## MCP tools

Read and verify (public, read-only, finalized block):

| Tool | Returns |
|---|---|
| `book_state` | Hull/Ballast/reserve NAV, treasury liability, recorded A, custody and escrow |
| `ballast_state` | Ballast NAV, unit supply, junior cover vs 20% floor / 30% target |
| `reserve_state` | Reserve NAV, 2% target, loss carryforward |
| `capacity` | Stage cap, admitted, pending, remaining, immutable 25,000 ceiling |
| `engine_state` | Wired or not, SIMULATED flag, value, observation time |
| `risk_state` | Impairment, cover, capacity, and the independent checks |
| `hull_series` | Series terms and state (one or all) |
| `verify_waterfall` | The verifier's conservation checks (identity, backing, caps, units) |
| `verify_hull_series` | A series' on-chain terms; rate derivation reported unavailable |
| `get_evidence` | Verdicts with block number/hash and the release manifest checked |
| `waterfall_history` | Indexed `EpochSettled` events with finality (needs `VESSEL_API_URL`) |
| `hedge_state`, `market_state`, `funding_history`, `verify_hedge` | `UNAVAILABLE` with reason — the testnet engine is simulated (gate G01) |

Preparation (only with `VESSEL_MCP_PREPARE=1` — spec "prepare behind a
separate gate"): `prepare_ballast_deposit`, `prepare_hull_subscription`,
`prepare_ballast_exit`, `prepare_cancel_deposit`, `prepare_claim_refund`,
`prepare_cancel_exit`, `prepare_claim_exit`, `prepare_claim_hull`.

Each preparation returns ordered unsigned calls, the authorization boundary
("each call must be signed by the user's own wallet") and `expiresAt`.

## Security boundaries (tested in `tools/vessel-mcp/test/mcp.test.ts`)

- No tool signs, sends or submits; no tool accepts raw calldata or a `to`.
- Call targets come only from the release manifest. Deposits and exits are
  always for the `owner`; there is no receiver or spender input, and injected
  extra arguments are ignored.
- Approvals are for the exact amount, never unlimited.
- Inputs are validated by schema (decimal strings, 20-byte addresses) before
  any read; invalid preparations return an error, not a transaction.
- No operator or keeper tools exist. The server has no keys and no network
  path to the signing service.

## Running

```bash
cd tools/vessel-mcp && pnpm install
pnpm start                                    # stdio, testnet, read/verify only
VESSEL_API_URL=https://… pnpm start           # + indexed history
VESSEL_MCP_PREPARE=1 pnpm start               # + unsigned preparation tools
```

Host config (stdio):

```json
{ "mcpServers": { "vessel": { "command": "npx", "args": ["tsx", "/path/to/vessel/tools/vessel-mcp/src/server.ts"] } } }
```

## Protocol and host matrix

Pinned SDK `@modelcontextprotocol/sdk` 1.31.0, protocol `2025-11-25`.

| Host | Tested | Result |
|---|---|---|
| MCP SDK client over stdio (cold process spawn) | 2026-10-01 | 15 tools listed, prepare hidden by default; `book_state` LIVE at block 67,198,107; `get_evidence` PASS; `hedge_state` UNAVAILABLE |
| Desktop/IDE AI hosts | not tested | no compatibility claim |

A working connector does not imply any AI-provider partnership.

## SDK quick use

```ts
import { Vessel, prepareBallastDeposit, TESTNET_V2, parseManifest } from "@vessel/sdk";

const v = Vessel.testnet();
const book = await v.bookState();          // envelope at the finalized block
const checks = await v.verifyBook();       // independent verdicts

const p = prepareBallastDeposit({
  manifest: parseManifest(TESTNET_V2),
  owner: "0x…",
  assets: 100_000_000n,                    // 100 dUSD
  minUnits: 0n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 86_400),
  now: Math.floor(Date.now() / 1000),
});
// p.calls → hand to the user's wallet, in order.
```
