import type { Page } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * A minimal injected EIP-1193 wallet for browser tests. The page only sees an
 * address and a `window.__vesselTestSign` bridge; the private key is generated
 * here, per call, and never leaves the Node test process.
 */
export async function installTestWallet(page: Page, chainId = 10143): Promise<`0x${string}`> {
  const account = privateKeyToAccount(generatePrivateKey());
  await page.exposeFunction("__vesselTestSign", (hexMessage: `0x${string}`) =>
    account.signMessage({ message: { raw: hexMessage } }),
  );
  await page.addInitScript(
    ({ address, chainIdHex }) => {
      type Listener = (...args: unknown[]) => void;
      const listeners = new Map<string, Set<Listener>>();
      // Like a real wallet, a granted connection survives a page reload.
      const KEY = "__vesselTestWalletConnected";
      let connected = localStorage.getItem(KEY) === "1";
      const setConnected = (on: boolean) => {
        connected = on;
        localStorage.setItem(KEY, on ? "1" : "0");
      };
      const provider = {
        isMetaMask: false,
        isVesselTestWallet: true,
        on(event: string, fn: Listener) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(fn);
          return provider;
        },
        removeListener(event: string, fn: Listener) {
          listeners.get(event)?.delete(fn);
          return provider;
        },
        async request({ method, params }: { method: string; params?: unknown[] }) {
          switch (method) {
            case "eth_requestAccounts":
              setConnected(true);
              return [address];
            case "eth_accounts":
              return connected ? [address] : [];
            case "eth_chainId":
              return chainIdHex;
            case "net_version":
              return String(parseInt(chainIdHex, 16));
            case "wallet_switchEthereumChain":
            case "wallet_addEthereumChain":
              return null;
            case "wallet_requestPermissions":
              setConnected(true);
              return [{ parentCapability: "eth_accounts" }];
            case "wallet_revokePermissions":
              setConnected(false);
              return null;
            case "personal_sign": {
              const [hex, from] = params as [`0x${string}`, string];
              if (from.toLowerCase() !== address.toLowerCase()) throw { code: 4100, message: "unknown account" };
              return (window as unknown as { __vesselTestSign: (h: string) => Promise<string> }).__vesselTestSign(hex);
            }
            default:
              throw { code: 4200, message: `test wallet: ${method} not supported` };
          }
        },
      };
      (window as unknown as { ethereum: unknown }).ethereum = provider;
    },
    { address: account.address, chainIdHex: `0x${chainId.toString(16)}` },
  );
  return account.address;
}
