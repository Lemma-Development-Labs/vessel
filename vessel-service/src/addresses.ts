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

/** Bounded integer env parse. Falls back to `def` on missing/garbage input. */
function envInt(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`invalid ${name}: ${raw} (want integer in [${min}, ${max}])`);
  }
  return n;
}

/**
 * Blocks behind head treated as final. The indexer never advances its persisted
 * cursor past (head - CONFIRMATIONS), and re-indexes that trailing window every
 * pass so a reorged-out row is overwritten.
 */
export function getConfirmations(): number {
  return envInt("CONFIRMATIONS", 12, 0, 10_000);
}

/**
 * eth_getLogs window in blocks. The public Monad testnet RPC answers anything
 * wider than 100 blocks with "eth_getLogs is limited to a 100 range", so 100 is
 * the default. The indexer shrinks this on its own if the RPC rejects a range.
 */
export function getIndexerChunkBlocks(): number {
  return envInt("INDEXER_CHUNK_BLOCKS", 100, 1, 100_000);
}

/** Milliseconds between indexer passes. Monad blocks are sub-second. */
export function getIndexerPollMs(): number {
  return envInt("INDEXER_POLL_MS", 2_000, 100, 600_000);
}

/**
 * Minimum number of cranks the keeper's MON balance must still cover, priced at
 * the gas LIMIT (Monad charges the limit, not the used gas). Below this the
 * keeper refuses to start and warns every cycle.
 */
export function getMinCranksRunway(): number {
  return envInt("MIN_CRANKS_RUNWAY", 50, 0, 1_000_000);
}

/** Ceiling on the fee we will pay per gas, in gwei. Caps replacement bumps. */
export function getMaxGasPriceGwei(): number {
  return envInt("MAX_GAS_PRICE_GWEI", 500, 1, 1_000_000);
}

/** /health goes degraded after this many crank intervals with no crank. */
export function getMaxCrankIntervals(): number {
  return envInt("HEALTH_MAX_CRANK_INTERVALS", 3, 1, 1_000);
}

/** /health goes degraded when (safe head - persisted cursor) exceeds this. */
export function getMaxIndexerLagBlocks(): number {
  return envInt("HEALTH_MAX_INDEXER_LAG_BLOCKS", 1_000, 1, 100_000_000);
}

/** Requests per window per IP on /stats and /waterfall. */
export function getRateLimitMax(): number {
  return envInt("RATE_LIMIT_MAX", 60, 1, 1_000_000);
}

export function getRateLimitWindowSec(): number {
  return envInt("RATE_LIMIT_WINDOW_SEC", 60, 1, 86_400);
}

const DEFAULT_ORIGINS = [
  "https://vessel.wtf",
  "https://www.vessel.wtf",
  "https://testnet.vessel.wtf",
  "https://docs.vessel.wtf",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

/**
 * Exact-match CORS allowlist. ALLOWED_ORIGINS (comma-separated) replaces the
 * defaults entirely; unset keeps the vessel.wtf domains + localhost. There is
 * deliberately no wildcard — the previous /^https:\/\/([a-z0-9-]+\.)*vercel\.app$/
 * admitted every Vercel deployment on the internet.
 */
export function getAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (!raw) return [...DEFAULT_ORIGINS];
  const list = raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (list.length === 0) return [...DEFAULT_ORIGINS];
  for (const o of list) {
    if (o === "*") throw new Error("ALLOWED_ORIGINS must not contain '*'");
  }
  return list;
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
