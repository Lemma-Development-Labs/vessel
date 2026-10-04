import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { decodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { buildServer, type Reader } from "../src/tools.ts";
import { TESTNET_V2, parseManifest, type Envelope } from "../src/vendor/sdk/index.ts";

const m = parseManifest(TESTNET_V2);
const NOW = 1_800_000_000;
const env = <T,>(data: T): Envelope<T> => ({
  schemaVersion: 1, environment: "testnet", chainId: 10143, blockNumber: "100", blockHash: "0xabc",
  observedAt: "2027-01-15T08:00:00.000Z", source: "fake", units: "dUSD:6", status: "LIVE", data,
});

const reader: Reader = {
  manifest: m,
  bookState: async () => env({ hullNav: "800" }) as never,
  ballastState: async () => env({ nav: "200" }) as never,
  reserveState: async () => env({ nav: "20" }) as never,
  capacity: async () => env({ remaining: "5" }) as never,
  engineState: async () => env({ wired: false }) as never,
  riskState: async () => env({ impaired: false }) as never,
  verifyBook: async () => env({ overall: "PASS", checks: [] }) as never,
  hullSeries: async (id?: bigint) => env(id === 9n ? [] : [{ id: "1", rateBps: "800" }]) as never,
  hedgeState: async () => env({}) as never,
};

async function connect(opts: { enablePrepare?: boolean; apiUrl?: string; fetchFn?: typeof fetch } = {}) {
  const server = buildServer({ reader, now: () => NOW, ...opts });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const body = (r: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((r.content as { text: string }[])[0]!.text);

describe("public MCP — read and verify", () => {
  it("exposes the spec's read/verify tools and no prepare tools by default", async () => {
    const c = await connect();
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "ballast_state", "book_state", "capacity", "engine_state", "funding_history", "get_evidence", "hedge_state", "hull_series",
        "market_state", "reserve_state", "risk_state", "verify_hedge", "verify_hull_series", "verify_waterfall", "waterfall_history",
      ].sort(),
    );
    expect(names.some((n) => n.startsWith("prepare_"))).toBe(false);
  });

  it("returns the API's evidence envelope", async () => {
    const c = await connect();
    expect(body(await c.callTool({ name: "book_state", arguments: {} }))).toMatchObject({ schemaVersion: 1, status: "LIVE", blockNumber: "100", data: { hullNav: "800" } });
  });

  it("venue tools are UNAVAILABLE with a reason, never zero", async () => {
    const c = await connect();
    for (const name of ["hedge_state", "market_state", "funding_history", "verify_hedge"]) {
      const r = body(await c.callTool({ name, arguments: {} }));
      expect(r.status).toBe("UNAVAILABLE");
      expect(r.reason).toMatch(/G01/);
      expect(r.data).toBeUndefined();
    }
  });

  it("history needs the service, and says so when it is not configured", async () => {
    const c = await connect();
    expect(body(await c.callTool({ name: "waterfall_history", arguments: {} })).reason).toMatch(/VESSEL_API_URL/);
    const fake = (async () =>
      new Response(JSON.stringify(env([{ event: "EpochSettled" }, { event: "DepositAdmitted" }])), { status: 200 })) as unknown as typeof fetch;
    const c2 = await connect({ apiUrl: "https://svc.test", fetchFn: fake });
    expect(body(await c2.callTool({ name: "waterfall_history", arguments: {} })).data).toEqual([{ event: "EpochSettled" }]);
  });

  it("rejects malformed input at the schema, before any read", async () => {
    const c = await connect();
    const r = await c.callTool({ name: "hull_series", arguments: { id: "1; drop table" } });
    expect(r.isError).toBe(true);
    expect(body(await c.callTool({ name: "verify_hull_series", arguments: { id: "1" } })).data.rateDerivation.status).toBe("UNAVAILABLE");
    const missing = await c.callTool({ name: "verify_hull_series", arguments: { id: "9" } });
    expect(missing.isError).toBe(true);
  });
});

describe("prepare gate", () => {
  const abi = parseAbi([
    "function approve(address spender, uint256 amount) returns (bool)",
    "function requestDeposit(uint8 tranche, uint256 seriesId, uint256 assets, address receiver, uint256 minOut, uint256 deadline) returns (uint256)",
  ]);

  it("when enabled, returns unsigned calls to manifest addresses with the wallet boundary and expiry", async () => {
    const c = await connect({ enablePrepare: true });
    const r = body(
      await c.callTool({
        name: "prepare_ballast_deposit",
        arguments: { owner: "0x000000000000000000000000000000000000a11c", assets: "5000000", minUnits: "1", deadline: String(NOW + 3600) },
      }),
    );
    expect(r.authorization).toMatch(/user's own wallet/);
    expect(r.expiresAt).toBe(String(NOW + 900));
    expect(r.calls.map((x: { to: string }) => x.to)).toEqual([m.contracts.DemoUSD, m.contracts.TrancheController]);
    expect(decodeFunctionData({ abi, data: r.calls[0].data }).args).toEqual([m.contracts.AssetCustody, 5_000_000n]);
  });

  it("an argument cannot redirect funds: there is no receiver, spender or target input", async () => {
    const c = await connect({ enablePrepare: true });
    const tool = (await c.listTools()).tools.find((t) => t.name === "prepare_ballast_deposit")!;
    const props = Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties);
    expect(props.sort()).toEqual(["assets", "currentAllowance", "deadline", "minUnits", "owner"]);
    // Extra keys a prompt might inject are ignored, not obeyed.
    const r = body(
      await c.callTool({
        name: "prepare_ballast_deposit",
        arguments: { owner: "0x000000000000000000000000000000000000a11c", assets: "5", minUnits: "1", deadline: String(NOW + 60), receiver: "0x000000000000000000000000000000000000bad1", to: "0x000000000000000000000000000000000000bad2" },
      }),
    );
    expect(JSON.stringify(r)).not.toMatch(/bad1|bad2/i);
  });

  it("invalid preparation is an error, not an encoded transaction", async () => {
    const c = await connect({ enablePrepare: true });
    const r = await c.callTool({
      name: "prepare_ballast_deposit",
      arguments: { owner: "0x0000000000000000000000000000000000000000", assets: "5", minUnits: "1", deadline: String(NOW + 60) },
    });
    expect(r.isError).toBe(true);
  });

  it("no tool sends a transaction or accepts raw calldata", async () => {
    const c = await connect({ enablePrepare: true });
    const tools = (await c.listTools()).tools;
    for (const t of tools) {
      expect(t.name).not.toMatch(/send|submit|execute|sign|raw|calldata|keeper|operator/);
      const props = Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
      expect(props).not.toContain("data");
      expect(props).not.toContain("to");
    }
  });
});
