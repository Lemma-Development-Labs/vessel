# @vessel/domain

The single shared schema source (spec §5, docs/ARCHITECTURE.md decision 2):
evidence envelope + source tags (LIVE/STALE/UNAVAILABLE/PARTIAL/MISMATCH/
SIMULATED), versioned unit definitions, strict integer decimal-string math,
and the golden accounting vector schema with an independent conservation
check.

Rules: money never touches `Number`; `UNAVAILABLE` carries no value;
`PARTIAL`/`MISMATCH` must carry a reason; only `LIVE` can authorize new risk.

- `money.ts` — wire money is `{amount: "<integer string>", unit}`;
  `decodeMoney` rejects JavaScript numbers (even safe integers), floats,
  exponents, non-canonical strings and unknown units.
- `eslint-money-rules.js` — shared lint rules that make `Number()`,
  `parseFloat`/`parseInt`, `Math.*`, `toFixed`, unary `+` and float literals
  errors in economic `src/` code. Other packages import this file rather than
  copying it; `test/money-lint.test.ts` proves each banned form is caught.

Standalone package (no root workspace — see ARCHITECTURE decision 1).

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```
