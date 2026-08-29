/**
 * End-to-end proof against ADDRESSES.json.
 *
 * Env:
 *   RPC_URL          (required)
 *   E2E_PK           burner key funded with native (Anvil account 2 by default)
 *   DEPLOYER_PK      venue owner — SetRate step (Anvil account 0 by default)
 *   E2E_WAIT_MS      wall-clock wait between cranks (testnet). Ignored on Anvil
 *                    where we use evm_increaseTime(60) so the run is scriptable.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { defineChain } from "viem";
import { GAS } from "../app/lib/gas.ts";
import demoAbi from "../app/lib/abis/DemoUSD.json" with { type: "json" };
import engineAbi from "../app/lib/abis/EngineLite.json" with { type: "json" };
import tranchesAbi from "../app/lib/abis/Tranches.json" with { type: "json" };
import simAbi from "../app/lib/abis/SimVenue.json" with { type: "json" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const addresses = JSON.parse(readFileSync(join(root, "ADDRESSES.json"), "utf8")) as {
  chainId: number;
  deployedBlock: number;
  contracts: Record<string, Address>;
};

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const E2E_PK = (process.env.E2E_PK ??
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a") as Hex;
const DEPLOYER_PK = (process.env.DEPLOYER_PK ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;
const WAIT_MS = Number(process.env.E2E_WAIT_MS ?? 60_000);

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function totalSupply() view returns (uint256)",
]);

type Row = { step: string; expected: string; actual: string; tx: string; ok: boolean };
const rows: Row[] = [];

function record(step: string, expected: string, actual: string, tx: string, ok: boolean) {
  rows.push({ step, expected, actual, tx, ok });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${step.padEnd(42)}  expected=${expected}  actual=${actual}  tx=${tx}`);
  if (!ok) {
    printTable();
    process.exit(1);
  }
}

function printTable() {
  console.log("\n=== VESSEL E2E PASS TABLE ===");
  console.log(
    "step".padEnd(42),
    "expected".padEnd(28),
    "actual".padEnd(28),
    "tx",
  );
  for (const r of rows) {
    console.log(
      `${r.ok ? "ok" : "XX"} ${r.step.padEnd(40)} ${r.expected.padEnd(28)} ${r.actual.padEnd(28)} ${r.tx}`,
    );
  }
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

async function main() {
  const chainId = addresses.chainId;
  const C = addresses.contracts;
  const chain =
    chainId === 31337
      ? { ...foundry, rpcUrls: { default: { http: [RPC_URL] } } }
      : defineChain({
          id: chainId,
          name: chainId === 143 ? "Monad" : "Monad Testnet",
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          rpcUrls: { default: { http: [RPC_URL] } },
        });

  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const onChain = await publicClient.getChainId();
  if (onChain !== chainId) {
    throw new Error(`RPC chainId ${onChain} != ADDRESSES.json ${chainId}`);
  }

  for (const [name, addr] of Object.entries(C)) {
    const code = await publicClient.getCode({ address: addr });
    if (!code || code === "0x") {
      record(`preflight getCode ${name}`, "non-empty", "0x", "—", false);
    }
  }
  record("preflight getCode all ADDRESSES", "non-empty", `${Object.keys(C).length} contracts`, "—", true);

  const burner = privateKeyToAccount(E2E_PK);
  const deployer = privateKeyToAccount(DEPLOYER_PK);
  if (burner.address.toLowerCase() === deployer.address.toLowerCase()) {
    throw new Error("E2E_PK must differ from DEPLOYER_PK");
  }
  const wallet = createWalletClient({ account: burner, chain, transport: http(RPC_URL) });
  const owner = createWalletClient({ account: deployer, chain, transport: http(RPC_URL) });

  async function waitDt() {
    if (chainId === 31337) {
      await publicClient.request({ method: "evm_increaseTime" as never, params: [60] as never });
      await publicClient.request({ method: "evm_mine" as never, params: [] as never });
    } else {
      await new Promise((r) => setTimeout(r, WAIT_MS));
    }
  }

  // 1. faucet
  const dusdBefore = (await publicClient.readContract({
    address: C.DemoUSD,
    abi: demoAbi,
    functionName: "balanceOf",
    args: [burner.address],
  })) as bigint;
  const faucetHash = await wallet.writeContract({
    address: C.DemoUSD,
    abi: demoAbi,
    functionName: "faucet",
    gas: GAS.faucet,
  });
  await publicClient.waitForTransactionReceipt({ hash: faucetHash });
  const dusdAfter = (await publicClient.readContract({
    address: C.DemoUSD,
    abi: demoAbi,
    functionName: "balanceOf",
    args: [burner.address],
  })) as bigint;
  record("1 faucet +100 dUSD", (dusdBefore + 100_000000n).toString(), dusdAfter.toString(), faucetHash, dusdAfter === dusdBefore + 100_000000n);

  // 2. joinBallast 60 / joinHull 40
  const approveHash = await wallet.writeContract({
    address: C.DemoUSD,
    abi: demoAbi,
    functionName: "approve",
    args: [C.Tranches, 100_000000n],
    gas: GAS.approve,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const joinB = await wallet.writeContract({
    address: C.Tranches,
    abi: tranchesAbi,
    functionName: "joinBallast",
    args: [60_000000n],
    gas: GAS.join,
  });
  await publicClient.waitForTransactionReceipt({ hash: joinB });
  const joinH = await wallet.writeContract({
    address: C.Tranches,
    abi: tranchesAbi,
    functionName: "joinHull",
    args: [40_000000n],
    gas: GAS.join,
  });
  await publicClient.waitForTransactionReceipt({ hash: joinH });

  const balTok = (await publicClient.readContract({
    address: C.Ballast,
    abi: erc20,
    functionName: "balanceOf",
    args: [burner.address],
  })) as bigint;
  const hullTok = (await publicClient.readContract({
    address: C.Hull,
    abi: erc20,
    functionName: "balanceOf",
    args: [burner.address],
  })) as bigint;
  record("2a joinBallast 60 shares > 0", ">0", balTok.toString(), joinB, balTok > 0n);
  record("2b joinHull 40 shares > 0", ">0", hullTok.toString(), joinH, hullTok > 0n);

  const deck = (await publicClient.readContract({
    address: C.Tranches,
    abi: tranchesAbi,
    functionName: "deckStats",
  })) as readonly bigint[];
  const theta = deck[7];
  record("2c subordination ≥ 20%", ">= 2000 bps", theta.toString(), joinH, theta >= 2000n);

  // 3. deployLiquidity
  let shortId = (await publicClient.readContract({
    address: C.EngineLite,
    abi: engineAbi,
    functionName: "shortId",
  })) as bigint;
  let deployTx = "—";
  if (shortId === 0n) {
    deployTx = await wallet.writeContract({
      address: C.EngineLite,
      abi: engineAbi,
      functionName: "deployLiquidity",
      gas: GAS.deployLiquidity,
    });
    await publicClient.waitForTransactionReceipt({ hash: deployTx as Hex });
    shortId = (await publicClient.readContract({
      address: C.EngineLite,
      abi: engineAbi,
      functionName: "shortId",
    })) as bigint;
  }
  const wmon = (await publicClient.readContract({
    address: C.MockWMON,
    abi: erc20,
    functionName: "balanceOf",
    args: [C.EngineLite],
  })) as bigint;
  const pos = (await publicClient.readContract({
    address: C.SimVenue,
    abi: simAbi,
    functionName: "position",
    args: [shortId],
  })) as readonly [bigint, bigint];
  const netBps = (await publicClient.readContract({
    address: C.EngineLite,
    abi: engineAbi,
    functionName: "netDeltaBps",
  })) as bigint;
  record("3a spot WMON > 0", ">0", wmon.toString(), deployTx, wmon > 0n);
  record("3b shortNotional > 0", ">0", pos[0].toString(), deployTx, pos[0] > 0n);
  record("3c |netDeltaBps| ≤ 100", "<= 100", netBps.toString(), deployTx, abs(netBps) <= 100n);

  // 4. wait → crank → conservation from Waterfall
  await waitDt();
  const crank1 = await wallet.writeContract({
    address: C.EngineLite,
    abi: engineAbi,
    functionName: "crank",
    gas: GAS.crank,
  });
  const rec1 = await publicClient.waitForTransactionReceipt({ hash: crank1 });
  const ev1 = parseWaterfall(rec1.logs, C.Tranches);
  const cons1 = conservation(ev1);
  record(
    "4 conservation identity (wei)",
    ev1.gross.toString(),
    cons1.toString(),
    crank1,
    cons1 === ev1.gross,
  );

  const hullAfterPos = (await publicClient.readContract({
    address: C.Tranches,
    abi: tranchesAbi,
    functionName: "hullTvl",
  })) as bigint;
  const balAfterPos = (await publicClient.readContract({
    address: C.Tranches,
    abi: tranchesAbi,
    functionName: "balTvl",
  })) as bigint;

  // 5. negative rate → crank → ballast down, hull unchanged
  const rateTx = await owner.writeContract({
    address: C.SimVenue,
    abi: simAbi,
    functionName: "setFundingRateBps",
    args: [-2400n],
    gas: 80_000n,
  });
  await publicClient.waitForTransactionReceipt({ hash: rateTx });
  await waitDt();
  const crank2 = await wallet.writeContract({
    address: C.EngineLite,
    abi: engineAbi,
    functionName: "crank",
    gas: GAS.crank,
  });
  const rec2 = await publicClient.waitForTransactionReceipt({ hash: crank2 });
  const ev2 = parseWaterfall(rec2.logs, C.Tranches);
  const hullAfterNeg = (await publicClient.readContract({
    address: C.Tranches,
    abi: tranchesAbi,
    functionName: "hullTvl",
  })) as bigint;
  const balAfterNeg = (await publicClient.readContract({
    address: C.Tranches,
    abi: tranchesAbi,
    functionName: "balTvl",
  })) as bigint;
  record("5a hull NAV unchanged", hullAfterPos.toString(), hullAfterNeg.toString(), crank2, hullAfterNeg === hullAfterPos);
  record(
    "5b ballast NAV − shortfall",
    (balAfterPos - ev2.fromBallast).toString(),
    balAfterNeg.toString(),
    crank2,
    balAfterNeg === balAfterPos - ev2.fromBallast && ev2.gross < 0n,
  );

  // 6. exitBallast partial → floor; exitHull full
  const balSharesNow = (await publicClient.readContract({
    address: C.Ballast,
    abi: erc20,
    functionName: "balanceOf",
    args: [burner.address],
  })) as bigint;
  const exitB = await wallet.writeContract({
    address: C.Tranches,
    abi: tranchesAbi,
    functionName: "exitBallast",
    args: [balSharesNow / 10n],
    gas: GAS.exit,
  });
  const recExitB = await publicClient.waitForTransactionReceipt({ hash: exitB });
  if (recExitB.status !== "success") throw new Error("exitBallast reverted");
  const deck2 = (await publicClient.readContract({
    address: C.Tranches,
    abi: tranchesAbi,
    functionName: "deckStats",
  })) as readonly bigint[];
  record("6a floor after partial ballast exit", ">= 2000 bps", deck2[7].toString(), exitB, deck2[7] >= 2000n);

  // Full Hull exit needs vault idle. After deployLiquidity 90% is away — unwind first
  // so cash is in the vault (documented idle-buffer / unwind path).
  const unwindTx = await wallet.writeContract({
    address: C.EngineLite,
    abi: engineAbi,
    functionName: "unwind",
    gas: GAS.deployLiquidity,
  });
  const recUnw = await publicClient.waitForTransactionReceipt({ hash: unwindTx });
  record("6a2 unwind for idle cash", "success", recUnw.status, unwindTx, recUnw.status === "success");

  const hullSharesNow = (await publicClient.readContract({
    address: C.Hull,
    abi: erc20,
    functionName: "balanceOf",
    args: [burner.address],
  })) as bigint;
  const dusdPreExit = (await publicClient.readContract({
    address: C.DemoUSD,
    abi: demoAbi,
    functionName: "balanceOf",
    args: [burner.address],
  })) as bigint;
  const hullNav = (await publicClient.readContract({
    address: C.Tranches,
    abi: tranchesAbi,
    functionName: "hullTvl",
  })) as bigint;
  const hullSupply = (await publicClient.readContract({
    address: C.Hull,
    abi: erc20,
    functionName: "totalSupply",
  })) as bigint;
  const expectedPayout = (hullSharesNow * hullNav) / hullSupply;
  const exitH = await wallet.writeContract({
    address: C.Tranches,
    abi: tranchesAbi,
    functionName: "exitHull",
    args: [hullSharesNow],
    gas: GAS.exit,
  });
  const recExitH = await publicClient.waitForTransactionReceipt({ hash: exitH });
  if (recExitH.status !== "success") {
    record("6b exitHull status", "success", recExitH.status, exitH, false);
  }
  const dusdPostExit = (await publicClient.readContract({
    address: C.DemoUSD,
    abi: demoAbi,
    functionName: "balanceOf",
    args: [burner.address],
  })) as bigint;
  const payout = dusdPostExit - dusdPreExit;
  const expectedNav = 40_000000n + ev1.hullAccrual;
  record(
    "6b exitHull payout = principal + accrued",
    expectedNav.toString(),
    payout.toString(),
    exitH,
    payout === expectedPayout && payout === expectedNav,
  );

  printTable();
  mkdirSync(join(root, "docs"), { recursive: true });
  const md = [
    "# e2e last run",
    "",
    `chainId: ${chainId}`,
    `burner: ${burner.address}`,
    `wait: ${chainId === 31337 ? "evm_increaseTime(60)" : `${WAIT_MS}ms wall clock`}`,
    "",
    "| step | expected | actual | tx |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.ok ? "PASS" : "FAIL"} ${r.step} | ${r.expected} | ${r.actual} | \`${r.tx}\` |`),
    "",
  ].join("\n");
  writeFileSync(join(root, "docs/e2e-last-run.md"), md);
  console.log("wrote docs/e2e-last-run.md");
}

type Waterfall = {
  gross: bigint;
  fee: bigint;
  toReserve: bigint;
  toTreasury: bigint;
  hullAccrual: bigint;
  toBallast: bigint;
  fromBallast: bigint;
  fromReserve: bigint;
};

function conservation(e: Waterfall): bigint {
  return e.hullAccrual + e.toBallast + e.toReserve + e.toTreasury - e.fromBallast - e.fromReserve;
}

function parseWaterfall(
  logs: { address: Address; data: Hex; topics: Hex[] }[],
  tranches: Address,
): Waterfall {
  for (const log of logs) {
    if (log.address.toLowerCase() !== tranches.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: tranchesAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "Waterfall") continue;
      const a = decoded.args as unknown as Waterfall;
      return a;
    } catch {
      /* next */
    }
  }
  throw new Error("Waterfall event not found");
}

main().catch((err) => {
  console.error(err);
  printTable();
  process.exit(1);
});
