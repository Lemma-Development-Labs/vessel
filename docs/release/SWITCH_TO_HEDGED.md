# Switch day — testnet v2 to Circle USDC and HedgedEngine (ADR-009)

The live testnet book runs on dUSD with `SimulatedEngine`. This runbook replaces it with a fresh
deployment on Circle testnet USDC, with `HedgedEngine` trading Perpl and Vessel's own Kuru markets.
The whole on-chain part has been rehearsed on a fork: `scripts/v2-deploy-hedged.sh --rehearse`
([sessions/07.md](../sessions/07.md)).

Nothing here touches mainnet. Never paste a key into chat, a ticket or a commit.

## 0. Preconditions (all must hold)

| Item | Check |
|---|---|
| Go-ahead | Explicit yes from Kunal/Priya: the switch replaces what testnet.vessel.wtf and the Railway keeper read |
| Seeder `0x933DF4E2c927903D68c1FC82691b9a06dC6249F9` | ≥ 40,000 MON (plus ~5 MON gas), ≥ 500 Circle USDC, ≥ 10,000 AUSD (holds 30,000 since 2026-10-06) |
| Deployer `0x64d81F3E47c9Ba737BE17f8F9E5398EBf7e9Ce86` | ≥ 20 Circle USDC (reserve seed) and ≥ 1 MON gas |
| Keeper `0xd1588b68d6beac5328E61166b952619b63dbf16f` | ≥ 3 MON gas (the hedge sends many more transactions than the simulated book did) |
| Safe signers | Two of the three available for batches v2h-01 and v2h-03, a few minutes apart |
| `contracts/.env` | `DEPLOYER_PK`, `KURU_SEEDER_PK`, `MONAD_TESTNET_RPC` set (names only: `grep -oE '^[A-Z_]+=' contracts/.env`) |
| Old book | Testers told the dUSD book is retiring. Their positions stay on chain and claimable through the old contracts, but the app stops showing them. Optionally exit them first (48 h cooldown). |
| Fresh rehearsal | `FORK_RPC=https://rpc.ankr.com/monad_testnet scripts/v2-deploy-hedged.sh --rehearse` passed on the day |

## 1. Deploy (about 10 minutes)

```bash
scripts/v2-deploy-hedged.sh
```

This opens the Kuru markets, places the first quotes from the seeder, archives the current manifest
to `deployments/superseded/`, deploys the core with `HedgedEngine` under the existing Safe, sends the
20 USDC reserve seed, generates batches v2h-01/03/02, and regenerates the app/SDK bindings. It
stops at the first failed step (logs in `contracts/out/deploy-hedged-logs/`).

Then verify the new contracts on Sourcify (the same `forge verify-contract` loop as
`scripts/v2-switch-safe.sh`, plus `HedgedEngine`, `PerplMarkValuation`), and commit
`deployments/`, `app/lib/book/release.ts`, `packages/sdk/src/manifests/testnet.ts` on `p-development`.

## 2. Safe batches

In the Safe app → Transaction Builder, for each batch: import `*.schedule.safe.json`, 2 of 3 sign,
execute; wait 300 s; import `*.execute.safe.json`, sign, execute.

1. `testnet-v2h-01-wire`: wires `HedgedEngine`, stage cap 25,000 USDC, close cost 1 USDC, 20 USDC reserve.
2. `testnet-v2h-03-allowances-wave1`: tester `0xD802…6206`, 1,000 USDC.
3. `testnet-v2h-02-open-series-1`: **later**, when testers are ready. It opens Hull series 1's 72 h
   subscription window; activation needs Ballast cover.

Check: `cast call <TrancheController> 'engine()(address)'` returns the `HedgedEngine`, and
`reserveNav()` returns `20000000`.

## 3. Railway (keeper + quoter)

Project `vessel-v2-keeper`, service `vessel-v2`. From `vessel-service/`, set variables without
printing them:

```bash
npx -y @railway/cli variables --set "V2_MANIFEST_JSON=$(jq -c . ../deployments/testnet-v2.json)"
( set -a; source ../contracts/.env; set +a
  npx -y @railway/cli variables --set "V2_QUOTER_PK=$KURU_SEEDER_PK" >/dev/null )
npx -y @railway/cli up --service vessel-v2 --detach
```

`V2_KEEPER_PK` stays as it is (same operator). The quoter refuses to start if its key equals the
keeper's.

Check, within 5 minutes:
- logs show `v2 keeper started` with `hedgedEngine` set, and `kuru quoter started`;
- `GET https://vessel-v2-production.up.railway.app/v1/book` reports `units: "USDC:6"` and the new
  controller, with every check PASS;
- `vessel-verify --manifest deployments/testnet-v2.json --rpc $MONAD_TESTNET_RPC --latest` OVERALL PASS.

## 4. App (Vercel)

testnet.vessel.wtf builds from `main`. The app picks up the new book from the committed
`release.ts`, so it switches only when `p-development` is merged to `main`. That is a team decision,
and it is the moment the public app changes. After the deploy:
- the Deposit page shows **USDC** and the "Get test USDC from Circle" link (no dUSD faucet);
- Transparency shows the hedged engine, spot MON vs short MON, and the not-independent price note.

## 5. First live hedge

The tester deposits Circle USDC (from faucet.circle.com) as Ballast. The keeper admits it, deploys
it, opens the engine's Perpl account, and hedges in slices. Watch `/v1/book` and Terminal → HEDGE.
Spot and short must stay within one slice; `vessel-verify` checks it.

## 6. Rollback

On chain nothing needs undoing for the old book: it is untouched. For the new one:

1. **Stop new risk now:** a Safe signer (guardian) pauses `RISK_INCREASE` on the new
   `PauseGuardian` (`pause(2)`). Buys and new shorts stop; unwinds and margin top-ups still work.
2. **Point the service back:** set `V2_MANIFEST_JSON` to the archived manifest in
   `deployments/superseded/`, delete `V2_QUOTER_PK`, redeploy.
3. **App:** revert the merge on `main` (or do not merge until steps 3 and 5 look right).
4. **Unwind the hedge** if needed: governance can call every reducing engine function
   (`closeShort`, `sellSpot`, `withdrawMargin`, `convertToCash`) through the timelock, then
   `recallFromEngine` returns USDC to custody.
