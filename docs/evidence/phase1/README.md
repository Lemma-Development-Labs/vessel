# Phase 1 evidence (2026-09-30)

Raw output of the test reproduction runs cited in [../../INVENTORY.md](../../INVENTORY.md) §1.
Machine: macOS (darwin arm64), Foundry 1.8.3, Node 24.14.0, pnpm 10.33.3 (app) / 12.8.1 (domain, keeper).
Branch runs used detached worktrees at the `origin/cursor/*` tips fetched on 2026-09-30.

| File | Command |
|---|---|
| forge-test-default.txt | `cd contracts && forge test` |
| forge-test-ci-25k.txt | `cd contracts && FOUNDRY_PROFILE=ci forge test --fuzz-runs 25000` |
| app.txt | `cd app && pnpm install --frozen-lockfile && pnpm test && pnpm lint` |
| domain.txt | `cd packages/domain && pnpm install && pnpm test && pnpm typecheck` |
| forge-perpl-venue.txt | `forge test` at `origin/cursor/perpl-venue-bf3b` (tail) |
| forge-mainnet-gates.txt | `forge test` at `origin/cursor/mainnet-gates-bf3b` (tail) |
| keeper-mainnet-gates.txt | `cd keeper && pnpm install --ignore-scripts && pnpm test` at `origin/cursor/mainnet-gates-bf3b` |
| onboarding-desktop.png, onboarding-mobile-360.png | `cd app && pnpm e2e` — full-page screenshots at the end of the onboarding journey (test wallets generated per run) |
