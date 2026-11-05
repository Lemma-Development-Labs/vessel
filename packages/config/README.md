# @vessel/config

Environment and release-manifest guards (spec §5, §18, §22). Every runtime
process calls `loadRuntimeConfig(env, manifest)` and `assertRpcChainIds(...)`
at startup and refuses to start on any failure. Startup fails on:

- a missing or unknown `VESSEL_ENV` (`local | testnet | mainnet`, no default);
- a chain ID (env, manifest or live RPC) that does not match the environment;
- a malformed or placeholder address (zero, one-nibble, burn, native sentinel);
- mock/sim providers, `Mock*`/`Sim*`/`Demo*` contracts or `venue != "live"` on mainnet;
- lab (vUSD/svUSD/DollarBook) contracts, known testnet-only addresses, or Perpl
  testnet market 64 in a mainnet manifest;
- a manifest schema-version mismatch (the v0 `ADDRESSES.json` shape is accepted
  as `legacy-v0` for local/testnet only);
- mainnet with fewer than two RPC endpoints, or with admission enabled.

Dependency-free so it can be vendored: `node scripts/sync-packages.mjs` writes
`vessel-service/src/vendor/vessel-config.ts`; CI runs it with `--check`.

```bash
pnpm install && pnpm test && pnpm typecheck && pnpm lint
```
