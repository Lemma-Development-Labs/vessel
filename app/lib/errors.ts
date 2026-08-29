import { BaseError, decodeErrorResult, type Abi } from "viem";
import { COPY } from "./provider";
import demoAbi from "./abis/DemoUSD.json";
import engineAbi from "./abis/EngineLite.json";
import tranchesAbi from "./abis/Tranches.json";

const abis = [demoAbi, tranchesAbi, engineAbi] as Abi[];

export function decodeVesselError(err: unknown): string {
  const raw = extractData(err);
  if (raw) {
    for (const abi of abis) {
      try {
        const decoded = decodeErrorResult({ abi, data: raw });
        if (decoded.errorName === "SubordinationFloor") return COPY.floor;
        if (decoded.errorName === "FaucetCooldown") {
          const seconds = Number(decoded.args?.[0] ?? 0);
          return COPY.cooldown(seconds);
        }
        if (decoded.errorName === "HullImpairment") return COPY.impair;
        if (
          decoded.errorName === "Slippage" ||
          decoded.errorName === "InsufficientOutput"
        ) {
          return COPY.slippage;
        }
        return decoded.errorName;
      } catch {
        /* try next abi */
      }
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/user rejected|denied|rejected the request/i.test(msg)) return "";
  if (/price moved|stale|INSUFFICIENT_OUTPUT/i.test(msg)) return COPY.slippage;
  return msg.slice(0, 180);
}

function extractData(err: unknown): `0x${string}` | undefined {
  if (err instanceof BaseError) {
    const hit = err.walk((e) => {
      const d = (e as { data?: unknown }).data;
      return typeof d === "string" && d.startsWith("0x") && d.length >= 10;
    }) as { data?: unknown } | null;
    if (typeof hit?.data === "string" && hit.data.startsWith("0x")) {
      return hit.data as `0x${string}`;
    }
  }
  const seen = new Set<unknown>();
  const walk = (v: unknown): `0x${string}` | undefined => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    const o = v as Record<string, unknown>;
    for (const key of ["data", "raw"] as const) {
      const x = o[key];
      if (typeof x === "string" && x.startsWith("0x") && x.length >= 10) {
        return x as `0x${string}`;
      }
      if (x && typeof x === "object") {
        const inner = (x as { data?: unknown }).data;
        if (typeof inner === "string" && inner.startsWith("0x") && inner.length >= 10) {
          return inner as `0x${string}`;
        }
      }
    }
    return walk(o.cause) || walk(o.error) || walk(o.data);
  };
  return walk(err);
}
