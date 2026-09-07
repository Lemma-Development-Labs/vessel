# Findings — Prompt 08 (hostile audit, 2026-09-07)

Stance: prove the thesis false. Highest-value output is a defect we publish ourselves.

Fetched first: MONSKILLS `gas/` + `concepts/`; live Perpl docs (`docs.perpl.xyz`, api-docs);
Kuru Flow / depth docs. Perpl testnet collateral still shows **GATE-0 drift**
(README USD `0xdf5b…` vs live `/v1/pub/context` AUSD `0xa9012a…`).

## Findings

| # | Severity | Class | File:line | Repro | Fix | Publishable? |
|---|---|---|---|---|---|---|
| 1 | **blocker** | Stuck funds / pause | `EngineLite.sol` unwind + `PauseMatrix.t.sol` | Guardian `pause()` → `unwind` / exits / withdraw revert. Deployed cash (~90%) frozen until owner unpauses. | Permissionless unwind (and preferably exits) while paused, **or** auto-unwind-on-pause. Document in RISK. | Yes |
| 2 | **blocker** | Key-loss | `docs/security/powers.md` Safe 0x85Fe… | Pause owner described as Safe but historically 1-of-1 same-machine. Lose that key while paused → permanent freeze. | Real 2-of-3; pause escape hatch; RISK key-loss section (done this PR). | Yes |
| 3 | **blocker** | Product honesty | `PerplVenue.stub.sol:isSimulated` | Stub reverts every mutative call but returned `isSimulated()==false`. | Return `true` until live Perpl surface (fixed this PR). | Yes |
| 4 | **blocker** | Invariant gap | `contracts/test/` | No Foundry `invariant_*` / Handler. Economics only `testFuzz_*` single-call. | Handler + conservation / floor / unwind round-trip — **scaffold landed** `VesselInvariant.t.sol` (10k runs green this PR); expand coverage still open. | Yes |
| 5 | **high** | False claim | `docs/announce.md:12-14` | “live… short the **perp**” while venue=sim, MockRouter, pending hashes. | Rewrite to SimVenue / MockRouter honesty (fixed this PR). | Yes |
| 6 | **high** | Doc vs code | `docs/series/001.md:8` | Says losses go Ballast→reserve→**Hull**. Code never haircuts Hull; impairment reverts. | Rewrite (fixed this PR). | Yes |
| 7 | **high** | Three-stable | `docs/risk.md` vs live vault | Live vault asset = DemoUSD `0x66B5…`, not Kuru USDC `0x3bA3…`. `KuruQuoteTokenMatch` etches a mock — theatre. | Gate Kuru wire on on-chain `vault.asset()==quoteToken`; chips stay SIM. | Yes |
| 8 | **high** | Fabricated indexer | `indexer/.../vessel.ts` crank handler | Wrote `spotInventory:0`, `shortNotional:0` on every crank. | Omit inventing inventory; only store event-derived delta (fixed this PR). | Yes |
| 9 | **high** | Empty book / unwind | UI + CAPACITY | Unwind needs router quote; empty Kuru ask → stuck inventory. | Cap/minOut strategy; refuse deploy on empty book. | Yes |
| 10 | **medium** | Keeper `?? 0` | `keeper/src/main.ts` | `bestAsk ?? 0` / funding coerce → silent wrong hedge. | Halt on missing book; never coerce to 0. | Yes |
| 11 | **medium** | Live constructible | `app/lib/live.ts` | Structural union allows hand-built `{status:"ok",…}`. | Brand + lint (tracked). | Conditional |
| 12 | **medium** | UI hide unwind | `exit-flow.tsx` UnwindCard | Returned `null` when undeployed — stranger cannot always reach Unwind. | Always-visible ActionBar with disabled reason (fixed this PR). | Yes |
| 13 | **medium** | netDelta off-chain | `EngineLite` view + keeper policy | Dead keeper → no reduce/halt; on-chain crank still runs. | On-chain band or CRE latch. | Yes |
| 14 | **medium** | Envio / CRE overclaim | ADDRESSES / CRE.md | GraphQL pending; CRE simulate auth-gated. | Chips / copy stay pending (UI honesty bar this PR). | Yes |
| 15 | **low** | deployedBlock drift | FACTS vs ADDRESSES | 57874280 vs 57918591. | Single source of truth. | Yes |
| 16 | **info** | Doc drift | Perpl collateral | api-docs README USD vs docs.perpl.xyz / live context AUSD. | Prefer live `/v1/pub/context`; keep GATE-0 note. | Yes |

## What I did not test

- Live bytecode vs current `BlitzVault` (dead-share / `liveAssets`) on MonadVision.
- Fork deploy→unwind against a real non-empty Kuru book.
- CRE DON / hosted Envio GraphQL / authenticated Perpl order path.
- Cold stranger path on public URLs with a fresh wallet (needs MON faucet + dUSD; timed ≥90s unknown).
- Formal Slither re-run in this pass.

## What I would break first

1. Guardian pause with capital deployed → prove exits/unwind revert.
2. Unfunded mark settles that inflate book above idle cash.
3. UI/label treating PerplVenue stub as live (`isSimulated==false` — fixed).
4. Keeper `bestAsk ?? 0` on a flat book.

## What should be deleted / corrected before 13 Oct

- Announce “short the perp” present-tense (corrected).
- Series-001 “then Hull” loss line (corrected).
- Any logo/chip implying Kuru/Perpl/Envio/CRE **live** without hashes in `ADDRESSES.md`.
- `PerplVenue.isSimulated→false` until real venue (corrected).
- Indexer inventing spot/short = 0 on cranks (corrected).
- HARDENING “deposit/mint = anyone” row vs `onlyTranches` (still open).
- SECURITY vs source dead-share contradiction (still open — pick one after bytecode check).
