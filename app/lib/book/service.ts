/**
 * Shape checks for stats-service JSON (/v1/book, /v1/history). The app renders
 * these with BigInt() and .map(), so one missing or mistyped field used to throw
 * during render and take the whole app to the root error page (review APP-7).
 * A payload that doesn't match is a failed read with a reason — Rule 0 — not a
 * crash and not a guess.
 */
import type { BookCheck, BookEvidence, BookHistoryRow } from "./types";

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const EVIDENCE_STATUS: readonly BookEvidence["status"][] = ["LIVE", "SIMULATED", "MISMATCH", "UNAVAILABLE"];
const VERDICTS: readonly BookCheck["verdict"][] = ["PASS", "MISMATCH", "SIMULATED", "INFO"];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
/** Block numbers travel as decimal strings; BigInt() accepts exactly these. */
const isBlock = (x: unknown): x is string => typeof x === "string" && /^\d{1,20}$/.test(x);
const isHash = (x: unknown): x is string => typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x);

const fail = (reason: string): Parsed<never> => ({ ok: false, reason: `malformed service reply: ${reason}` });

export function parseBookEvidence(body: unknown): Parsed<BookEvidence> {
  if (!isObj(body)) return fail("not an object");
  const { status, blockNumber, blockHash, checks } = body;
  if (!EVIDENCE_STATUS.includes(status as BookEvidence["status"])) return fail(`status ${JSON.stringify(status)}`);
  if (blockNumber != null && !isBlock(blockNumber)) return fail("blockNumber");
  if (blockHash != null && !isHash(blockHash)) return fail("blockHash");
  if (checks != null && !Array.isArray(checks)) return fail("checks is not a list");
  const out: BookCheck[] = [];
  for (const c of (checks as unknown[] | null | undefined) ?? []) {
    if (!isObj(c) || typeof c.id !== "string" || typeof c.summary !== "string" || !VERDICTS.includes(c.verdict as BookCheck["verdict"])) {
      return fail("a check");
    }
    out.push({ id: c.id, verdict: c.verdict as BookCheck["verdict"], summary: c.summary });
  }
  return {
    ok: true,
    value: {
      status: status as BookEvidence["status"],
      blockNumber: (blockNumber as string | null | undefined) ?? null,
      blockHash: (blockHash as string | null | undefined) ?? null,
      checks: out,
    },
  };
}

/** A history page with any bad row is unavailable as a whole: a silently shortened list would read as complete. */
export function parseHistory(body: unknown): Parsed<BookHistoryRow[]> {
  if (!isObj(body)) return fail("not an object");
  if (body.data == null) return { ok: true, value: [] };
  if (!Array.isArray(body.data)) return fail("data is not a list");
  const out: BookHistoryRow[] = [];
  for (const r of body.data as unknown[]) {
    if (
      !isObj(r) ||
      !isBlock(r.blockNumber) ||
      !isHash(r.txHash) ||
      !Number.isInteger(r.logIndex) ||
      typeof r.event !== "string" ||
      !isObj(r.args) ||
      typeof r.finalized !== "boolean"
    ) {
      return fail("a history row");
    }
    out.push({ blockNumber: r.blockNumber, txHash: r.txHash, logIndex: r.logIndex as number, event: r.event, args: r.args, finalized: r.finalized });
  }
  return { ok: true, value: out };
}

/** The reason an error reply gives, without trusting its shape. */
export function serviceReason(body: unknown): string {
  const r = isObj(body) ? (body.reason ?? body.error) : undefined;
  return typeof r === "string" && r.length > 0 ? r.slice(0, 200) : "service unavailable";
}

/** Field types for `pickShape`; nested objects are shapes themselves. */
export type Shape = { [key: string]: "string" | "number" | "boolean" | "string[]" | "record" | Shape };

/**
 * Keep only the fields of `body` that match `shape` (null kept as null); drop the
 * rest. For replies rendered field by field, where a wrong field should show as
 * "—" and the rest of the page should still render.
 */
export function pickShape(body: unknown, shape: Shape): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isObj(body)) return out;
  for (const [k, t] of Object.entries(shape)) {
    const v = body[k];
    if (v === null) out[k] = null;
    else if (typeof t === "object") {
      if (isObj(v)) out[k] = pickShape(v, t);
    } else if (t === "string[]") {
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = v;
    } else if (t === "record") {
      if (isObj(v)) out[k] = Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string"));
    } else if (t === "number") {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    } else if (typeof v === t) out[k] = v;
  }
  return out;
}
