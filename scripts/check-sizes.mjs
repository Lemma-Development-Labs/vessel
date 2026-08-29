#!/usr/bin/env node
/**
 * Fail if any src contract runtime bytecode is ≥ 128 KiB.
 * Reads Foundry artifacts (forge build --sizes is unreliable with via-ir).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX = 128 * 1024;
const outDir = new URL("../contracts/out", import.meta.url);
const want = new Set([
  "DemoUSD",
  "Guardian",
  "BlitzVault",
  "Tranches",
  "TrancheToken",
  "EngineLite",
  "SimVenue",
  "PerplVenue",
  "MockWMON",
  "MockRouter",
]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith(".json") && !p.includes("build-info")) acc.push(p);
  }
  return acc;
}

const rows = [];
for (const p of walk(outDir.pathname)) {
  const name = p.split("/").pop().replace(/\.json$/, "");
  if (!want.has(name)) continue;
  const data = JSON.parse(readFileSync(p, "utf8"));
  let obj = data.deployedBytecode?.object ?? data.deployedBytecode ?? "";
  if (typeof obj === "object") obj = obj.object ?? "";
  if (!obj || obj === "0x") continue;
  const hex = obj.startsWith("0x") ? obj.slice(2) : obj;
  rows.push({ name, runtime: hex.length / 2 });
}
rows.sort((a, b) => b.runtime - a.runtime);
console.log("contract".padEnd(22), "runtime");
for (const r of rows) {
  console.log(r.name.padEnd(22), String(r.runtime).padStart(8));
  if (r.runtime >= MAX) {
    console.error(`${r.name} exceeds 128KB`);
    process.exit(1);
  }
}
const max = rows.reduce((m, r) => Math.max(m, r.runtime), 0);
console.log(`size gate: max runtime ${max} bytes, limit ${MAX}`);
