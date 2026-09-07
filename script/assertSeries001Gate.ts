#!/usr/bin/env tsx
/**
 * assertSeries001Gate.ts — fail closed before any HullSeries market work.
 *
 * HARD GATE: TX_KURU_SPOT and TX_PERPL_SHORT must be real 0x… hashes in
 * docs/ADDRESSES.md (not `<pending>`). A SimVenue-backed Hull listing is a
 * market on fiction — refuse to proceed.
 *
 * Usage:
 *   npx tsx script/assertSeries001Gate.ts
 *   # createHullMarket.ts / deploy scripts should spawn this first
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED = ["TX_KURU_SPOT", "TX_PERPL_SHORT"] as const;
const HASH_RE = /^0x[a-fA-F0-9]{64}$/;

function parseShippedHashes(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of md.split("\n")) {
    // Shipped-hash rows only: `# KEY   <pending> …` or `# KEY   0xabc… …`
    // Do not match prose like `# TX_KURU_SPOT and TX_PERPL_SHORT are real…`
    const m = line.match(
      /^#\s*(TX_KURU_SPOT|TX_PERPL_SHORT|PERPL_KEEPER_ORDER)\s+(<pending>|0x[a-fA-F0-9]{64})\b/,
    );
    if (!m) continue;
    out[m[1]] = m[2];
  }
  return out;
}

function main(): void {
  const path = resolve(process.cwd(), "docs/ADDRESSES.md");
  const md = readFileSync(path, "utf8");
  const hashes = parseShippedHashes(md);

  // Prefer TX_PERPL_SHORT; fall back to PERPL_KEEPER_ORDER if SHORT unset but
  // keeper order is a real hash (alias).
  if (
    (!hashes.TX_PERPL_SHORT || hashes.TX_PERPL_SHORT === "<pending>") &&
    hashes.PERPL_KEEPER_ORDER &&
    HASH_RE.test(hashes.PERPL_KEEPER_ORDER)
  ) {
    hashes.TX_PERPL_SHORT = hashes.PERPL_KEEPER_ORDER;
  }

  const failures: string[] = [];
  for (const key of REQUIRED) {
    const v = hashes[key];
    if (!v || v === "<pending>" || !HASH_RE.test(v)) {
      failures.push(
        `${key}=${v ?? "(missing)"} — need a 32-byte tx hash in docs/ADDRESSES.md`,
      );
    }
  }

  if (failures.length) {
    console.error("SERIES-001 HARD GATE closed — refusing market work:");
    for (const f of failures) console.error(`  • ${f}`);
    console.error(
      "See docs/SERIES-001.md. Do not deploy HullSeries or create a Kuru market.",
    );
    process.exit(1);
  }

  console.log("SERIES-001 gate open:");
  for (const key of REQUIRED) {
    console.log(`  ${key} ${hashes[key]}`);
  }
}

main();
