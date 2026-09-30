#!/usr/bin/env bash
# Read-only chain fact check (docs/FACT_CHECKS.md). Pins the finalized block on
# Monad mainnet and testnet, then reads, at that block:
#   - mainnet reference assets (code size, decimals, symbol) and venue proxies
#     (code size + EIP-1967 implementation slot, to spot venue upgrades);
#   - every contract in ADDRESSES.json (code size), plus the live deployment's
#     roles and wiring.
# Sends no transactions. Needs Foundry's `cast`.
#
#   scripts/fact-check-chain.sh > docs/evidence/<phase>/factcheck-$(date -u +%F).txt
set -uo pipefail
M=${MONAD_MAINNET_RPC:-https://rpc.monad.xyz}
T=${MONAD_TESTNET_RPC:-https://testnet-rpc.monad.xyz}
MANIFEST="$(cd "$(dirname "$0")/.." && pwd)/ADDRESSES.json"
# EIP-1967 implementation slot: keccak256 hash of "eip1967.proxy.implementation" minus 1.
EIP1967_IMPL=0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc

pin() { cast block finalized -f number,hash,timestamp --rpc-url "$1" | tr '\n' ' '; }
size() { cast codesize "$1" --rpc-url "$2" --block "$3" 2>&1; }
impl() { cast storage "$1" "$EIP1967_IMPL" --rpc-url "$2" --block "$3" 2>&1 | sed 's/^0x000000000000000000000000/0x/'; }
addr() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['contracts'][sys.argv[2]])" "$MANIFEST" "$1"; }

echo "mainnet chainId $(cast chain-id --rpc-url "$M")"
read -r MB MH MT < <(pin "$M"); echo "mainnet finalized number=$MB blockHash=$MH ts=$MT"
echo "testnet chainId $(cast chain-id --rpc-url "$T")"
read -r TB TH TT < <(pin "$T"); echo "testnet finalized number=$TB blockHash=$TH ts=$TT"

echo "--- mainnet refs @ $MB"
while read -r name a; do
  echo "$name $a codesize=$(size "$a" "$M" "$MB") decimals=$(cast call "$a" 'decimals()(uint8)' --rpc-url "$M" --block "$MB") symbol=$(cast call "$a" 'symbol()(string)' --rpc-url "$M" --block "$MB")"
done <<'EOF'
USDC 0x754704Bc059F8C67012fEd69BC8A327a5aafb603
AUSD 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a
WMON 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A
EOF
while read -r name a; do
  echo "$name $a codesize=$(size "$a" "$M" "$MB") eip1967impl=$(impl "$a" "$M" "$MB")"
done <<'EOF'
KuruMONUSDC 0x065C9d28E428A0db40191a54d33d5b7c71a9C394
KuruMONAUSD 0x131a2e70a5b31a517a74b8c567149bc294470da9
PerplExchange 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F
EOF

echo "--- testnet deployment ($MANIFEST) @ $TB"
python3 -c "import json,sys;[print(k,v) for k,v in json.load(open(sys.argv[1]))['contracts'].items()]" "$MANIFEST" |
  while read -r name a; do echo "$name $a codesize=$(size "$a" "$T" "$TB")"; done
c() { cast call "$(addr "$1")" "$2" --rpc-url "$T" --block "$TB" 2>&1; }
OWNER=$(c Guardian 'owner()(address)')
echo "Guardian.owner=$OWNER paused=$(c Guardian 'paused()(bool)')"
echo "Tranches.treasury=$(c Tranches 'treasury()(address)') SimVenue.owner=$(c SimVenue 'owner()(address)')"
echo "Safe VERSION=$(cast call "$OWNER" 'VERSION()(string)' --rpc-url "$T" --block "$TB") threshold=$(cast call "$OWNER" 'getThreshold()(uint256)' --rpc-url "$T" --block "$TB") owners=$(cast call "$OWNER" 'getOwners()(address[])' --rpc-url "$T" --block "$TB")"
echo "deployer Tranches=$(c Tranches 'deployer()(address)') BlitzVault=$(c BlitzVault 'deployer()(address)') EngineLite=$(c EngineLite 'deployer()(address)')"
echo "SimVenue.isSimulated=$(c SimVenue 'isSimulated()(bool)') EngineLite.router=$(c EngineLite 'router()(address)') BlitzVault.asset=$(c BlitzVault 'asset()(address)')"
echo "EngineLite.lastCrank=$(c EngineLite 'lastCrank()(uint256)') (block ts $TT)"
