# AGENTS.md — rules for agents working in this repository

Vessel is a Monad structured-capital protocol. The current deployment is a
**testnet demo with a simulated venue and a valueless asset (dUSD)**. The v2
target product is specified in [docs/spec/VESSEL_V1.md](docs/spec/VESSEL_V1.md).

## Authority order

1. **Actual chain state and reproducible evidence** — always wins for current
   facts. Never treat old tests, prior reports, screenshots, or generated
   answers as evidence that current code works.
2. **docs/spec/VESSEL_V1.md** — intended product policy (decisions D01–D18).
   Supersedes older product books. Changing a D-decision requires an ADR in
   docs/DECISIONS.md (old rule, replacement, reason, accounting impact,
   migration effect, tests, review owner).
3. **Repository code and its tests** — what the system actually does today.
4. **Root docs (README, FACTS, OPS, HARDENING, SECURITY)** — operational
   record. If they contradict chain state, chain state wins; record the drift
   in docs/FACT_CHECKS.md and fix the docs, not the evidence.

Read before changing anything: this file, [CLAUDE.md](CLAUDE.md),
[docs/BUILD_STATUS.md](docs/BUILD_STATUS.md),
[docs/DECISIONS.md](docs/DECISIONS.md), the latest checkpoint in
docs/sessions/, and [app/CLAUDE.md](app/CLAUDE.md) for any UI work.

## Build rules

- Money is integer fixed-point: BigInt / decimal strings with explicit units
  (`packages/domain`). Never JavaScript `Number` for money, prices, or rates.
- Public data carries source freshness and environment (LIVE / STALE /
  UNAVAILABLE / PARTIAL / MISMATCH / SIMULATED). Missing data has no numeric
  value; only LIVE state can authorize new risk.
- No production mocks, fake metrics, hard-coded healthy states, silent zero
  fallbacks, generic execute escape hatches, or TODOs in money-moving paths.
  Simulation fixtures live in explicit test modules only.
- No private keys or production credentials in source, bundles, logs, fixtures,
  or evidence. `pnpm secrets` must stay green; note its known gaps (OPS.md §0.1).
- Preserve unrelated user changes in the working tree. Do not restart the
  project or redesign its identity.

## Tests

- Contracts: `cd contracts && forge test --offline` (CI: 25k fuzz, gas
  snapshot ±10%, sizes, coverage ≥95%, Slither). Green before any deploy.
- App: `cd app && pnpm test && pnpm lint && pnpm build`.
- Domain schemas: `cd packages/domain && pnpm test && pnpm typecheck`.
- Record exact commands, seeds, environment, and exit status in the session
  checkpoint. Never claim a test ran if it did not.

## Commits

Configured git author, conventional scoped messages
(`feat(scope): …` / `fix:` / `docs:` / `chore:`), **no Co-authored-by or other
attribution trailers**. Update docs and BUILD_STATUS in the same commits as the
behavior they describe. No force-push or history rewrites. Push only with
explicit authorization.

## Stop conditions — never do without explicit human authorization

- Mainnet deployment, funding, or any transaction that moves real value.
- Timelock execution, cap increases, invitations, or beta stage transitions.
- Creating, moving, or exposing signing keys; adding a signer to anything.
- Posting to external services (DeltaV rules live in CLAUDE.md).
- Deleting deployed-state history (databases, broadcast records).

If a required external capability is missing (venue custody, oracle, review),
record the blocked feature and the evidence needed in docs/BUILD_STATUS.md and
continue independent work. Do not mock the dependency and call it live.

## Sessions

v2 work proceeds in the eight sessions of docs/spec/VESSEL_V1.md §25 under the
operating contract [docs/spec/prompts/COMMON.md](docs/spec/prompts/COMMON.md).
Each session ends with a durable checkpoint in docs/sessions/NN.md and an
updated docs/BUILD_STATUS.md, including the exact resume instruction. The
readiness answer is one of: local complete, testnet evidenced, review
candidate, canary eligible, external beta eligible, or blocked.
