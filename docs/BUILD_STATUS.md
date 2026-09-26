# BUILD_STATUS

Updated 2026-09-23 · branch `harden/p0-testnet` · v2 program per
[spec/VESSEL_V1.md](spec/VESSEL_V1.md), sessions per §25.

## Overall readiness

**blocked** (for the v2 mainnet beta): G01–G05 all open (venue custody,
market metadata, oracles, conversion route, independent review). The v0
testnet demo remains live and unaffected.

## Session 1 — in progress

Done (this checkpoint, see [sessions/01.md](sessions/01.md) for evidence):

- v2 blueprint pack imported to `docs/spec/`, SHA-256 verified against the
  pack manifest.
- Repository reconciled against the blueprint; per-decision status in
  [DECISIONS.md](DECISIONS.md).
- Chain-evidence fact check: mainnet references (USDC/AUSD/WMON decimals,
  Kuru/Perpl code + proxy impls) and the live testnet deployment (all 11
  contracts, Safe 2-of-3 owner verified) — [FACT_CHECKS.md](FACT_CHECKS.md).
- Architecture frozen — [ARCHITECTURE.md](ARCHITECTURE.md).
- Shared schema source created and tested — `packages/domain`
  (15 tests + typecheck green; golden-vector conservation verified).
- Requirements-to-test matrix — [TEST_PLAN.md](TEST_PLAN.md).
- Root [AGENTS.md](../AGENTS.md), auth design freeze [AUTH.md](AUTH.md).

Remaining in Session 1:

1. **Authenticated app shell** — implement AUTH.md (SIWE endpoints in
   vessel-service + Next.js rewrites + shell auth state + tests).
   *Sequencing:* waits for the uncommitted `vessel-service/src/db.ts` /
   `src/indexer.ts` changes (indexer reset on redeploy) to be committed by
   their author first, to avoid colliding edits.
2. Update README/FACTS/powers.md to the live deployment (drift items in
   FACT_CHECKS.md §Drift) — also queued behind the in-flight harden work,
   which owns `ADDRESSES.json` and `app/lib/verification.ts`.

## Blockers and follow-ups (owner: see FACT_CHECKS.md G-register)

- Session prompt files `docs/spec/prompts/01–08_SESSION.md` not yet provided
  (hashes known); Session 1 is running from the blueprint + COMMON.md by
  Kunal's instruction.
- Safe signer-key independence for `0xe4f2…0279` unevidenced.
- OPS.md §0 token rotation (Railway/Vercel) unconfirmed.
- Sourcify re-verification of the 11 live addresses pending
  (`pnpm verify:manifest`, no hand edits).
- Keeper key shares a process/env with the public API (accepted for gas-only
  key; must split before any venue-authority key — ARCHITECTURE decision 4).

## Uncommitted user work in the tree (do not touch)

`ADDRESSES.json`, `app/lib/addresses.ts`, `app/lib/verification.ts`,
`app/package.json`, `app/pnpm-lock.yaml`, `vessel-service/src/db.ts`,
`vessel-service/src/indexer.ts`, `app/probe*.mjs` — in-flight
`harden/p0-testnet` changes by Kunal.

## Resume instruction

Resume **Session 1** at "Authenticated app shell": implement
[AUTH.md](AUTH.md) once the in-flight vessel-service changes are committed;
then close Session 1 with a full checkpoint in sessions/01.md and proceed to
Session 2 (executable accounting model + local Hull/Ballast lifecycle).
