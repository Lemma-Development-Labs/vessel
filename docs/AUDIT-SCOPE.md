# Audit scope — Vessel (engagement brief)

**Purpose:** hand this to a professional audit firm. This is **not** an audit
report and must never be cited as one.

## In scope

### Contracts (`contracts/src/`)

- `DemoUSD.sol` (testnet only — call out removal for mainnet)
- `BlitzVault.sol` (ERC-4626, dead shares, engine callbacks, pause egress)
- `Tranches.sol` / `TrancheToken.sol` (waterfall, floor, settle conservation, deposit caps)
- `EngineLite.sol` (deploy / crank / unwind, spot PnL cap, optional `ISpotOracle`, net-delta halt)
- `oracles/RouterMidOracle.sol`, `oracles/ManualTwapOracle.sol`
- `Guardian.sol` (+ planned TimelockController ownership — `script/DeployTimelock.s.sol`)
- `venues/SimVenue.sol` (testnet) and any live `IVenue` implementation at freeze
- Router adapter used at freeze (MockRouter today; Kuru adapter when wired)
- Libraries: `Decimals.sol`

### Explicit economic invariants

1. ΔHull + ΔBallast + ΔReserve + fees == grossYield (every settle)
2. Ballast floor (θ ≥ 20%) on joins / ballast exits
3. Negative funding: Ballast → reserve; Hull never haircut (impairment reverts)
4. Vault identity: `totalAssets == idle + deployed`
5. Pause: ingress frozen; unwind + exits remain possible
6. No stuck principal after permissionless unwind (modulo empty-book router risk)

### Off-chain (informational / threat model)

- Keeper policy (`keeper/src/policy.ts`) + CRE import of `decide()`
- Indexer gas_limit discipline (Monad)
- UI `Live<T>` provenance (fabrication class)

## Out of scope (unless added in writing)

- Third-party venues (Perpl, Kuru) internals
- Monad client / RPC providers
- Frontend XSS beyond contract-facing calldata construction
- Legal / securities classification of Hull

## Prior art for the firm

- `docs/FINDINGS-08.md` — self-hostile review
- `docs/MAINNET-READY.md` — remaining gates
- `HARDENING.md` / `SECURITY.md` — known limitations (spot mark, dead shares, ledger vs cash)
- Foundry: `test/fuzz/`, `test/invariant/VesselInvariant.t.sol`, `PauseMatrix.t.sol`
- CI: fuzz 25k, Slither `--fail-none`, coverage gate

## Deliverables expected from the firm

1. Written report with severity taxonomy
2. PoC or clear repro for every Medium+
3. Fix review pass after remediations
4. Public summary suitable for `SECURITY.md` linking

## Current claim (do not alter without Gate 3)

**Unaudited.** Internal review and tooling are not a substitute for Gate 3.
