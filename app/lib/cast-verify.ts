import { ADDRESSES } from "./addresses";

const RPC = "https://testnet-rpc.monad.xyz";

/**
 * Copy-pasteable cast commands a stranger can run to reproduce net-delta.
 * Addresses come from the synced ADDRESSES table — never hard-coded elsewhere.
 */
export function netDeltaCastBlock(): string {
  const engine = ADDRESSES.EngineLite;
  const venue = ADDRESSES.SimVenue;
  const wmon = ADDRESSES.MockWMON;
  return `# Reproduce Vessel net delta on Monad testnet (chain 10143)
RPC=${RPC}
ENGINE=${engine}
VENUE=${venue}
WMON=${wmon}

# Spot inventory (WMON wei held by EngineLite)
cast call $WMON "balanceOf(address)(uint256)" $ENGINE --rpc-url $RPC

# Open short id (0 = undeployed)
cast call $ENGINE "shortId()(uint256)" --rpc-url $RPC

# With SHORT_ID from above (skip if 0):
# cast call $VENUE "position(uint256)(uint256,int256)" $SHORT_ID --rpc-url $RPC

# Engine-computed net delta (spot mark − short notional), dUSD 6dp signed
cast call $ENGINE "netDelta()(int256)" --rpc-url $RPC
cast call $ENGINE "netDeltaBps()(int256)" --rpc-url $RPC

# netDelta = spotValue − |shortNotional|
# A stranger reproducing the transparency number from these commands *is* the product.`;
}
