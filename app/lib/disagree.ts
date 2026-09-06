import type { Live } from "./live";

/**
 * On-chain vs API disagreement detector for the transparency position panel.
 *
 * A disagreement is itself information — we never silently pick a side.
 * Incomplete inputs (one side unavailable) are not disagreements.
 */

export type AgreeResult<T> =
  | { kind: "agree"; onchain: T; api: T }
  | { kind: "disagree"; onchain: T; api: T; message: string }
  | { kind: "incomplete"; reason: string };

export function compareLive<T>(
  onchain: Live<T>,
  api: Live<T>,
  eq: (a: T, b: T) => boolean,
  format: (v: T) => string,
): AgreeResult<T> {
  if (onchain.status !== "ok" && api.status !== "ok") {
    return {
      kind: "incomplete",
      reason: `on-chain: ${onchain.reason}; api: ${api.reason}`,
    };
  }
  if (onchain.status !== "ok") {
    return { kind: "incomplete", reason: `on-chain unavailable — ${onchain.reason}` };
  }
  if (api.status !== "ok") {
    return { kind: "incomplete", reason: `api unavailable — ${api.reason}` };
  }
  if (eq(onchain.value, api.value)) {
    return { kind: "agree", onchain: onchain.value, api: api.value };
  }
  return {
    kind: "disagree",
    onchain: onchain.value,
    api: api.value,
    message: `on-chain ${format(onchain.value)} ≠ api ${format(api.value)}`,
  };
}

export function bigintEq(a: bigint, b: bigint): boolean {
  return a === b;
}
