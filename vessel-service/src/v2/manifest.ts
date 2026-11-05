import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "pino";
import { parseManifest, type Manifest } from "../vendor/verify/read.ts";

/**
 * The v2 release manifest, from V2_MANIFEST_JSON (inline) or V2_MANIFEST_PATH
 * (default ../deployments/testnet-v2.json). Absent → /v1 is not served. A
 * manifest for a different chain than the service's verified RPC is refused.
 */
export function loadV2Manifest(chainId: number, log: Logger): Manifest | null {
  const inline = process.env.V2_MANIFEST_JSON?.trim();
  const path = resolve(process.cwd(), process.env.V2_MANIFEST_PATH ?? "../deployments/testnet-v2.json");
  let raw: string;
  if (inline) raw = inline;
  else if (existsSync(path)) raw = readFileSync(path, "utf8");
  else {
    log.warn({ path }, "no v2 manifest — /v1 routes not served");
    return null;
  }
  const m = parseManifest(JSON.parse(raw) as unknown);
  if (m.chainId !== chainId) throw new Error(`v2 manifest is for chain ${m.chainId}, service runs on ${chainId}`);
  return m;
}
