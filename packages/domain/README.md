# @vessel/domain

The single shared schema source (spec §5, docs/ARCHITECTURE.md decision 2):
evidence envelope + source tags (LIVE/STALE/UNAVAILABLE/PARTIAL/MISMATCH/
SIMULATED), versioned unit definitions, strict integer decimal-string math,
and the golden accounting vector schema with an independent conservation
check.

Rules: money never touches `Number`; `UNAVAILABLE` carries no value; only
`LIVE` can authorize new risk.

Standalone package (no root workspace — see ARCHITECTURE decision 1).

```bash
pnpm install
pnpm test
pnpm typecheck
```
