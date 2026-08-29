#!/usr/bin/env node
/**
 * Fail if a 32-byte hex key that is NOT a well-known Anvil account appears in
 * tracked files. Anvil keys in README / .env.example are documented, not secrets.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ALLOW = new Set(
  [
    "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    "7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    "47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
    "8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
    "92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
    "4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
    "dbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
    "2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
  ].map((s) => s.toLowerCase()),
);

const files = execSync("git ls-files", { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
  .trim()
  .split("\n")
  .filter(
    (f) =>
      !f.startsWith("contracts/lib/") &&
      !f.startsWith(".agents/") &&
      !f.includes("pnpm-lock") &&
      !f.endsWith(".lock") &&
      !f.endsWith(".json") &&
      !f.endsWith(".md") &&
      !f.endsWith(".gas-snapshot") &&
      !f.endsWith("lcov.info"),
  );

const keyRe = /0x([a-fA-F0-9]{64})/g;
let bad = 0;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  keyRe.lastIndex = 0;
  let m;
  while ((m = keyRe.exec(text))) {
    const hex = m[1].toLowerCase();
    if (ALLOW.has(hex)) continue;
    console.error(`possible key material in ${file}: 0x${hex.slice(0, 8)}…`);
    bad++;
  }
}

const msgs = execSync("git log -n 50 --pretty=%B", { encoding: "utf8" });
keyRe.lastIndex = 0;
let m;
while ((m = keyRe.exec(msgs))) {
  const hex = m[1].toLowerCase();
  if (ALLOW.has(hex)) continue;
  console.error(`possible key in git log message: 0x${hex.slice(0, 8)}…`);
  bad++;
}

if (bad) {
  console.error(`${bad} possible secret(s)`);
  process.exit(1);
}
console.log("secrets scan: no unexpected 0x+64-hex keys (Anvil well-known keys allowlisted)");
