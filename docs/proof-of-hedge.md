# Proof of hedge

Recompute Vessel's accounting from public reads. Unaudited. Demo dollars.

Source of addresses: [`ADDRESSES.json`](../ADDRESSES.json) (written by `script/Deploy.s.sol`).

## Cast

```bash
# deck TVL + subordination (thetaBps is the last field)
cast call $TRANCHES "deckStats()((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256))" --rpc-url $RPC

# vault identity: totalAssets == idle + deployed
cast call $VAULT "totalAssets()(uint256)" --rpc-url $RPC
cast call $VAULT "deployed()(uint256)" --rpc-url $RPC

# hedge
cast call $ENGINE "netDeltaBps()(int256)" --rpc-url $RPC
cast call $ENGINE "shortId()(uint256)" --rpc-url $RPC
```

## viem

```ts
import { createPublicClient, http } from "viem";
import { ADDRESSES } from "../app/lib/addresses";
import tranchesAbi from "../app/lib/abis/Tranches.json";

const client = createPublicClient({
  transport: http(process.env.RPC_URL),
});
const deck = await client.readContract({
  address: ADDRESSES.Tranches,
  abi: tranchesAbi,
  functionName: "deckStats",
});
```

Live stats (when the Railway service is up): `GET $NEXT_PUBLIC_STATS_URL/stats`.
If that feed is down, the app falls back to on-chain `getLogs` and this page still works from RPC.
