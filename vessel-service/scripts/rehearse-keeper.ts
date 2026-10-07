/**
 * Run the real v2 keeper (controller policy + hedge policy, durable journal in PGlite) against a
 * LOCAL fork for a bounded number of seconds, then print what the engine holds. Used by
 * scripts/v2-deploy-hedged.sh --rehearse; refuses any RPC that is not localhost.
 *
 *   V2_MANIFEST_PATH=<manifest> V2_KEEPER_PK=<anvil key> RPC=http://127.0.0.1:8548 \
 *     npx tsx scripts/rehearse-keeper.ts <seconds>
 */
import { readFileSync } from "node:fs";
import pino from "pino";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { vesselChain } from "../src/addresses.ts";
import { parseManifest } from "../src/vendor/verify/read.ts";
import { openV2Sql, startV2Keeper } from "../src/v2/runner.ts";
import { startV2Quoter } from "../src/v2/quoterLoop.ts";

const seconds = Number(process.argv[2] ?? "60");
const rpcUrl = process.env.RPC ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(rpcUrl)) throw new Error("rehearse-keeper runs only against a local fork");
const manifest = parseManifest(JSON.parse(readFileSync(process.env.V2_MANIFEST_PATH!, "utf8")) as unknown);
const log = pino({ level: "info" });
const pc = createPublicClient({ transport: http(rpcUrl) });
const sql = openV2Sql("testnet", log);

const handle = await startV2Keeper({
  manifest,
  pc,
  chain: vesselChain(rpcUrl, manifest.chainId),
  rpcUrl,
  environment: "testnet",
  log,
  sql,
});
if (!handle) throw new Error("keeper did not start (V2_KEEPER_PK unset?)");
// The testnet quoter runs too when V2_QUOTER_PK (the seeder) is set.
const quoter = await startV2Quoter({ manifest, pc, chain: vesselChain(rpcUrl, manifest.chainId), rpcUrl, log, sql });
await new Promise((r) => setTimeout(r, seconds * 1000));
handle.stop();
quoter?.stop();

const engine = manifest.contracts.HedgedEngine as Address;
const abi = parseAbi([
  "function value() view returns (uint256, uint256)",
  "function usdcCash() view returns (uint256)",
  "function ausdCash() view returns (uint256)",
  "function monQty() view returns (uint256)",
  "function shortLots() view returns (uint256)",
  "function perplEquity() view returns (uint256)",
]);
const read = (fn: string) => pc.readContract({ address: engine, abi, functionName: fn as never }) as Promise<bigint | readonly [bigint, bigint]>;
const out: Record<string, string> = {};
for (const fn of ["value", "usdcCash", "ausdCash", "monQty", "shortLots", "perplEquity"]) {
  const v = await read(fn);
  out[fn] = Array.isArray(v) ? String(v[0]) : String(v);
}
const rows = await sql.query<{ action: string; state: string; inputs: { why?: string } }>(
  "SELECT action, state, inputs FROM action_journal ORDER BY id",
);
const keeperRows = rows.filter((r) => !["batchUpdate", "batchCancelFlipOrders", "marginDeposit", "approve"].includes(r.action));
const quoterRows = rows.filter((r) => ["batchUpdate", "batchCancelFlipOrders", "marginDeposit", "approve"].includes(r.action));
console.log(
  JSON.stringify({
    engine: out,
    keeper: keeperRows.map((r) => `${r.action}:${r.state}`),
    quoter: quoterRows.map((r) => `${r.action}:${r.state}${r.inputs?.why ? `(${r.inputs.why})` : ""}`),
  }),
);
process.exit(0);
