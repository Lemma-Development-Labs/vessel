# Vessel app

Next.js UI for Vessel. Design contract: [`CLAUDE.md`](./CLAUDE.md).

```bash
cp .env.example .env.local
pnpm install
pnpm dev          # NEXT_PUBLIC_USE_MOCK=1 — fixture data (wallet sign-in stays real)
# live chain reads: unset NEXT_PUBLIC_USE_MOCK (only "1" enables fixtures)
```

`pnpm start` binds `0.0.0.0` and uses `$PORT`.
