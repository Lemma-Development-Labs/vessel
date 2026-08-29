/**
 * Permissionless crank loop. The key only pays gas.
 *
 * Monad charges GAS LIMIT, not usage — we set gas = min(estimate * 1.3, GAS.crank).
 */
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { defineChain } from "viem";
import { ADDRESSES, CHAIN_ID } from "../app/lib/addresses.ts";
import { decodeVesselError } from "../app/lib/errors.ts";
import { GAS } from "../app/lib/gas.ts";
import engineAbi from "../app/lib/abis/EngineLite.json" with { type: "json" };

const RPC_URL = process.env.RPC_URL;
const KEEPER_PK = process.env.KEEPER_PK as `0x${string}` | undefined;
const INTERVAL = Number(process.env.CRANK_INTERVAL_SEC ?? 300);
const GAS_CAP = GAS.crank;
const MIN_BAL = parseEther("0.5");

const EXPECTED_SKIP = /DtZero|Paused|NotWired|AlreadyDeployed|NothingDeployable/;

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
let consecutiveFailures = 0;
let cycle = 0;

async function preflight() {
  const onChain = await publicClient.getChainId();
  if (onChain !== CHAIN_ID) {
    console.error(`preflight: chainId ${onChain} != ADDRESSES ${CHAIN_ID}`);
    process.exit(1);
  }
  for (const [name, addr] of Object.entries(ADDRESSES)) {
    const code = await publicClient.getCode({ address: addr as `0x${string}` });
    if (!code || code === "0x") {
      console.error(`preflight: no code at ${name} ${addr}`);
      process.exit(1);
    }
  }
  const bal = await publicClient.getBalance({ address: account.address });
  if (bal < MIN_BAL) {
    console.error(
      `keeper ${account.address} balance ${formatEther(bal)} < 0.5 — refuse to start (key is gas-only; fund it)`,
    );
    process.exit(1);
  }
  console.log(
    "preflight ok",
    "keeper",
    account.address,
    "chain",
    CHAIN_ID,
    "bal",
    formatEther(bal),
    "every",
    INTERVAL,
    "s",
  );
}

async function tick() {
  if (inflight) {
    console.log(new Date().toISOString(), "heartbeat", ++cycle, "skip: in-flight crank");
    return;
  }
  inflight = true;
  cycle += 1;
  try {
    const bps = (await publicClient.readContract({
      address: ADDRESSES.EngineLite,
      abi: engineAbi,
      functionName: "netDeltaBps",
    })) as bigint;
    console.log(new Date().toISOString(), "heartbeat", cycle, "netDeltaBps", bps.toString(), "fails", consecutiveFailures);

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
    consecutiveFailures = 0;
    console.log("cranked", hash, "status", receipt.status, "gasLimit", gas.toString());
  } catch (err) {
    const reason = decodeVesselError(err) || (err instanceof Error ? err.message : String(err));
    if (EXPECTED_SKIP.test(reason)) {
      consecutiveFailures = 0;
      console.log(new Date().toISOString(), "heartbeat", cycle, "skip revert:", reason);
    } else {
      consecutiveFailures += 1;
      console.log(new Date().toISOString(), "heartbeat", cycle, "fail", consecutiveFailures, reason);
      if (consecutiveFailures >= 3) {
        console.error("three consecutive crank failures — exiting so the supervisor restarts");
        process.exit(1);
      }
    }
  } finally {
    inflight = false;
  }
}

async function main() {
  await preflight();
  await tick();
  setInterval(() => {
    void tick();
  }, INTERVAL * 1000);
}

void main();
