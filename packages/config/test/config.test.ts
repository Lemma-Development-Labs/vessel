import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Environment as DomainEnvironment } from "../../domain/src/evidence.js";
import {
  type Environment,
  ConfigError,
  ENVIRONMENTS,
  MANIFEST_SCHEMA_VERSION,
  assertRpcChainIds,
  isPlaceholderAddress,
  loadRuntimeConfig,
  parseManifest,
} from "../src/index.js";

const A = "0x7Df78EA918FA4531a74b79CE0a53a6D94B72E373"; // real testnet Tranches
const B = "0x60eC904955CA843285B24E3F6e7e2034F8f96140"; // real testnet EngineLite

const mainnetManifest = (over: Record<string, unknown> = {}) => ({
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  environment: "mainnet",
  chainId: 143,
  venue: "live",
  contracts: { TrancheController: A, AssetCustody: B },
  ...over,
});

const mainnetEnv = (over: Record<string, string> = {}) => ({
  VESSEL_ENV: "mainnet",
  VESSEL_CHAIN_ID: "143",
  VESSEL_RPC_URLS: "https://rpc-a.example,https://rpc-b.example",
  ...over,
});

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigError) return e.code;
    throw e;
  }
  return "OK";
}

describe("runtime config guards", () => {
  it("accepts a clean mainnet config with admission disabled", () => {
    const cfg = loadRuntimeConfig(mainnetEnv(), mainnetManifest());
    expect(cfg.environment).toBe("mainnet");
    expect(cfg.admissionEnabled).toBe(false);
  });

  it("env_rejects_mainnet_mock_provider", () => {
    expect(code(() => loadRuntimeConfig(mainnetEnv({ VESSEL_VENUE_PROVIDER: "sim" }), mainnetManifest()))).toBe("MOCK_ON_MAINNET");
    expect(code(() => loadRuntimeConfig(mainnetEnv({ NEXT_PUBLIC_USE_MOCK: "1" }), mainnetManifest()))).toBe("MOCK_ON_MAINNET");
    expect(code(() => loadRuntimeConfig(mainnetEnv({ VESSEL_USE_MOCK: "true" }), mainnetManifest()))).toBe("MOCK_ON_MAINNET");
    expect(code(() => loadRuntimeConfig(mainnetEnv(), mainnetManifest({ venue: "sim" })))).toBe("MOCK_ON_MAINNET");
    expect(code(() => loadRuntimeConfig(mainnetEnv(), mainnetManifest({ contracts: { SimVenue: A } })))).toBe("MOCK_ON_MAINNET");
    expect(code(() => loadRuntimeConfig(mainnetEnv(), mainnetManifest({ contracts: { MockRouter: A } })))).toBe("MOCK_ON_MAINNET");
    expect(code(() => loadRuntimeConfig(mainnetEnv(), mainnetManifest({ contracts: { DemoUSD: A } })))).toBe("MOCK_ON_MAINNET");
  });

  it("env_rejects_placeholder_address", () => {
    const zero = "0x0000000000000000000000000000000000000000";
    for (const addr of [
      zero,
      "0x1111111111111111111111111111111111111111",
      "0x0000000000000000000000000000000000000001",
      "0x000000000000000000000000000000000000dEaD",
      "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    ]) {
      expect(code(() => parseManifest(mainnetManifest({ contracts: { AssetCustody: addr } }), "mainnet")), addr).toBe(
        "PLACEHOLDER_ADDRESS",
      );
    }
    for (const bad of ["0x…", "<pending>", "0x7Df7", "", 42]) {
      expect(code(() => parseManifest(mainnetManifest({ contracts: { AssetCustody: bad } }), "mainnet"))).toBe("BAD_ADDRESS");
    }
    expect(isPlaceholderAddress(A)).toBe(false);
  });

  it("env_rejects_lab_address_on_mainnet", () => {
    expect(code(() => parseManifest(mainnetManifest({ contracts: { vUSD: A } }), "mainnet"))).toBe("LAB_ON_MAINNET");
    expect(code(() => parseManifest(mainnetManifest({ contracts: { svUSD: A } }), "mainnet"))).toBe("LAB_ON_MAINNET");
    expect(code(() => parseManifest(mainnetManifest({ lab: { DollarBook: A } }), "mainnet"))).toBe("LAB_ON_MAINNET");
    // A known testnet-only asset copied into a mainnet manifest under a neutral name.
    expect(
      code(() =>
        parseManifest(mainnetManifest({ contracts: { Collateral: "0xa9012a055bd4e0edff8ce09f960291c09d5322dc" } }), "mainnet"),
      ),
    ).toBe("LAB_ON_MAINNET");
    expect(code(() => parseManifest(mainnetManifest({ perplMarketId: 64 }), "mainnet"))).toBe("LAB_ON_MAINNET");
    // The same lab names are fine on testnet (the lab lives there).
    expect(code(() => parseManifest({ chainId: 10143, venue: "sim", contracts: { vUSD: A } }, "testnet"))).toBe("OK");
  });

  it("requires an explicit environment and the matching chain", () => {
    expect(code(() => loadRuntimeConfig({}, mainnetManifest()))).toBe("MISSING_ENV");
    expect(code(() => loadRuntimeConfig({ VESSEL_ENV: "prod" }, mainnetManifest()))).toBe("BAD_ENV");
    expect(code(() => loadRuntimeConfig(mainnetEnv({ VESSEL_CHAIN_ID: "10143" }), mainnetManifest()))).toBe("WRONG_CHAIN");
    expect(code(() => loadRuntimeConfig(mainnetEnv(), mainnetManifest({ chainId: 10143 })))).toBe("WRONG_CHAIN");
    expect(code(() => parseManifest({ chainId: 143, venue: "live", contracts: { X: A } }, "testnet"))).toBe("WRONG_CHAIN");
  });

  it("rejects schema-version mismatch and legacy manifests on mainnet", () => {
    expect(code(() => parseManifest(mainnetManifest({ schemaVersion: 2 }), "mainnet"))).toBe("SCHEMA_VERSION");
    const { schemaVersion: _drop, ...legacy } = mainnetManifest();
    expect(code(() => parseManifest(legacy, "mainnet"))).toBe("SCHEMA_VERSION");
  });

  it("keeps mainnet admission disabled and demands two RPCs", () => {
    expect(code(() => loadRuntimeConfig(mainnetEnv({ VESSEL_ADMISSION_ENABLED: "1" }), mainnetManifest()))).toBe(
      "ADMISSION_ON_MAINNET",
    );
    expect(code(() => loadRuntimeConfig(mainnetEnv({ VESSEL_RPC_URLS: "https://rpc-a.example" }), mainnetManifest()))).toBe(
      "BAD_ENV",
    );
    expect(code(() => loadRuntimeConfig(mainnetEnv({ VESSEL_ADMISSION_ENABLED: "yes" }), mainnetManifest()))).toBe("BAD_ENV");
  });

  it("loads the committed testnet ADDRESSES.json as a legacy-v0 testnet manifest", () => {
    const raw = JSON.parse(readFileSync(new URL("../../../ADDRESSES.json", import.meta.url), "utf8")) as unknown;
    const cfg = loadRuntimeConfig(
      { VESSEL_ENV: "testnet", VESSEL_CHAIN_ID: "10143", VESSEL_RPC_URLS: "https://testnet-rpc.monad.xyz" },
      raw,
    );
    expect(cfg.manifest.schemaVersion).toBe("legacy-v0");
    expect(Object.keys(cfg.manifest.contracts)).toContain("Tranches");
    // …and the very same file is refused as mainnet.
    expect(code(() => parseManifest(raw, "mainnet"))).not.toBe("OK");
  });

  it("uses the same environment names as packages/domain", () => {
    // Compile-time, both directions: a name added on one side only fails typecheck.
    const toDomain: DomainEnvironment[] = [...ENVIRONMENTS];
    const fromDomain: Environment[] = ["local", "testnet", "mainnet"] satisfies DomainEnvironment[];
    expect(toDomain).toEqual(fromDomain);
  });
});

describe("assertRpcChainIds", () => {
  const rpc = (result: unknown, status = 200): typeof fetch =>
    (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status })) as unknown as typeof fetch;

  it("passes when every endpoint reports the expected chain", async () => {
    await expect(assertRpcChainIds(["https://a", "https://b"], 143, rpc("0x8f"))).resolves.toBeUndefined();
  });

  it("fails startup when an endpoint is on another chain", async () => {
    await expect(assertRpcChainIds(["https://a"], 143, rpc("0x279f"))).rejects.toMatchObject({ code: "WRONG_CHAIN" });
    await expect(assertRpcChainIds(["https://a"], 143, rpc(null))).rejects.toMatchObject({ code: "WRONG_CHAIN" });
    await expect(assertRpcChainIds(["https://a"], 143, rpc("0x8f", 502))).rejects.toMatchObject({ code: "WRONG_CHAIN" });
  });
});
