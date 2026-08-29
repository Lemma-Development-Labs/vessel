# Vessel app

Next.js UI for Vessel. Design contract: [`CLAUDE.md`](./CLAUDE.md).

```bash
cp .env.example .env.local
pnpm install
pnpm dev          # NEXT_PUBLIC_USE_MOCK=1 — no wallet
# after deploy: USE_MOCK=0, restart
```

`pnpm start` binds `0.0.0.0` and uses `$PORT`.
