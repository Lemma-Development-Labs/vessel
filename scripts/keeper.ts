/**
 * Permissionless crank loop. The key only pays gas.
 *
 * Monad charges GAS LIMIT, not usage — we set gas = min(estimate * 1.3, GAS_CAP).
 */
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { defineChain } from "viem";
import { ADDRESSES, CHAIN_ID } from "../app/lib/addresses.ts";
import { decodeVesselError } from "../app/lib/errors.ts";
import engineAbi from "../app/lib/abis/EngineLite.json" with { type: "json" };

const RPC_URL = process.env.RPC_URL;
const KEEPER_PK = process.env.KEEPER_PK as `0x${string}` | undefined;
const INTERVAL = Number(process.env.CRANK_INTERVAL_SEC ?? 300);
const GAS_CAP = 1_500_000n;
const MIN_BAL = parseEther("0.5");

if (!RPC_URL || !KEEPER_PK) {
  console.error("RPC_URL and KEEPER_PK are required");
  process.exit(1);
}

const chain =
  CHAIN_ID === 31337
    ? { ...foundry, rpcUrls: { default: { http: [RPC_URL] } } }
    : defineChain({
        id: CHAIN_ID,
        name: CHAIN_ID === 143 ? "Monad" : "Monad Testnet",
        nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
        rpcUrls: { default: { http: [RPC_URL] } },
      });

const account = privateKeyToAccount(KEEPER_PK);
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });

let inflight = false;

async function tick() {
  if (inflight) {
    console.log(new Date().toISOString(), "skip: in-flight crank");
    return;
  }
  inflight = true;
  try {
    const bps = (await publicClient.readContract({
      address: ADDRESSES.EngineLite,
      abi: engineAbi,
      functionName: "netDeltaBps",
    })) as bigint;
    console.log(new Date().toISOString(), "netDeltaBps", bps.toString());

    const gasEst = await publicClient.estimateContractGas({
      address: ADDRESSES.EngineLite,
      abi: engineAbi,
      functionName: "crank",
      account,
    });
    const gas = gasEst * 13n / 10n > GAS_CAP ? GAS_CAP : gasEst * 13n / 10n;

    const hash = await wallet.writeContract({
      address: ADDRESSES.EngineLite,
      abi: engineAbi,
      functionName: "crank",
      gas,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("cranked", hash, "status", receipt.status, "gasLimit", gas.toString());
  } catch (err) {
    const reason = decodeVesselError(err) || (err instanceof Error ? err.message : String(err));
    console.log(new Date().toISOString(), "skip revert:", reason);
  } finally {
    inflight = false;
  }
}

async function main() {
  const bal = await publicClient.getBalance({ address: account.address });
  if (bal < MIN_BAL) {
    console.error(
      `keeper ${account.address} balance ${formatEther(bal)} < 0.5 — refuse to start (key is gas-only; fund it)`,
    );
    process.exit(1);
  }

  console.log("keeper", account.address, "chain", CHAIN_ID, "every", INTERVAL, "s");
  await tick();
  setInterval(() => {
    void tick();
  }, INTERVAL * 1000);
}

void main();
