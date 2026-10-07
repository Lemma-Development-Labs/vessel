#!/usr/bin/env bash
# Fresh v2 testnet deployment on Circle USDC with HedgedEngine (ADR-009).
#
#   1. open Vessel's Kuru markets (MON/USDC, MON/AUSD)
#   2. quote them around the Perpl mark (KuruQuotes; needs test MON, USDC, AUSD)
#   3. deploy the v2 core with HedgedEngine, governed by the existing Safe
#   4. send the 20 USDC reserve seed to the new timelock
#   5. generate Safe batches v2h-01 (wire) and v2h-03 (allowances)
#   6. rehearsal only: execute both batches as the Safe, make a USDC deposit,
#      run the real keeper against the fork, print what the engine holds
#   7. vessel-verify against the result
#
# Usage:
#   scripts/v2-deploy-hedged.sh --rehearse   # local Anvil fork of testnet; the repo and chain are untouched
#   scripts/v2-deploy-hedged.sh              # REAL testnet broadcast; writes deployments/
#
# The real run replaces deployments/testnet-v2.json (the old manifest is archived), which is what the
# app, SDK and keeper read. Do it only with an explicit go-ahead and the Safe signers ready.
#
# Needs contracts/.env with DEPLOYER_PK and MONAD_TESTNET_RPC (and KURU_SEEDER_PK for real quotes).
# Values are never printed.
set -euo pipefail

MODE="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORGE="$(command -v forge || echo "$HOME/.foundry/bin/forge")"
CAST="$(command -v cast || echo "$HOME/.foundry/bin/cast")"
ANVIL="$(command -v anvil || echo "$HOME/.foundry/bin/anvil")"
CURRENT="$ROOT/deployments/testnet-v2.json"

set -a
# shellcheck disable=SC1091
source "$ROOT/contracts/.env"
set +a
: "${DEPLOYER_PK:?DEPLOYER_PK missing in contracts/.env}"
: "${MONAD_TESTNET_RPC:?MONAD_TESTNET_RPC missing in contracts/.env}"

USDC=0x534b2f3A21130d7a60830c2Df862319e593943A3      # Circle, Monad testnet
AUSD=0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC      # Perpl testnet collateral
PERPL=0x1964C32f0bE608E7D29302AFF5E61268E72080cc
PERPL_OWNER=0x582ea4aBe762A303A934E5983a2CdDeC336193B1
PERP_ID=64
KURU_ROUTER=0x7EFbE105Ca7415dE98F96622173458ac1c054630
SAFE="$(jq -r '.safe' "$ROOT/deployments/testnet-safe.json")"
DEPLOYER="$("$CAST" wallet address --private-key "$DEPLOYER_PK")"

if [ "$MODE" = "--rehearse" ]; then
  PORT=8548
  # FORK_RPC overrides the endpoint the fork reads from (the public RPC times out under load).
  "$ANVIL" --fork-url "${FORK_RPC:-$MONAD_TESTNET_RPC}" --port "$PORT" --silent --auto-impersonate --retries 15 --timeout 60000 >/dev/null 2>&1 &
  ANVIL_PID=$!
  trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
  RPC="http://127.0.0.1:$PORT"
  for _ in $(seq 1 90); do "$CAST" block-number --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 1; done
  "$CAST" block-number --rpc-url "$RPC" >/dev/null || { echo "anvil fork did not start"; exit 1; }
  OUT="$ROOT/contracts/out/rehearsal-hedged"   # inside forge fs_permissions; contracts/out is gitignored
  rm -rf "$OUT"   # every rehearsal starts clean: a fork re-creates the same market addresses
  BROADCAST=(--broadcast)
  # Anvil's well-known account #1 stands in for the keeper so the real keeper code can sign on the fork.
  KEEPER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  KEEPER_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
  TESTER=0xD80291d7959141228611A7Ab413d9c0140Bc6206
  DELAY=1
  SEEDER_PK="$DEPLOYER_PK"
  echo "== REHEARSAL on a local fork of testnet (nothing is sent to the real chain)"
else
  RPC="$MONAD_TESTNET_RPC"
  OUT="$ROOT/deployments"
  BROADCAST=(--broadcast --slow)
  KEEPER="$(jq -r '.roles.operator' "$CURRENT")"
  DELAY=300
  SEEDER_PK="${KURU_SEEDER_PK:-}"
  echo "== REAL testnet broadcast"
fi
mkdir -p "$OUT" "$OUT/governance"
LOGS="$ROOT/contracts/out/deploy-hedged-logs"
mkdir -p "$LOGS"

forge_step() {
  local name="$1" pattern="$2"; shift 2
  if ! (cd "$ROOT/contracts" && "$@") >"$LOGS/$name.log" 2>&1; then
    echo "   FAILED: $name (log: contracts/out/deploy-hedged-logs/$name.log)"
    tail -15 "$LOGS/$name.log"
    exit 1
  fi
  grep -E "$pattern" "$LOGS/$name.log" || true
}

# Rehearsal only: Perpl's mark cannot move on a frozen fork, so it goes stale after 60 s and the engine
# (correctly) refuses to trade. Step 0 tells the forked exchange to skip its (equally frozen) external
# oracle for MON, and this re-posts the CURRENT mark as Perpl's owner, as Perpl's live price feeder would.
# Probed 2026-10-06: a mark push alone reverts on the stale oracle; with ignOracle it is accepted and
# shorts fill. Never runs outside --rehearse.
refresh_mark() {
  [ "$MODE" = "--rehearse" ] || return 0
  local mark
  # getPosition returns (position, markPricePNS, valid); any account id works for the mark.
  mark="$("$CAST" call "$PERPL" 'getPosition(uint256,uint256)((uint256,uint256,uint256,uint8,uint256,uint256,uint256,uint256,int256,int256,int256),uint256,bool)' "$PERP_ID" 1 --rpc-url "$RPC" | sed -n 2p | awk '{print $1}')"
  "$CAST" send "$PERPL" 'updateMarkPricePNSByOwner(uint256,uint32)' "$PERP_ID" "$((mark * (10000 + ${1:-0}) / 10000))" \
    --from "$PERPL_OWNER" --unlocked --rpc-url "$RPC" >/dev/null
}

if [ "$MODE" = "--rehearse" ]; then
  echo "== 0/7 fund rehearsal accounts (fork only)"
  for a in "$DEPLOYER" "$KEEPER" "$SAFE" "$PERPL_OWNER" "$PERPL" "$TESTER"; do
    "$CAST" rpc anvil_setBalance "$a" 0x152D02C7E14AF6800000 --rpc-url "$RPC" >/dev/null   # 100,000 MON
  done
  "$CAST" rpc anvil_setBalance "$DEPLOYER" 0x52B7D2DCC80CD2E4000000 --rpc-url "$RPC" >/dev/null   # 100M MON for quotes
  MM="$("$CAST" call "$USDC" 'masterMinter()(address)' --rpc-url "$RPC")"
  "$CAST" rpc anvil_setBalance "$MM" 0xDE0B6B3A7640000 --rpc-url "$RPC" >/dev/null
  "$CAST" send "$USDC" 'configureMinter(address,uint256)' "$DEPLOYER" 1000000000000 --from "$MM" --unlocked --rpc-url "$RPC" >/dev/null
  "$CAST" send "$USDC" 'mint(address,uint256)' "$DEPLOYER" 100000000000 --private-key "$DEPLOYER_PK" --rpc-url "$RPC" >/dev/null
  "$CAST" send "$USDC" 'mint(address,uint256)' "$TESTER" 1000000000 --private-key "$DEPLOYER_PK" --rpc-url "$RPC" >/dev/null
  "$CAST" send "$AUSD" 'transfer(address,uint256)' "$DEPLOYER" 100000000000 --from "$PERPL" --unlocked --rpc-url "$RPC" >/dev/null
  "$CAST" send "$PERPL" 'setIgnOracle(uint256,bool)' "$PERP_ID" true --from "$PERPL_OWNER" --unlocked --rpc-url "$RPC" >/dev/null
  refresh_mark
  echo "   deployer, keeper, Safe and tester funded; 100k USDC + 100k AUSD to the deployer, 1,000 USDC to the tester"
fi

echo "== 1/7 open Vessel's Kuru markets"
K_TMP="$ROOT/contracts/out/testnet-kuru-markets.new.json"
rm -f "$K_TMP"
forge_step open-markets "MON/USDC|MON/AUSD" env KURU_MARKETS_OUT="$K_TMP" \
  "$FORGE" script script/OpenKuruMarkets.s.sol:OpenKuruMarkets --rpc-url "$RPC" "${BROADCAST[@]}"
mv "$K_TMP" "$OUT/testnet-kuru-markets.json"
K="$OUT/testnet-kuru-markets.json"

echo "== 2/7 quote the markets around the Perpl mark"
if [ -z "$SEEDER_PK" ]; then
  echo "   SKIPPED: KURU_SEEDER_PK unset. The engine cannot trade until the markets are quoted;"
  echo "   run script/KuruQuotes.s.sol once the seeder holds test MON, USDC and AUSD."
else
  refresh_mark
  forge_step quotes "Perpl mark|written" env KURU_SEEDER_PK="$SEEDER_PK" KURU_MARKETS="$K" \
    KURU_QUOTES_STATE="$OUT/testnet-kuru-quotes.json" QUOTE_PER_SIDE="${QUOTE_PER_SIDE:-5000000000}" \
    "$FORGE" script script/KuruQuotes.s.sol:KuruQuotes --rpc-url "$RPC" "${BROADCAST[@]}"
fi

if [ "$MODE" != "--rehearse" ]; then
  OLD_BLOCK="$(jq -r '.deployedBlock' "$CURRENT")"
  mkdir -p "$ROOT/deployments/superseded"
  cp "$CURRENT" "$ROOT/deployments/superseded/testnet-v2-block$OLD_BLOCK.json"
  echo "   previous manifest archived to deployments/superseded/testnet-v2-block$OLD_BLOCK.json"
fi

echo "== 3/7 deploy the v2 core with HedgedEngine (Safe $SAFE, operator $KEEPER)"
refresh_mark
M_TMP="$ROOT/contracts/out/testnet-v2.new.json"
rm -f "$M_TMP"
forge_step deploy-v2 "ONCHAIN EXECUTION|SIMULATION COMPLETE" env V2_ENGINE=hedged V2_SAFE="$SAFE" V2_OPERATOR="$KEEPER" \
  V2_ASSET="$USDC" V2_AUSD="$AUSD" V2_PERPL="$PERPL" V2_PERP_ID="$PERP_ID" V2_KURU_ROUTER="$KURU_ROUTER" \
  V2_KURU_MON_USDC="$(jq -r '.monUsdc' "$K")" V2_KURU_MON_AUSD="$(jq -r '.monAusd' "$K")" \
  V2_TIMELOCK_DELAY="$DELAY" V2_MANIFEST_OUT="$M_TMP" \
  "$FORGE" script script/DeployV2.s.sol:DeployV2 --rpc-url "$RPC" "${BROADCAST[@]}"
mv "$M_TMP" "$OUT/testnet-v2.json"
M="$OUT/testnet-v2.json"
TL="$(jq -r '.contracts.TimelockController' "$M")"
TC="$(jq -r '.contracts.TrancheController' "$M")"
ENGINE="$(jq -r '.contracts.HedgedEngine' "$M")"
echo "   controller $TC timelock $TL engine $ENGINE"

echo "== 4/7 reserve seed: 20 USDC to the timelock"
"$CAST" send "$USDC" "transfer(address,uint256)" "$TL" 20000000 --private-key "$DEPLOYER_PK" --rpc-url "$RPC" --json \
  | jq -r '"   status \(.status) tx \(.transactionHash)"'

echo "== 5/7 governance batches"
GOV="$OUT/governance"
for s in testnet-v2h-01-wire testnet-v2h-03-allowances-wave1; do
  [ "$GOV" = "$ROOT/deployments/governance" ] || cp "$ROOT/deployments/governance/$s.json" "$GOV/"
  (cd "$ROOT" && PATH="$(dirname "$CAST"):$PATH" node scripts/v2-governance-batch.mjs "$GOV/$s.json" "$M" | tail -1)
done

if [ "$MODE" = "--rehearse" ]; then
  echo "== 6/7 rehearse: batches as the Safe, a USDC deposit, the real keeper"
  for s in testnet-v2h-01-wire testnet-v2h-03-allowances-wave1; do
    SD="$(jq -r '.transactions[0].data' "$GOV/$s.schedule.safe.json")"
    ED="$(jq -r '.transactions[0].data' "$GOV/$s.execute.safe.json")"
    "$CAST" send "$TL" "$SD" --from "$SAFE" --unlocked --rpc-url "$RPC" >/dev/null
    "$CAST" rpc evm_increaseTime "$((DELAY + 1))" --rpc-url "$RPC" >/dev/null && "$CAST" rpc evm_mine --rpc-url "$RPC" >/dev/null
    "$CAST" send "$TL" "$ED" --from "$SAFE" --unlocked --rpc-url "$RPC" --json | jq -r --arg s "$s" '"   \($s) executed: status \(.status)"'
  done
  echo "   engine $("$CAST" call "$TC" 'engine()(address)' --rpc-url "$RPC") reserve $("$CAST" call "$TC" 'reserveNav()(uint256)' --rpc-url "$RPC")"
  CUSTODY="$(jq -r '.contracts.AssetCustody' "$M")"
  "$CAST" send "$USDC" 'approve(address,uint256)' "$CUSTODY" 1000000000 --from "$TESTER" --unlocked --rpc-url "$RPC" >/dev/null
  DEADLINE=$(( $("$CAST" block latest -f timestamp --rpc-url "$RPC") + 86400 ))
  "$CAST" send "$TC" 'requestDeposit(uint8,uint256,uint256,address,uint256,uint256)' 1 0 1000000000 "$TESTER" 0 "$DEADLINE" \
    --from "$TESTER" --unlocked --rpc-url "$RPC" --json | jq -r '"   tester requested a 1,000 USDC Ballast deposit: status \(.status)"'

  # The real keeper and the Kuru quoter, against the fork, while the mark is kept fresh in the background.
  # Halfway through, MON moves MARK_MOVE_BPS (default +60, twice the engine's 30 bps band): the quoter
  # must re-centre the Kuru books on its own, or the engine stops trading.
  HALF=$(( ${KEEPER_SECONDS:-150} / 2 ))
  ( start=$SECONDS; moved=0
    while true; do
      if [ $moved = 0 ] && [ $((SECONDS - start)) -ge $HALF ]; then refresh_mark "${MARK_MOVE_BPS:-60}" || true; moved=1
      else refresh_mark || true; fi
      sleep 5
    done ) &
  REFRESH_PID=$!
  trap 'kill $REFRESH_PID $ANVIL_PID 2>/dev/null || true' EXIT
  (cd "$ROOT/vessel-service" && V2_MANIFEST_PATH="$M" V2_KEEPER_PK="$KEEPER_PK" V2_QUOTER_PK="$SEEDER_PK" RPC="$RPC" \
    V2_KEEPER_INTERVAL_MS=1500 V2_QUOTER_INTERVAL_MS=4000 \
    V2_SETTLE_EVERY_SEC=600 npx tsx scripts/rehearse-keeper.ts "${KEEPER_SECONDS:-150}" 2>"$LOGS/keeper.log" | tail -1 \
    | jq -c '{engine, keeperActions: (.keeper | length), keeperLast: (.keeper[-4:]), quoter}')
  kill $REFRESH_PID 2>/dev/null || true
  wait $REFRESH_PID 2>/dev/null || true
else
  echo "== 6/7 regenerate bindings (Safe signs batches v2h-01 then v2h-03; see deployments/governance)"
  (cd "$ROOT" && node scripts/sync-v2-app.mjs | grep -v '^ok' || true)
  (cd "$ROOT" && node scripts/sync-packages.mjs | grep -v '^ok' || true)
fi

echo "== 7/7 independent check"
refresh_mark
(cd "$ROOT/tools/verify-cli" && pnpm -s verify --manifest "$M" --rpc "$RPC" --latest 2>&1 | grep -E "engine|hedge|valuation|OVERALL|MISMATCH|Could not" || true)
echo "== done: controller $TC engine $ENGINE"
