/**
 * Environment and release-manifest guards (spec §5, §18, §22; master prompt
 * Phase 1.4). Every runtime process validates its configuration with these
 * functions at startup and refuses to start on a failure — there is no
 * "warn and continue" path.
 *
 * Dependency-free on purpose: consumers that deploy standalone (app on
 * Vercel, vessel-service on Railway) receive a generated copy through
 * `scripts/sync-packages.mjs` (ARCHITECTURE decision 1), and CI fails if the
 * copy drifts.
 */

export const CONFIG_SCHEMA_VERSION = 1;
export const MANIFEST_SCHEMA_VERSION = 1;

export const ENVIRONMENTS = ["local", "testnet", "mainnet"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Chain each environment must run against. Verified by RPC at startup. */
export const EXPECTED_CHAIN_ID: Readonly<Record<Environment, number>> = {
  local: 31337,
  testnet: 10143,
  mainnet: 143,
};

export class ConfigError extends Error {
  override name = "ConfigError";
  constructor(
    readonly code:
      | "MISSING_ENV"
      | "BAD_ENV"
      | "WRONG_CHAIN"
      | "BAD_ADDRESS"
      | "PLACEHOLDER_ADDRESS"
      | "MOCK_ON_MAINNET"
      | "LAB_ON_MAINNET"
      | "SCHEMA_VERSION"
      | "BAD_MANIFEST"
      | "ADMISSION_ON_MAINNET",
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Low-entropy or conventional sentinel addresses that are never a real
 * deployment: zero, all-one-nibble (0x1111…), the burn address and the
 * native-token sentinel. A manifest containing one was filled in by hand.
 */
export function isPlaceholderAddress(address: string): boolean {
  const hex = address.slice(2).toLowerCase();
  if (new Set(hex).size <= 2) return true;
  if (hex === "000000000000000000000000000000000000dead") return true;
  if (hex === "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") return true;
  return false;
}

function checkAddress(name: string, value: unknown): string {
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
    throw new ConfigError("BAD_ADDRESS", `${name} is not a 20-byte hex address: ${JSON.stringify(value)}`);
  }
  if (isPlaceholderAddress(value)) {
    throw new ConfigError("PLACEHOLDER_ADDRESS", `${name} is a placeholder address (${value})`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Mainnet exclusions
// ---------------------------------------------------------------------------

/** Contract names that mean "simulated or mock" (never on mainnet). */
const MOCK_NAME_RE = /^(mock|sim|demo)/i;
/** Contract names that belong to the isolated vUSD/svUSD lab (D17). */
const LAB_NAME_RE = /^(vusd|svusd|dollarbook|lab)/i;

/**
 * Addresses known to be testnet-only or lab assets. A mainnet manifest that
 * contains one of these was copied from the wrong environment. Sources:
 * docs/FACT_CHECKS.md (testnet WMON, Perpl testnet exchange and collateral,
 * live testnet DemoUSD).
 */
export const TESTNET_ONLY_ADDRESSES: ReadonlySet<string> = new Set(
  [
    "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541", // WMON, Monad testnet
    "0x1964C32f0bE608E7D29302AFF5E61268E72080cc", // Perpl Exchange, testnet
    "0xa9012a055bd4e0edff8ce09f960291c09d5322dc", // Perpl testnet collateral (AUSD)
    "0x959E54DcF8576856F7A9424190a9751c68739495", // DemoUSD, live testnet deployment
  ].map((a) => a.toLowerCase()),
);

/** Perpl testnet MON market ID; never a mainnet default (gotcha 5). */
export const PERPL_TESTNET_MON_MARKET_ID = "64";

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface Manifest {
  schemaVersion: number | "legacy-v0";
  environment: Environment;
  chainId: number;
  contracts: Readonly<Record<string, string>>;
  venue: string;
  perplMarketId: string | null;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError("BAD_MANIFEST", `${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Validate a deployment manifest for `environment`.
 *
 * A manifest without `schemaVersion` is the v0 `ADDRESSES.json` shape; it is
 * accepted as "legacy-v0" for local and testnet only. Mainnet requires the
 * current schema version.
 */
export function parseManifest(raw: unknown, environment: Environment): Manifest {
  const obj = asRecord(raw, "manifest");

  let schemaVersion: Manifest["schemaVersion"];
  if (!("schemaVersion" in obj)) {
    if (environment === "mainnet") {
      throw new ConfigError("SCHEMA_VERSION", "mainnet manifest must declare schemaVersion");
    }
    schemaVersion = "legacy-v0";
  } else if (obj.schemaVersion === MANIFEST_SCHEMA_VERSION) {
    schemaVersion = MANIFEST_SCHEMA_VERSION;
  } else {
    throw new ConfigError(
      "SCHEMA_VERSION",
      `manifest schemaVersion ${JSON.stringify(obj.schemaVersion)} != ${MANIFEST_SCHEMA_VERSION}`,
    );
  }

  const expected = EXPECTED_CHAIN_ID[environment];
  if (obj.chainId !== expected) {
    throw new ConfigError(
      "WRONG_CHAIN",
      `manifest chainId ${JSON.stringify(obj.chainId)} does not match ${environment} (${expected})`,
    );
  }
  if ("environment" in obj && obj.environment !== environment) {
    throw new ConfigError(
      "BAD_MANIFEST",
      `manifest environment ${JSON.stringify(obj.environment)} loaded as ${environment}`,
    );
  }

  const contractsRaw = asRecord(obj.contracts, "manifest.contracts");
  if (Object.keys(contractsRaw).length === 0) {
    throw new ConfigError("BAD_MANIFEST", "manifest.contracts is empty");
  }
  const contracts: Record<string, string> = {};
  for (const [name, addr] of Object.entries(contractsRaw)) {
    contracts[name] = checkAddress(`contracts.${name}`, addr);
  }

  const venue = typeof obj.venue === "string" ? obj.venue : "";
  const perplMarketId =
    obj.perplMarketId === undefined || obj.perplMarketId === null ? null : String(obj.perplMarketId);

  if (environment === "mainnet") {
    const lab = obj.lab === undefined ? {} : asRecord(obj.lab, "manifest.lab");
    if (Object.keys(lab).length > 0) {
      throw new ConfigError("LAB_ON_MAINNET", "mainnet manifest declares lab contracts");
    }
    for (const [name, addr] of Object.entries(contracts)) {
      if (LAB_NAME_RE.test(name)) {
        throw new ConfigError("LAB_ON_MAINNET", `lab contract ${name} in mainnet manifest`);
      }
      if (MOCK_NAME_RE.test(name)) {
        throw new ConfigError("MOCK_ON_MAINNET", `mock/sim contract ${name} in mainnet manifest`);
      }
      if (TESTNET_ONLY_ADDRESSES.has(addr.toLowerCase())) {
        throw new ConfigError("LAB_ON_MAINNET", `contracts.${name} is a testnet/lab address (${addr})`);
      }
    }
    if (venue !== "live") {
      throw new ConfigError("MOCK_ON_MAINNET", `mainnet manifest venue must be "live", got ${JSON.stringify(venue)}`);
    }
    if (perplMarketId === PERPL_TESTNET_MON_MARKET_ID) {
      throw new ConfigError("LAB_ON_MAINNET", "Perpl market 64 is the testnet MON market");
    }
  }

  return { schemaVersion, environment, chainId: expected, contracts, venue, perplMarketId };
}

// ---------------------------------------------------------------------------
// Runtime environment
// ---------------------------------------------------------------------------

export interface RuntimeConfig {
  configSchemaVersion: typeof CONFIG_SCHEMA_VERSION;
  environment: Environment;
  chainId: number;
  rpcUrls: readonly string[];
  manifest: Manifest;
  /** Mainnet always starts false; enabling it is a gated release action. */
  admissionEnabled: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

const TRUE = new Set(["1", "true"]);
const FALSE = new Set(["", "0", "false"]);

function flag(env: Env, name: string): boolean {
  const v = (env[name] ?? "").trim().toLowerCase();
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  throw new ConfigError("BAD_ENV", `${name} must be 1/0/true/false, got ${JSON.stringify(env[name])}`);
}

/**
 * Validate process environment plus manifest. Throws ConfigError on the
 * first unsafe condition. Call once at startup before serving or signing.
 *
 * Recognised variables:
 *   VESSEL_ENV              local | testnet | mainnet (required, no default)
 *   VESSEL_CHAIN_ID         must equal the environment's chain
 *   VESSEL_RPC_URLS         comma-separated; ≥1 (mainnet: ≥2 independent)
 *   VESSEL_VENUE_PROVIDER   optional; "sim"/"mock" rejected on mainnet
 *   VESSEL_USE_MOCK, NEXT_PUBLIC_USE_MOCK  mock data providers; rejected on mainnet
 *   VESSEL_ADMISSION_ENABLED  must be false on mainnet at startup
 */
export function loadRuntimeConfig(env: Env, manifestRaw: unknown): RuntimeConfig {
  const rawEnv = env.VESSEL_ENV;
  if (rawEnv === undefined || rawEnv === "") {
    throw new ConfigError("MISSING_ENV", "VESSEL_ENV is required (local | testnet | mainnet)");
  }
  if (!(ENVIRONMENTS as readonly string[]).includes(rawEnv)) {
    throw new ConfigError("BAD_ENV", `VESSEL_ENV ${JSON.stringify(rawEnv)} is not local | testnet | mainnet`);
  }
  const environment = rawEnv as Environment;
  const expected = EXPECTED_CHAIN_ID[environment];

  const chainIdRaw = env.VESSEL_CHAIN_ID;
  if (chainIdRaw === undefined || !/^\d+$/.test(chainIdRaw)) {
    throw new ConfigError("MISSING_ENV", "VESSEL_CHAIN_ID is required as a decimal integer");
  }
  if (chainIdRaw !== String(expected)) {
    throw new ConfigError("WRONG_CHAIN", `VESSEL_CHAIN_ID ${chainIdRaw} does not match ${environment} (${expected})`);
  }

  const rpcUrls = (env.VESSEL_RPC_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u !== "");
  if (rpcUrls.length === 0) {
    throw new ConfigError("MISSING_ENV", "VESSEL_RPC_URLS needs at least one RPC endpoint");
  }
  for (const u of rpcUrls) {
    if (!/^https?:\/\//.test(u)) {
      throw new ConfigError("BAD_ENV", `RPC URL is not http(s): ${JSON.stringify(u)}`);
    }
  }
  if (environment === "mainnet" && new Set(rpcUrls).size < 2) {
    throw new ConfigError("BAD_ENV", "mainnet requires two independent RPC endpoints (spec §22)");
  }

  if (environment === "mainnet") {
    const provider = (env.VESSEL_VENUE_PROVIDER ?? "").toLowerCase();
    if (provider === "sim" || provider === "mock") {
      throw new ConfigError("MOCK_ON_MAINNET", `VESSEL_VENUE_PROVIDER=${provider} is not allowed on mainnet`);
    }
    for (const name of ["VESSEL_USE_MOCK", "NEXT_PUBLIC_USE_MOCK"]) {
      if (flag(env, name)) {
        throw new ConfigError("MOCK_ON_MAINNET", `${name} is set on mainnet`);
      }
    }
  }

  const admissionEnabled = flag(env, "VESSEL_ADMISSION_ENABLED");
  if (environment === "mainnet" && admissionEnabled) {
    throw new ConfigError(
      "ADMISSION_ON_MAINNET",
      "mainnet starts with admission disabled; enabling it is a gated release action",
    );
  }

  const manifest = parseManifest(manifestRaw, environment);

  return {
    configSchemaVersion: CONFIG_SCHEMA_VERSION,
    environment,
    chainId: expected,
    rpcUrls,
    manifest,
    admissionEnabled,
  };
}

/**
 * Ask each RPC for its chain ID and refuse to start if any disagrees with
 * the configured environment. A disagreement is never averaged away.
 */
export async function assertRpcChainIds(
  rpcUrls: readonly string[],
  expected: number,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  for (const url of rpcUrls) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    if (!res.ok) {
      throw new ConfigError("WRONG_CHAIN", `${url} eth_chainId HTTP ${res.status}`);
    }
    const body = (await res.json()) as { result?: unknown };
    if (typeof body.result !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.result)) {
      throw new ConfigError("WRONG_CHAIN", `${url} returned no chain ID`);
    }
    const got = BigInt(body.result);
    if (got !== BigInt(expected)) {
      throw new ConfigError("WRONG_CHAIN", `${url} is chain ${got.toString()}, expected ${expected}`);
    }
  }
}
