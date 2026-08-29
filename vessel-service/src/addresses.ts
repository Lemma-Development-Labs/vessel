import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineChain, type Address, type Chain, type Hex } from "viem";
import { foundry } from "viem/chains";

export type VenueMode = "sim" | "perpl";

export type VesselAddresses = {
  chainId: number;
  deployedBlock: bigint;
  venue: VenueMode;
  contracts: {
    EngineLite: Address;
    Tranches: Address;
    SimVenue?: Address;
    PerplVenue?: Address;
  };
};

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function asVenue(value: unknown): VenueMode {
  return value === "perpl" ? "perpl" : "sim";
}

function parseAddresses(raw: string, source: string): VesselAddresses {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(`invalid JSON from ${source}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`${source} must be an object`);
  }
  const obj = parsed as Record<string, unknown>;
  const contractsRaw = obj.contracts;
  if (!contractsRaw || typeof contractsRaw !== "object") {
    throw new Error(`${source} missing contracts`);
  }
  const contracts = contractsRaw as Record<string, unknown>;
  if (!isAddress(contracts.EngineLite)) {
    throw new Error(`${source} missing contracts.EngineLite`);
  }
  if (!isAddress(contracts.Tranches)) {
    throw new Error(`${source} missing contracts.Tranches`);
  }

  const deployed =
    typeof obj.deployedBlock === "number" || typeof obj.deployedBlock === "string"
      ? BigInt(obj.deployedBlock)
      : 0n;

  const out: VesselAddresses = {
    chainId: typeof obj.chainId === "number" ? obj.chainId : getChainId(),
    deployedBlock: deployed < 0n ? 0n : deployed,
    venue: asVenue(obj.venue),
    contracts: {
      EngineLite: contracts.EngineLite,
      Tranches: contracts.Tranches,
    },
  };
  if (isAddress(contracts.SimVenue)) out.contracts.SimVenue = contracts.SimVenue;
  if (isAddress(contracts.PerplVenue)) out.contracts.PerplVenue = contracts.PerplVenue;
  return out;
}

/** CHAIN_ID env, default Monad testnet. */
export function getChainId(): number {
  const raw = process.env.CHAIN_ID;
  if (raw === undefined || raw === "") return 10143;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`invalid CHAIN_ID: ${raw}`);
  }
  return id;
}

export function getRpcUrl(): string {
  const url = process.env.RPC_URL;
  if (!url) throw new Error("RPC_URL is required");
  return url;
}

export function getCrankIntervalSec(): number {
  const n = Number(process.env.CRANK_INTERVAL_SEC ?? 300);
  if (!Number.isFinite(n) || n < 1) return 300;
  return n;
}

export function getPort(): number {
  const n = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`invalid PORT: ${process.env.PORT ?? ""}`);
  }
  return n;
}

export function getKeeperPk(): Hex | undefined {
  const pk = process.env.KEEPER_PK;
  if (!pk) return undefined;
  if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) {
    throw new Error("KEEPER_PK must be 0x + 64 hex chars");
  }
  return pk as Hex;
}

/**
 * ADDRESSES_JSON env (full ADDRESSES.json blob) or ../ADDRESSES.json
 * relative to process.cwd() (vessel-service/ → repo root).
 */
export function loadAddresses(): VesselAddresses {
  const blob = process.env.ADDRESSES_JSON?.trim();
  if (blob) return parseAddresses(blob, "ADDRESSES_JSON");

  const file = resolve(process.cwd(), "..", "ADDRESSES.json");
  if (!existsSync(file)) {
    throw new Error(
      `ADDRESSES.json not found at ${file} and ADDRESSES_JSON is unset`,
    );
  }
  return parseAddresses(readFileSync(file, "utf8"), file);
}

export function vesselChain(rpcUrl: string, chainId: number): Chain {
  if (chainId === 31337) {
    return { ...foundry, rpcUrls: { default: { http: [rpcUrl] } } };
  }
  return defineChain({
    id: chainId,
    name: chainId === 143 ? "Monad" : "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export function venueAddresses(addrs: VesselAddresses): Address[] {
  const out: Address[] = [];
  if (addrs.contracts.SimVenue) out.push(addrs.contracts.SimVenue);
  if (addrs.contracts.PerplVenue) out.push(addrs.contracts.PerplVenue);
  return out;
}
