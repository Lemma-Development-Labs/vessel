# Chainlink CRE — Vessel short-manager orchestration

## Why CRE and not a cron (submission lead)

The keeper is a single machine we control. A depositor has to trust it. CRE puts
the *decision* under DON consensus: multiple nodes independently read the venue
and the chain and must agree before the engine is cranked, reduced, or halted.
For a protocol whose thesis is that you should not have to trust us, moving the
decision off our machine is the point.

---

## Fact-check — `cre workflow supported-chains`

CLI installed: **CRE CLI v1.32.0** (`~/.cre/bin/cre`).

### Literal command output (2026-09-07, this agent)

```text
$ cre workflow supported-chains --output json
Initializing...

! You are not logged in

✗ Authentication required: not logged in and no CRE_API_KEY set
  → Run 'cre login' interactively, or
  → Set CRE_API_KEY environment variable for non-interactive use
✗ authentication required: no credentials found: you are not logged in, run cre login and try again
```

Tenant-scoped chain lists require `cre login` or `CRE_API_KEY`. This environment
has neither. **We do not invent a supported-chains JSON blob.**

### Public Supported Networks (docs, not tenant-scoped)

From https://docs.chain.link/cre/supported-networks-ts (fetched 2026-09-07):

| Network | Min CLI | Min TS SDK |
|---|---|---|
| Monad (mainnet) | v1.29.0+ | v1.18.0+ |
| **Monad Testnet** | **v1.30.0+** | **v1.19.0+** |

CCIP publishes Monad testnet chain selector `2183018362218727504` (suggestive;
not the same registry as CRE tenant enablement). Recorded in `cre/config.json`
as `ccipMonadTestnetSelector`.

### Dual-path design

| If Monad is enabled for our tenant | If it is not |
|---|---|
| Set `useEvmMonad: true` and add `EVMClient` reads of EngineLite | Default: HTTP capability reads signed `GET /cre/snapshot` on the keeper / vessel-service |
| Optionally EVM write via KeystoneForwarder | HTTP POST decision to `POST /cre/decision` (auth token) |

**Default shipping config sets `useEvmMonad: false`** so a gated EVM capability
costs nothing. We do not fake EVM.

---

## Layout

```
cre/
  main.ts          cron trigger + gather → decide → act
  config.json      endpoints, addresses, selectors
  workflow.yaml    metadata per target
  secrets.yaml     cre-act-token declaration
  project.yaml     rpcs (monad-testnet + sepolia)
  snapshot.ts      re-exports keeper serializers
  test/            policy equivalence (same fixtures as keeper)
```

Policy: `import { decide } from "../keeper/src/policy.ts"` — **imported, not copied**.

---

## Simulation artifact

Simulate counts for the bounty. Deployment is Early Access.

```bash
export PATH="$HOME/.cre/bin:$PATH"
cd cre && bun install
# requires cre login / CRE_API_KEY for full simulate host features:
cre workflow simulate . --target local-settings --allow-insecure-rpc
```

### Simulate attempt (2026-09-07, this agent)

Without login, `cre workflow simulate` cannot authenticate to the CRE platform
(same gate as `supported-chains`). Captured failure mode:

```text
Authentication required: not logged in and no CRE_API_KEY set
```

**Shipped artifact:** workflow source + equivalence tests + docs. After
`cre login`, re-run simulate and paste the successful transcript below this
section (do not imply a DON deployment you do not have).

`cre execution list` / deploy: **not run** — Early Access; would require
`cre account access` approval. Simulation is the honest ship target.

---

## End-to-end halt

1. CRE decides `halt` via shared `decide()`.
2. CRE POSTs to keeper `POST /cre/decision` with `Authorization: Bearer $CRE_ACT_TOKEN`.
3. Keeper `latchCreHalt()` → `killSwitch` true on next cycle → policy stays halted.
4. Transparency shows last decision `source: CRE` and `creHaltLatched`.

Tests: `keeper/test/cre-halt.test.ts`, `cre/test/policy-equivalence.test.ts`.

---

## Review bar

| Check | Result |
|---|---|
| `policy.decide()` imported, not copied? | Yes — `cre/main.ts` imports keeper |
| Claim deployed DON we do not have? | No — simulation EA; deploy not claimed |
| Literal `supported-chains` output in docs? | Yes — auth failure captured above |
| CRE `halt` stops keeper e2e? | Yes — latch + killSwitch + tests |
