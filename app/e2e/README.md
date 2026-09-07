# Playwright stranger path (prompt 08 §G)

Cold path on public URLs was **not** executed in this agent (needs MON faucet +
fresh wallet + timed steps). Review-bar coverage ships as Vitest:

- `app/lib/__tests__/prompt09-ui.test.ts`
- `app/lib/__tests__/audit-08.test.ts`

To run live later:

```bash
cd app
pnpm add -D @playwright/test
pnpm exec playwright install chromium
PLAYWRIGHT_BASE_URL=https://testnet.vessel.wtf pnpm exec playwright test
```

Config stub: `playwright.config.ts`.
