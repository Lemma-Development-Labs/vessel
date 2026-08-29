"use client";

import { createConfig, http, injected } from "wagmi";
import { defineChain, type Chain } from "viem";
import { foundry } from "viem/chains";
import { CHAIN_ID } from "./addresses";

const rpc =
  process.env.NEXT_PUBLIC_RPC ??
  (CHAIN_ID === 31337 ? "http://127.0.0.1:8545" : "https://testnet-rpc.monad.xyz");

const explorer =
  process.env.NEXT_PUBLIC_EXPLORER ?? "https://testnet.monadvision.com";

const envChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? CHAIN_ID);

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
  blockExplorers: { default: { name: "MonadVision", url: explorer } },
});

function makeChain(): Chain {
  if (envChainId === 31337) {
    return {
      ...foundry,
      rpcUrls: { default: { http: [rpc] } },
      blockExplorers: { default: { name: "Explorer", url: explorer } },
    };
  }
  if (envChainId === 143) {
    return defineChain({
      id: 143,
      name: "Monad",
      nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
      blockExplorers: {
        default: { name: "MonadVision", url: "https://monadvision.com" },
      },
    });
  }
  return monadTestnet;
}

export const vesselChain = makeChain();

export const wagmiConfig = createConfig({
  chains: [vesselChain],
  connectors: [injected()],
  transports: { [vesselChain.id]: http(rpc) },
  ssr: true,
});

export const EXPLORER = explorer;
export const TARGET_CHAIN_ID = vesselChain.id;
