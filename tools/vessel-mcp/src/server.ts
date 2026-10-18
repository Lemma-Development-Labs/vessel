#!/usr/bin/env -S npx tsx
import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TESTNET_V2, Vessel, client, parseManifest } from "./vendor/sdk/index.ts";
import { buildServer } from "./tools.ts";

/**
 * stdio entry. Environment:
 *   VESSEL_RPC_URL       chain RPC (default: public Monad testnet)
 *   VESSEL_MANIFEST      path to a release manifest (default: the bundled testnet v2 manifest)
 *   VESSEL_API_URL       Vessel service base URL, for indexed history (optional)
 *   VESSEL_MCP_PREPARE=1 enable unsigned preparation tools (off by default)
 * Logs go to stderr; stdout carries only the protocol.
 */
const rpc = process.env.VESSEL_RPC_URL?.trim() || "https://testnet-rpc.monad.xyz";
const manifest = parseManifest(
  process.env.VESSEL_MANIFEST ? (JSON.parse(readFileSync(process.env.VESSEL_MANIFEST, "utf8")) as unknown) : TESTNET_V2,
);
const reader = new Vessel(manifest, client(rpc), `rpc:${new URL(rpc).host} (direct chain read)`);
const enablePrepare = process.env.VESSEL_MCP_PREPARE === "1";
const apiUrl = process.env.VESSEL_API_URL?.trim();

const server = buildServer({ reader, enablePrepare, ...(apiUrl ? { apiUrl } : {}) });
await server.connect(new StdioServerTransport());
console.error(`vessel-mcp: ${manifest.environment} chain ${manifest.chainId} via ${new URL(rpc).host}; prepare ${enablePrepare ? "ENABLED" : "disabled"}`);
