#!/usr/bin/env node
/**
 * Line-coverage gate for contracts/src excluding the Perpl stub.
 * Reads lcov.info produced by `forge coverage --report lcov`.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lcovPath = process.argv[2] ?? join(root, "contracts/coverage/lcov.info");
const MIN = Number(process.env.COVERAGE_MIN ?? 95);

const raw = readFileSync(lcovPath, "utf8");
const files = raw.split("end_of_record");
let hit = 0;
let found = 0;
const rows = [];

for (const block of files) {
  const sf = /SF:(.+)/.exec(block);
  if (!sf) continue;
  const file = sf[1].replace(/\\/g, "/");
  if (!file.includes("/src/") && !file.startsWith("src/")) continue;
  if (file.includes("PerplVenue")) continue;
  const lf = Number(/LF:(\d+)/.exec(block)?.[1] ?? 0);
  const lh = Number(/LH:(\d+)/.exec(block)?.[1] ?? 0);
  found += lf;
  hit += lh;
  const pct = lf === 0 ? 100 : (100 * lh) / lf;
  rows.push({ file, lf, lh, pct });
}

rows.sort((a, b) => a.pct - b.pct);
const pct = found === 0 ? 0 : (100 * hit) / found;
console.log("file".padEnd(56), "lh/lf", "pct");
for (const r of rows) {
  console.log(r.file.padEnd(56), `${r.lh}/${r.lf}`.padEnd(10), r.pct.toFixed(2));
}
console.log(`\nsrc/ (ex PerplVenue): ${hit}/${found} lines = ${pct.toFixed(2)}%  gate=${MIN}%`);
if (pct + 1e-9 < MIN) {
  console.error("coverage gate failed");
  process.exit(1);
}
