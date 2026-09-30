import { createPublicClient, http, parseAbi, type Address, type PublicClient } from "viem";
import type { Snapshot } from "./checks.ts";

/**
 * Read everything the checks need at ONE block, pinned by number and hash.
 * Talks only to the RPC and the contracts named in the release manifest.
 */

const controllerAbi = parseAbi([
  "function hullNav() view returns (uint256)",
  "function ballastNav() view returns (uint256)",
  "function reserveNav() view returns (uint256)",
  "function treasuryLiability() view returns (uint256)",
  "function lastActive() view returns (uint256)",
  "function lifetimeAdmitted() view returns (uint256)",
  "function pendingReserved() view returns (uint256)",
  "function stageCap() view returns (uint256)",
  "function impaired() view returns (bool)",
  "function lossCarry() view returns (uint256)",
  "function epoch() view returns (uint256)",
  "function engine() view returns (address)",
]);
const custodyAbi = parseAbi(["function pending() view returns (uint256)", "function activeIdle() view returns (uint256)"]);
const escrowAbi = parseAbi(["function totalFunded() view returns (uint256)"]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const engineAbi = parseAbi([
  "function value() view returns (uint256, uint256)",
  "function isSimulated() view returns (bool)",
  "function book() view returns (uint256)",
  "function pot() view returns (uint256)",
  "function fundingRateBps() view returns (int256)",
]);

export interface Manifest {
  schemaVersion: number;
  environment: string;
  chainId: number;
  contracts: Record<string, Address>;
}

export function parseManifest(raw: unknown): Manifest {
  const m = raw as Manifest;
  if (m?.schemaVersion !== 1) throw new Error("manifest schemaVersion must be 1");
  for (const k of ["TrancheController", "AssetCustody", "ClaimEscrow", "BallastToken", "DemoUSD"]) {
    if (!m.contracts?.[k]) throw new Error(`manifest missing contracts.${k}`);
  }
  return m;
}

export function client(rpcUrl: string): PublicClient {
  return createPublicClient({ transport: http(rpcUrl) });
}

export async function readSnapshot(pc: PublicClient, m: Manifest, blockTag: "finalized" | "latest" = "finalized"): Promise<Snapshot> {
  const chainId = await pc.getChainId();
  if (chainId !== m.chainId) throw new Error(`RPC is chain ${chainId}, manifest says ${m.chainId}`);
  const block = await pc.getBlock({ blockTag });
  const at = { blockNumber: block.number! };
  const C = m.contracts.TrancheController!;
  const code = await pc.getCode({ address: C, ...at });
  if (!code || code === "0x") {
    throw new Error(
      `TrancheController ${C} has no code at ${blockTag} block ${block.number} — the deployment is not ${blockTag === "finalized" ? "finalized yet (retry later or pass --latest)" : "on this chain"}`,
    );
  }
  const asset = m.contracts.DemoUSD!;
  const rc = <T>(fn: string) =>
    pc.readContract({ address: C, abi: controllerAbi, functionName: fn as never, ...at }) as Promise<T>;

  const [hullNav, ballastNav, reserveNav, treasuryLiability, lastActive, lifetimeAdmitted, pendingReserved, stageCap, impaired, lossCarry, epoch, engineAddr] =
    await Promise.all([
      rc<bigint>("hullNav"), rc<bigint>("ballastNav"), rc<bigint>("reserveNav"), rc<bigint>("treasuryLiability"),
      rc<bigint>("lastActive"), rc<bigint>("lifetimeAdmitted"), rc<bigint>("pendingReserved"), rc<bigint>("stageCap"),
      rc<boolean>("impaired"), rc<bigint>("lossCarry"), rc<bigint>("epoch"), rc<Address>("engine"),
    ]);
  const bal = (who: Address) => pc.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [who], ...at });
  const [pending, activeIdle, custodyBal, totalFunded, escrowBal, symbol, decimals, ballastSupply] = await Promise.all([
    pc.readContract({ address: m.contracts.AssetCustody!, abi: custodyAbi, functionName: "pending", ...at }),
    pc.readContract({ address: m.contracts.AssetCustody!, abi: custodyAbi, functionName: "activeIdle", ...at }),
    bal(m.contracts.AssetCustody!),
    pc.readContract({ address: m.contracts.ClaimEscrow!, abi: escrowAbi, functionName: "totalFunded", ...at }),
    bal(m.contracts.ClaimEscrow!),
    pc.readContract({ address: asset, abi: erc20Abi, functionName: "symbol", ...at }),
    pc.readContract({ address: asset, abi: erc20Abi, functionName: "decimals", ...at }),
    pc.readContract({ address: m.contracts.BallastToken!, abi: erc20Abi, functionName: "totalSupply", ...at }),
  ]);

  let engine: Snapshot["engine"] = { present: false };
  if (engineAddr !== "0x0000000000000000000000000000000000000000") {
    const [value, observedAt] = await pc.readContract({ address: engineAddr, abi: engineAbi, functionName: "value", ...at });
    const simulated = await pc
      .readContract({ address: engineAddr, abi: engineAbi, functionName: "isSimulated", ...at })
      .catch(() => false);
    engine = { present: true, simulated, value, observedAt };
    if (simulated) {
      const [book, pot, rate] = await Promise.all([
        pc.readContract({ address: engineAddr, abi: engineAbi, functionName: "book", ...at }),
        pc.readContract({ address: engineAddr, abi: engineAbi, functionName: "pot", ...at }),
        pc.readContract({ address: engineAddr, abi: engineAbi, functionName: "fundingRateBps", ...at }),
      ]);
      engine = { ...engine, book, pot, fundingRateBps: rate };
    }
  }

  return {
    chainId,
    blockNumber: block.number!,
    blockHash: block.hash!,
    blockTimestamp: block.timestamp,
    asset: { symbol, decimals },
    controller: { hullNav, ballastNav, reserveNav, treasuryLiability, lastActive, lifetimeAdmitted, pendingReserved, stageCap, impaired, lossCarry, epoch },
    custody: { pending, activeIdle, tokenBalance: custodyBal },
    escrow: { totalFunded, tokenBalance: escrowBal },
    engine,
    ballastSupply,
  };
}
