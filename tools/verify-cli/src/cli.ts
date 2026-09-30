#!/usr/bin/env -S node --import tsx
/**
 * vessel-verify — reproduce the book from chain state, without the Vessel API.
 *
 *   pnpm verify --manifest ../../deployments/testnet-v2.json --rpc https://testnet-rpc.monad.xyz [--json] [--latest]
 *
 * Exit code 0 = no MISMATCH, 1 = MISMATCH, 2 = could not verify (bad input, RPC).
 */
import { readFileSync } from "node:fs";
import { evaluate, overall } from "./checks.ts";
import { client, parseManifest, readSnapshot } from "./read.ts";

const SCHEMA_VERSION = 1;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const manifestPath = arg("manifest");
  const rpc = arg("rpc");
  if (!manifestPath || !rpc) {
    console.error("usage: vessel-verify --manifest <release manifest> --rpc <url> [--json] [--latest]");
    return 2;
  }
  const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const tag = process.argv.includes("--latest") ? "latest" : "finalized";
  const snap = await readSnapshot(client(rpc), manifest, tag);
  const checks = evaluate(snap);
  const verdict = overall(checks);

  if (process.argv.includes("--json")) {
    const envelope = {
      schemaVersion: SCHEMA_VERSION,
      environment: manifest.environment,
      chainId: snap.chainId,
      blockNumber: snap.blockNumber.toString(),
      blockHash: snap.blockHash,
      // eslint-disable-next-line no-restricted-syntax -- block timestamp (seconds -> ms), not a money value
      observedAt: new Date(Number(snap.blockTimestamp) * 1000).toISOString(),
      source: `rpc:${new URL(rpc).host} (direct, no Vessel API)`,
      units: `${snap.asset.symbol}:${snap.asset.decimals}`,
      status: verdict,
      checks,
    };
    console.log(JSON.stringify(envelope, null, 2));
  } else {
    console.log(`Vessel verification · ${manifest.environment} · chain ${snap.chainId} · ${tag} block ${snap.blockNumber}`);
    console.log(`block hash ${snap.blockHash} · units ${snap.asset.symbol} (${snap.asset.decimals} decimals, base units)`);
    for (const c of checks) {
      const vals = Object.entries(c.values).map(([k, v]) => `${k}=${v}`).join(" ");
      console.log(`${c.verdict.padEnd(9)} ${c.id.padEnd(16)} ${c.summary}${vals ? `\n          ${vals}` : ""}`);
    }
    console.log(`\nOVERALL ${verdict}. A pass describes the observed state; it is not a solvency guarantee.`);
  }
  return verdict === "MISMATCH" ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`could not verify: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  },
);
