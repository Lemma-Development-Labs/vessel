#!/usr/bin/env bash
# Move the v2 testnet deployment to a NEW governance Safe.
#
# The deployed contracts bind their Safe immutably (timelock proposer/executor,
# guardian, fee treasury), so a new Safe means a new deployment:
#   1. create a 2-of-N Safe from signer ADDRESSES (no signer key is needed)
#   2. deploy the v2 core governed by it (same keeper/operator, same DemoUSD)
#   3. send the 20 dUSD reserve seed to the new timelock
#   4. regenerate governance batches, app/SDK/MCP bindings, Sourcify state
#   5. check the result with vessel-verify
#
# Usage:
#   scripts/v2-switch-safe.sh <owner1,owner2,owner3> --rehearse   # local fork of testnet; repo untouched
#   scripts/v2-switch-safe.sh <owner1,owner2,owner3>              # real testnet broadcast
#
# Needs contracts/.env with DEPLOYER_PK and MONAD_TESTNET_RPC. Values are never printed.
set -euo pipefail

OWNERS="${1:?usage: $0 <owner1,owner2,owner3> [--rehearse]}"
MODE="${2:-}"
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

KEEPER="$(jq -r '.roles.operator' "$CURRENT")"
ASSET="$(jq -r '.contracts.DemoUSD' "$CURRENT")"

if [ "$MODE" = "--rehearse" ]; then
  PORT=8547
  "$ANVIL" --fork-url "$MONAD_TESTNET_RPC" --port "$PORT" --silent --auto-impersonate >/dev/null 2>&1 &
  ANVIL_PID=$!
  trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
  RPC="http://127.0.0.1:$PORT"
  for _ in $(seq 1 30); do "$CAST" block-number --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 1; done
  OUT="$ROOT/contracts/out/rehearsal"   # inside forge fs_permissions; contracts/out is gitignored
  BROADCAST=(--broadcast)
  echo "== REHEARSAL on a local fork of testnet (nothing is sent to the real chain)"
else
  RPC="$MONAD_TESTNET_RPC"
  OUT="$ROOT/deployments"
  BROADCAST=(--broadcast --slow)
  echo "== REAL testnet broadcast"
fi
mkdir -p "$OUT"

echo "== 1/5 create Safe (threshold ${SAFE_THRESHOLD:-2}) for $OWNERS"
(cd "$ROOT/contracts" && SAFE_OWNERS="$OWNERS" SAFE_OUT="$OUT/testnet-safe.json" \
  "$FORGE" script script/CreateSafe.s.sol:CreateSafe --rpc-url "$RPC" "${BROADCAST[@]}" 2>&1 \
  | grep -E "safe |written to|Error|revert" || true)
SAFE="$(jq -r '.safe' "$OUT/testnet-safe.json")"
echo "   safe $SAFE threshold $("$CAST" call "$SAFE" 'getThreshold()(uint256)' --rpc-url "$RPC")"

if [ "$MODE" != "--rehearse" ]; then
  OLD_BLOCK="$(jq -r '.deployedBlock' "$CURRENT")"
  mkdir -p "$ROOT/deployments/superseded"
  cp "$CURRENT" "$ROOT/deployments/superseded/testnet-v2-block$OLD_BLOCK.json"
  echo "   previous manifest archived to deployments/superseded/testnet-v2-block$OLD_BLOCK.json"
fi

echo "== 2/5 deploy v2 core governed by the new Safe"
(cd "$ROOT/contracts" && V2_SAFE="$SAFE" V2_OPERATOR="$KEEPER" V2_ASSET="$ASSET" V2_TIMELOCK_DELAY=300 \
  V2_MANIFEST_OUT="$OUT/testnet-v2.json" \
  "$FORGE" script script/DeployV2.s.sol:DeployV2 --rpc-url "$RPC" "${BROADCAST[@]}" 2>&1 \
  | grep -E "ONCHAIN EXECUTION|manifest written|Error|revert" || true)
M="$OUT/testnet-v2.json"
TL="$(jq -r '.contracts.TimelockController' "$M")"
TC="$(jq -r '.contracts.TrancheController' "$M")"
echo "   controller $TC timelock $TL"

echo "== 3/5 reserve seed: 20 dUSD to the new timelock"
"$CAST" send "$ASSET" "transfer(address,uint256)" "$TL" 20000000 --private-key "$DEPLOYER_PK" --rpc-url "$RPC" --json \
  | jq -r '"   status \(.status) tx \(.transactionHash)"'

echo "== 4/5 governance batches"
GOV="$OUT/governance"
if [ "$MODE" = "--rehearse" ]; then
  mkdir -p "$GOV"
  cp "$ROOT"/deployments/governance/testnet-v2-0[12]-*.json "$GOV/" 2>/dev/null || true
  rm -f "$GOV"/*.safe.json
else
  GOV="$ROOT/deployments/governance"
fi
for spec in "$GOV/testnet-v2-01-wire.json" "$GOV/testnet-v2-02-open-series-1.json"; do
  (cd "$ROOT" && PATH="$(dirname "$CAST"):$PATH" node scripts/v2-governance-batch.mjs "$spec" "$M" | tail -1)
done

if [ "$MODE" = "--rehearse" ]; then
  echo "== 5/5 rehearse batch 01 as the Safe: schedule, wait 5 min, execute"
  "$CAST" rpc anvil_setBalance "$SAFE" 0xDE0B6B3A7640000 --rpc-url "$RPC" >/dev/null
  SD="$(jq -r '.transactions[0].data' "$GOV/testnet-v2-01-wire.schedule.safe.json")"
  ED="$(jq -r '.transactions[0].data' "$GOV/testnet-v2-01-wire.execute.safe.json")"
  "$CAST" send "$TL" "$SD" --from "$SAFE" --unlocked --rpc-url "$RPC" --json | jq -r '"   schedule status \(.status)"'
  if "$CAST" send "$TL" "$ED" --from "$SAFE" --unlocked --rpc-url "$RPC" >/dev/null 2>&1; then
    echo "   ERROR: execute succeeded before the delay"; exit 1
  else
    echo "   execute before delay: refused (expected)"
  fi
  "$CAST" rpc evm_increaseTime 301 --rpc-url "$RPC" >/dev/null && "$CAST" rpc evm_mine --rpc-url "$RPC" >/dev/null
  "$CAST" send "$TL" "$ED" --from "$SAFE" --unlocked --rpc-url "$RPC" --json | jq -r '"   execute status \(.status)"'
  echo "   engine $("$CAST" call "$TC" 'engine()(address)' --rpc-url "$RPC") stageCap $("$CAST" call "$TC" 'stageCap()(uint256)' --rpc-url "$RPC") reserve $("$CAST" call "$TC" 'reserveNav()(uint256)' --rpc-url "$RPC")"
else
  echo "== 5/5 regenerate bindings and verify sources"
  (cd "$ROOT" && node scripts/sync-v2-app.mjs | grep -v '^ok' || true)
  (cd "$ROOT" && node scripts/sync-packages.mjs | grep -v '^ok' || true)
  for name in TimelockController PauseGuardian TrancheController AssetCustody ClaimEscrow BallastToken SimulatedEngine; do
    addr="$(jq -r ".contracts.$name" "$M")"
    case "$name" in
      TimelockController) id="lib/openzeppelin-contracts/contracts/governance/TimelockController.sol:TimelockController" ;;
      PauseGuardian) id="src/core/governance/PauseGuardian.sol:PauseGuardian" ;;
      SimulatedEngine) id="src/core/testnet/SimulatedEngine.sol:SimulatedEngine" ;;
      *) id="src/core/$name.sol:$name" ;;
    esac
    (cd "$ROOT/contracts" && "$FORGE" verify-contract "$addr" "$id" --chain 10143 --verifier sourcify \
      --verifier-url https://sourcify-api-monad.blockvision.org/ --rpc-url "$RPC" --guess-constructor-args --watch 2>&1 \
      | grep -E "Status|successfully" | tail -1 | sed "s/^/   $name: /")
  done
  # Badge state comes from Sourcify's own record (verifiedAt), for every contract the app shows.
  RESULTS="$ROOT/contracts/out/verify-results.json"
  echo '{}' > "$RESULTS"
  for pair in $(jq -r -s '(.[0].contracts + .[1].contracts) | to_entries[] | "\(.key)=\(.value)"' "$ROOT/ADDRESSES.json" "$M"); do
    n="${pair%%=*}"; a="${pair#*=}"; u="https://sourcify-api-monad.blockvision.org/v2/contract/10143/$a"
    b="$(curl -s "$u")"
    if [ "$(echo "$b" | jq -r .match)" = "exact_match" ] || [ "$(echo "$b" | jq -r .match)" = "match" ]; then
      jq --arg n "$n" --arg t "$(echo "$b" | jq -r .verifiedAt)" --arg u "$u" '.[$n]={state:"verified",checkedAt:$t,url:$u}' "$RESULTS" > "$RESULTS.tmp" && mv "$RESULTS.tmp" "$RESULTS"
    fi
  done
  (cd "$ROOT" && node scripts/verify-manifest.mjs --results "$RESULTS" | tail -1)
fi

echo "== independent check"
(cd "$ROOT/tools/verify-cli" && pnpm -s verify --manifest "$M" --rpc "$RPC" --latest 2>&1 | grep -E "OVERALL|MISMATCH|Could not")
echo "== done: safe $SAFE controller $TC"
