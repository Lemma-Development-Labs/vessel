import { BaseError, decodeErrorResult, type Abi } from "viem";
import { COPY } from "./copy";
import controllerAbi from "./book/abis/TrancheController.json";
import escrowAbi from "./book/abis/ClaimEscrow.json";
import dusdAbi from "./book/abis/DemoUSD.json";

const abis = [controllerAbi, escrowAbi, dusdAbi] as Abi[];

/** Contract error name → what the user should read. Unknown names pass through as-is. */
const MESSAGES: Record<string, string> = {
  NotEligible: "This wallet is not on the beta allowlist yet. Access goes out in waves.",
  CapExceeded: "Above your beta allowance or the stage cap.",
  WindowClosed: "The subscription window has closed.",
  WindowOpen: "The subscription window is still open.",
  TooManySubscribers: "This series is full (25 subscribers).",
  DeadlinePassed: "The request deadline has passed.",
  BookImpaired: COPY.impair,
  BadSeries: "That series is not open.",
  BadStatus: "This request can no longer be changed.",
  NotOwner: "Only the request owner can do that.",
  ZeroAmount: "Nothing to do — the amount is zero.",
  ClaimsPaused: "Claims are paused by the guardian.",
  NothingToClaim: "Nothing to claim yet.",
  Paused: "Paused by the guardian — views still work.",
};

export function decodeVesselError(err: unknown): string {
  const raw = extractData(err);
  if (raw) {
    for (const abi of abis) {
      try {
        const decoded = decodeErrorResult({ abi, data: raw });
        if (decoded.errorName === "FaucetCooldown") return COPY.cooldown(Number(decoded.args?.[0] ?? 0));
        return MESSAGES[decoded.errorName] ?? decoded.errorName;
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
