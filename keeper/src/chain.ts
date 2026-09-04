/**
 * Monad chain reads/writes. Gas budgeted on gas_limit (MONSKILLS gas/).
 * Never setInterval against the public testnet RPC.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  type PublicClient,
  type WalletClient,
  type Account,
  type Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const MONAD_TESTNET = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [""] } },
});

const engineAbi = [
  {
    type: "function",
    name: "crank",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "lastCrank",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "netDeltaBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "int256" }],
  },
  {
    type: "function",
    name: "wmon",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "router",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const satisfies Abi;

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const satisfies Abi;

const routerAbi = [
  {
    type: "function",
    name: "quoteExactBaseForQuote",
    stateMutability: "view",
    inputs: [{ name: "baseIn", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const satisfies Abi;

/** Ceiling for crank gas_limit — Monad charges the limit, not gas_used. */
export const CRANK_GAS_LIMIT = 550_000n;

export function clients(rpcUrl: string, pk?: `0x${string}`): {
  publicClient: PublicClient;
  wallet?: WalletClient;
  account?: Account;
} {
  const chain = { ...MONAD_TESTNET, rpcUrls: { default: { http: [rpcUrl] } } };
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  if (!pk) return { publicClient };
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  return { publicClient, wallet, account };
}

export async function readEngineState(
  publicClient: PublicClient,
  engine: `0x${string}`,
): Promise<{
  spotInventoryWei: bigint;
  spotValueQuote: bigint;
  netDeltaBps: number;
  lastCrankBlock: bigint;
  headBlock: bigint;
  gasBudgetWei: bigint;
  keeper?: `0x${string}`;
}> {
  const [wmon, router, lastCrank, netDelta, head] = await Promise.all([
    publicClient.readContract({ address: engine, abi: engineAbi, functionName: "wmon" }),
    publicClient.readContract({ address: engine, abi: engineAbi, functionName: "router" }),
    publicClient.readContract({ address: engine, abi: engineAbi, functionName: "lastCrank" }),
    publicClient.readContract({ address: engine, abi: engineAbi, functionName: "netDeltaBps" }),
    publicClient.getBlockNumber(),
  ]);
  const spotInventoryWei = (await publicClient.readContract({
    address: wmon as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [engine],
  })) as bigint;
  const spotValueQuote =
    spotInventoryWei === 0n
      ? 0n
      : ((await publicClient.readContract({
          address: router as `0x${string}`,
          abi: routerAbi,
          functionName: "quoteExactBaseForQuote",
          args: [spotInventoryWei],
        })) as bigint);
  return {
    spotInventoryWei,
    spotValueQuote,
    netDeltaBps: Number(netDelta),
    lastCrankBlock: lastCrank as bigint,
    headBlock: head,
    gasBudgetWei: 0n,
  };
}

export async function crankOnce(
  publicClient: PublicClient,
  wallet: WalletClient,
  account: Account,
  engine: `0x${string}`,
): Promise<`0x${string}`> {
  // Prefer estimate then buffer 10%, but always send an explicit gas_limit —
  // Monad bills the limit (MONSKILLS gas/).
  let gas = CRANK_GAS_LIMIT;
  try {
    const est = await publicClient.estimateContractGas({
      address: engine,
      abi: engineAbi,
      functionName: "crank",
      account: account.address,
    });
    const buffered = est + (est * 10n) / 100n;
    gas = buffered > CRANK_GAS_LIMIT ? CRANK_GAS_LIMIT : buffered;
  } catch {
    /* keep ceiling */
  }
  const hash = await wallet.writeContract({
    address: engine,
    abi: engineAbi,
    functionName: "crank",
    account,
    chain: wallet.chain,
    gas,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
