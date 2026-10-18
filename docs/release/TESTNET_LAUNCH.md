# Testnet launch checklist — hedged book

Launch means outside testers, invited in waves from the vessel.wtf sign-up form, can deposit Circle
testnet USDC, see a real Perpl hedge, and withdraw. Mainnet stays NO-GO
([GO_NO_GO.md](GO_NO_GO.md)). The deployment is live since 2026-10-09
([SWITCH_TO_HEDGED.md](SWITCH_TO_HEDGED.md), [ADDRESSES.md](../ADDRESSES.md)).

Status as of 2026-10-14. ✅ done · ⬜ open.

## A. Service on Railway (`vessel-v2-keeper` / `vessel-v2`)

- ✅ Keeper and Kuru quoter running on the hedged book; quoter posts both books around the Perpl mark.
- ⬜ **Upload the latest code** (`/v2/health`, small-book hedging). In a terminal:
  ```bash
  cd ~/Desktop/vessel/vessel-service
  npx -y @railway/cli variables --service vessel-v2 --skip-deploys --set "V2_HEDGE_MIN_MOVE_MICRO=100000"
  npx -y @railway/cli up --service vessel-v2 --detach
  ```
  Check: `https://vessel-v2-production.up.railway.app/v2/health` answers 200.
- ⬜ An uptime monitor on `/v2/health` that emails on 503 (UptimeRobot or Better Stack; see OPS.md §5).

## B. Prove the money loop on the live book

- ✅ First deposit admitted (20 USDC Ballast, 2026-10-09); book 40 USDC; `vessel-verify` PASS.
- ⬜ **First live hedge.** Grow the book to about 120 USDC: claim Circle faucet USDC
  (faucet.circle.com → Monad Testnet, 20 every 2 hours) into a few wallets, send it to the tester
  `0xD80291d7959141228611A7Ab413d9c0140Bc6206` and deposit as Ballast. With
  `V2_HEDGE_MIN_MOVE_MICRO=100000`, the keeper opens the engine's Perpl account at ~100 USDC of
  engine cash and starts spot/short slices. Check Terminal → HEDGE, or `vessel-verify`
  (`hedge.gap` PASS with spot > 0).
- ⬜ **Exit test.** From the tester: request a small Ballast exit (Withdraw), wait the 48 h cooldown,
  check the keeper funds it (partly unwinding the hedge if needed), then claim. Start it right after
  the first hedge.
- ⬜ **Exit liquidity.** Send the seeder `0x933DF4E2c927903D68c1FC82691b9a06dC6249F9` a few hundred
  Circle USDC; the quoter moves it into Kuru's bid side, which the engine sells spot into on exits.

## C. Public app (testnet.vessel.wtf builds from `main`)

- ✅ PR #15 pushed, description current, CI green.
- ⬜ Team review and **merge `p-development` → `main`**. This switches the public app to the hedged
  book.
- ⬜ Vercel: `NEXT_PUBLIC_STATS_URL=https://vessel-v2-production.up.railway.app`, a dedicated
  `NEXT_PUBLIC_RPC` (with `NEXT_PUBLIC_RPC_FALLBACK=https://rpc.ankr.com/monad_testnet`), then
  redeploy.
- ⬜ Smoke test on the live site: Deposit (USDC, Circle faucet link), Portfolio, Withdraw,
  Transparency (spot leg labelled simulated), Terminal.

## D. Testers

- ✅ [TESTER_GUIDE.md](../TESTER_GUIDE.md).
- ⬜ **Wave 1 allowlist.** Take addresses from the vessel.wtf sign-ups, then:
  ```bash
  node scripts/v2-allowance-wave.mjs 2 --file wave2.txt --usdc 500
  ```
  The Safe signs `deployments/governance/testnet-v2h-03-allowances-wave2.{schedule,execute}.safe.json`
  (300 s apart). Send each tester the guide and the app link.
- ⬜ **Hull series 1** (`testnet-v2h-02-open-series-1`), when there is enough Ballast for 30% cover
  and testers are ready to subscribe. It opens a 72 h window.

## E. Housekeeping (before or soon after launch)

- ⬜ Old v0 service `vessel-service-production`: out of gas since 2026-09-28 and reporting itself
  unhealthy. Fund or retire it. The DeltaV instructions in `CLAUDE.md` still point at it; update them
  to the v2 `/v1/book` when it is retired.
- ⬜ Rotate the Railway and Vercel tokens flagged in OPS.md §0.
- ⬜ Give each Safe signer its own key (they share one phrase during the build; G07).
- ⬜ DeltaV weekly update: draft ready; needs Kunal's X link and an explicit ok.
