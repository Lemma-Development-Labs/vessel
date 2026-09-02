"use client";

import { createConfig, http, injected } from "wagmi";
import { walletConnect } from "wagmi/connectors/walletConnect";
import { defineChain, fallback, type Chain } from "viem";

import { foundry } from "viem/chains";
import { CHAIN_ID } from "./addresses";

/**
 * Multicall3 at its canonical cross-chain address. Verified deployed on Monad
 * testnet (eth_getCode returns 7,618 chars).
 *
 * viem's publicClient.multicall REFUSES to run unless the chain declares this —
 * it throws `Chain "Monad Testnet" does not support contract "multicall3"`.
 * Without it every batched read in lib/chain.tsx threw, `reads.data` stayed
 * undefined forever, and the app sat on a loading skeleton with every value
 * rendering unavailable. It was invisible while the app was serving mock data.
 */
const MULTICALL3 = { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" as const } };

function rpcList(): string[] {
  const chainHint = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? CHAIN_ID);
  const primary =
    process.env.NEXT_PUBLIC_RPC ??
    (chainHint === 31337 ? "http://127.0.0.1:8545" : "https://testnet-rpc.monad.xyz");
  const extra = process.env.NEXT_PUBLIC_RPC_FALLBACK ?? "";
  const fromCsv = primary.split(",").map((s) => s.trim()).filter(Boolean);
  const fallbacks = extra.split(",").map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of [...fromCsv, ...fallbacks]) {
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out.length ? out : ["https://testnet-rpc.monad.xyz"];
}

const rpcs = rpcList();

const explorer = process.env.NEXT_PUBLIC_EXPLORER ?? "https://testnet.monadvision.com";

const envChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? CHAIN_ID);

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: rpcs } },
  blockExplorers: { default: { name: "Monad Testnet Explorer", url: explorer } },
  contracts: MULTICALL3,
});

function makeChain(): Chain {
  if (envChainId === 31337) {
    return {
      ...foundry,
      rpcUrls: { default: { http: rpcs } },
      blockExplorers: { default: { name: "Explorer", url: explorer } },
      contracts: { ...foundry.contracts, ...MULTICALL3 },
    };
  }
  if (envChainId === 143) {
    return defineChain({
      id: 143,
      name: "Monad",
      nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
      rpcUrls: { default: { http: rpcs } },
      blockExplorers: { default: { name: "Monad Explorer", url: "https://monadvision.com" } },
      contracts: MULTICALL3,
    });
  }
  return monadTestnet;
}

export const vesselChain = makeChain();

/**
 * PHASE 3.1 — mobile access.
 *
 * Injected-only meant the app was unusable on mobile Safari, which is most of
 * the people who open a link from a phone: there is no injected provider there,
 * so "Connect" did nothing. WalletConnect v2 is the path that works.
 *
 * It is opt-in on the project id: without NEXT_PUBLIC_WC_PROJECT_ID the
 * connector would fail at runtime, so we omit it rather than ship a button
 * that throws. `WC_ENABLED` lets the UI explain the gap instead of hiding it.
 */
export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim();
export const WC_ENABLED = Boolean(WC_PROJECT_ID);

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://testnet.vessel.wtf";

const connectors = [
  injected({ shimDisconnect: true }),
  ...(WC_PROJECT_ID
    ? [
        walletConnect({
          projectId: WC_PROJECT_ID,
          showQrModal: true,
          metadata: {
            name: "Vessel (testnet)",
            description: "Delta-neutral tranched vault on Monad testnet. Demo assets, unaudited.",
            url: APP_URL,
            icons: [`${APP_URL}/favicon.ico`],
          },
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [vesselChain],
  connectors,
  transports: {
    [vesselChain.id]: fallback(rpcs.map((u) => http(u))),
  },
  ssr: true,
});

export const EXPLORER = explorer;
export const TARGET_CHAIN_ID = vesselChain.id;

/** Chain params for wallet_addEthereumChain, from the configured chain. */
export const ADD_CHAIN_PARAMS = {
  chainId: `0x${TARGET_CHAIN_ID.toString(16)}`,
  chainName: vesselChain.name,
  nativeCurrency: vesselChain.nativeCurrency,
  rpcUrls: [vesselChain.rpcUrls.default.http[0]],
  blockExplorerUrls: vesselChain.blockExplorers ? [vesselChain.blockExplorers.default.url] : [],
} as const;

/**
 * Where a stranger gets gas. Gas comes before dUSD: without MON no
 * transaction can be sent at all, including the dUSD faucet, so this link has
 * to come first in the onboarding order.
 */
export const MONAD_FAUCET_URL =
  process.env.NEXT_PUBLIC_MONAD_FAUCET ?? "https://faucet.monad.xyz";

/** True on phones/tablets, where WalletConnect should lead. SSR-safe. */
export function isMobileUA(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile Safari/i.test(navigator.userAgent);
}
