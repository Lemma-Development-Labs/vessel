/**
 * Dual-network surface for Vessel.
 *
 * - 10143 testnet: live DemoUSD stack (default).
 * - 143 mainnet: same app binary; flip `MAINNET_CONTRACTS_DEPLOYED` only after
 *   ADDRESSES.mainnet.json is filled + Sourcify (Gate 4).
 *
 * Never invent mainnet contract addresses here.
 */

export type VesselNetworkId = 10143 | 143 | 31337;

export type NetworkProfile = {
  chainId: VesselNetworkId;
  label: string;
  shortLabel: string;
  banner: string;
  legal: string;
  rpcDefault: string;
  explorerDefault: string;
  /** Product may show DemoUSD faucet */
  faucetEnabled: boolean;
  /** True only when Gate 4 addresses exist — keep false until then. */
  mainnetDeployed: boolean;
};

/** Honesty latch: must stay false until ADDRESSES.mainnet.json has real contracts. */
export const MAINNET_CONTRACTS_DEPLOYED = false;

export const NETWORKS: Record<VesselNetworkId, NetworkProfile> = {
  10143: {
    chainId: 10143,
    label: "Monad Testnet",
    shortLabel: "TESTNET",
    banner: "TESTNET · chain 10143 · unaudited · not Vessel Finance",
    legal:
      "Unaudited testnet. Demo dollars (dUSD) have no value. Not an offer of securities.",
    rpcDefault: "https://testnet-rpc.monad.xyz",
    explorerDefault: "https://testnet.monadvision.com",
    faucetEnabled: true,
    mainnetDeployed: false,
  },
  143: {
    chainId: 143,
    label: "Monad",
    shortLabel: "MAINNET",
    banner: MAINNET_CONTRACTS_DEPLOYED
      ? "MAINNET · chain 143 · unaudited until Gate 3 report is public"
      : "MAINNET TARGET · chain 143 · contracts not deployed — do not deposit",
    legal: MAINNET_CONTRACTS_DEPLOYED
      ? "Unaudited unless docs/MAINNET-READY.md Gate 3 is green with a public firm report."
      : "Mainnet Vessel contracts are not deployed. This build is a dry-run shell only.",
    rpcDefault: "https://rpc.monad.xyz",
    explorerDefault: "https://monadvision.com",
    faucetEnabled: false,
    mainnetDeployed: MAINNET_CONTRACTS_DEPLOYED,
  },
  31337: {
    chainId: 31337,
    label: "Anvil",
    shortLabel: "LOCAL",
    banner: "LOCAL · anvil 31337 · unaudited",
    legal: "Local development only.",
    rpcDefault: "http://127.0.0.1:8545",
    explorerDefault: "http://127.0.0.1:8545",
    faucetEnabled: true,
    mainnetDeployed: false,
  },
};

export function activeNetwork(): NetworkProfile {
  const id = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 10143) as VesselNetworkId;
  return NETWORKS[id] ?? NETWORKS[10143];
}

export function isMainnetBuild(): boolean {
  return activeNetwork().chainId === 143;
}
