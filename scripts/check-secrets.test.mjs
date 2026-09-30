#!/usr/bin/env node
/**
 * Guards the guard.
 *
 * check-secrets.mjs distinguishes a 32-byte private key from a 32-byte block
 * hash by the identifier it sits next to. That discriminator is the only thing
 * standing between "we scan for leaked keys" and "we scan for nothing", and it
 * is exactly the kind of predicate that rots silently — loosen it once to clear
 * a false positive and the scanner goes green on a real leak.
 *
 * So: plant violations, assert the scanner catches them, assert it does not
 * catch the legitimate case. Any change to the regexes has to survive this.
 *
 * Note it stages each probe with `git add`, because the scanner reads
 * `git ls-files` — an untracked probe is never scanned and the test would pass
 * vacuously. That mistake is why this file exists.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const scanner = join(root, "scripts", "check-secrets.mjs");

// Distinct bodies so no case can pass by matching another's allowlist entry.
const HEX = (n) => `0x${"deadbeefcafebabe"}${String(n).repeat(46).slice(0, 46)}deadbeef`.slice(0, 66);

const CASES = [
  { name: "a key named privateKey is reported", shouldFail: true, body: `export const a = { privateKey: "${HEX(1)}" };` },
  { name: "a bare 32-byte hex with no identifier is reported", shouldFail: true, body: `export const b = "${HEX(2)}";` },
  { name: "a key mislabelled with a hash-ish name is still reported", shouldFail: true, body: `export const c = { blockHash_privateKey: "${HEX(3)}" };` },
  { name: "a genuine blockHash is NOT reported", shouldFail: false, body: `export const d = { blockHash: "${HEX(4)}" };` },
  { name: "a genuine transactionHash is NOT reported", shouldFail: false, body: `export const e = { transactionHash: "${HEX(5)}" };` },
];

const dir = mkdtempSync(join(root, ".scanner-probe-"));
const probe = join(dir, "probe.ts");
const rel = relative(root, probe);

let failures = 0;
for (const c of CASES) {
  writeFileSync(probe, `${c.body}\n`);
  let exitCode = 0;
  try {
    execFileSync("git", ["add", "-f", rel], { cwd: root });
    execFileSync("node", [scanner], { cwd: root, stdio: "pipe" });
  } catch (err) {
    exitCode = typeof err.status === "number" ? err.status : 1;
  } finally {
    try {
      execFileSync("git", ["rm", "-q", "--cached", rel], { cwd: root, stdio: "pipe" });
    } catch {
      /* never staged */
    }
  }
  const caught = exitCode !== 0;
  if (caught !== c.shouldFail) {
    console.error(`FAIL  ${c.name} — expected ${c.shouldFail ? "a report" : "no report"}, got exit ${exitCode}`);
    failures++;
  } else {
    console.log(`ok    ${c.name}`);
  }
}

rmSync(dir, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} scanner self-test failure(s) — check-secrets.mjs is not doing its job`);
  process.exit(1);
}
console.log("\nscanner self-test: catches keys, ignores hashes");
