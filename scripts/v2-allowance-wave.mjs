#!/usr/bin/env node
/**
 * Build a tester allowlist wave for the hedged testnet book: one Safe batch that sets a lifetime
 * deposit allowance for each address, then the Safe Transaction Builder files to sign.
 *
 *   node scripts/v2-allowance-wave.mjs <wave> <address> [address …] [--usdc 500]
 *   node scripts/v2-allowance-wave.mjs 2 --file wave2.txt --usdc 500   # one address per line
 *
 * Writes deployments/governance/testnet-v2h-03-allowances-wave<wave>.json and its
 * .schedule/.execute Safe files. Addresses are checksummed with `cast`; duplicates, the zero address
 * and allowances above the spec's per-participant limit (500 USDC in the private cohort, 2,000 at
 * most) are refused. Sending nothing: the Safe signs and executes the files.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_USDC = 2_000; // spec stage C ceiling per external participant
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
const args = process.argv.slice(2);
const wave = Number(args.shift());
if (!Number.isInteger(wave) || wave < 2) {
  console.error("usage: node scripts/v2-allowance-wave.mjs <wave ≥ 2> <address …> [--file list.txt] [--usdc 500]");
  process.exit(2);
}
let usdc = 500;
const raw = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--usdc") usdc = Number(args[++i]);
  else if (args[i] === "--file") raw.push(...readFileSync(args[++i], "utf8").split(/\s+/));
  else raw.push(args[i]);
}
if (!(usdc > 0 && usdc <= MAX_USDC)) {
  console.error(`--usdc must be between 1 and ${MAX_USDC}`);
  process.exit(2);
}
const cast = (...a) => execFileSync("cast", a, { encoding: "utf8" }).trim();
const seen = new Set();
const addresses = [];
for (const a of raw.map((x) => x.trim()).filter(Boolean)) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) fail(`not an address: ${a}`);
  const c = cast("to-check-sum-address", a);
  if (/^0x0{40}$/i.test(c)) fail("the zero address cannot be allowlisted");
  if (seen.has(c.toLowerCase())) fail(`duplicate address: ${c}`);
  seen.add(c.toLowerCase());
  addresses.push(c);
}
if (!addresses.length) fail("no addresses given");

const root = join(import.meta.dirname, "..");
const spec = join(root, "deployments/governance", `testnet-v2h-03-allowances-wave${wave}.json`);
if (existsSync(spec)) fail(`${spec} exists already; use the next wave number`);
const units = String(BigInt(Math.round(usdc * 1e6)));
writeFileSync(
  spec,
  JSON.stringify(
    {
      name: `Vessel v2 hedged testnet 03 — participant allowances, wave ${wave}`,
      salt: `testnet-v2h-03-allowances-wave${wave}`,
      notes: `${addresses.length} tester wallet(s), ${usdc} USDC lifetime each (Circle testnet USDC; the faucet gives 20 every 2 hours).`,
      calls: addresses.map((a) => ({ to: "TrancheController", sig: "setAllowance(address,uint256)", args: [a, units] })),
    },
    null,
    2,
  ) + "\n",
);
console.log(`wrote ${spec.slice(root.length + 1)} — ${addresses.length} wallet(s) × ${usdc} USDC`);
execFileSync("node", [join(root, "scripts/v2-governance-batch.mjs"), spec], { cwd: root, stdio: "inherit" });
