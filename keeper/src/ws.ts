/**
 * Map Perpl WS close events → recovery action.
 * Close carries no per-request status — in-flight work is lost silently.
 */
import type { CloseReason } from "./types.ts";

export type Recovery =
  | { action: "reconnect_auth"; reason: CloseReason; backoffMs: number }
  | { action: "reconnect_backoff"; reason: CloseReason; backoffMs: number }
  | { action: "reconnect_immediate"; reason: CloseReason; backoffMs: 0 };

const RETRY = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000];

export function classifyClose(code: number, reasonRaw: string): CloseReason {
  const r = (reasonRaw || "").toLowerCase();
  if (code === 3401 || r.includes("unauthorized") || r.includes("auth")) return "unauthorized";
  if (code === 1011 || r.includes("failed to process")) return "failed to process";
  if (code === 1013 || r.includes("send buffer")) return "send buffer overflow";
  if (code === 1001) return "going away";
  if (code === 1006) return "abnormal";
  if (r.includes("too many requests")) return "too many requests";
  if (r.includes("too many connections")) return "too many connections";
  if (r.includes("ping timeout")) return "ping timeout";
  if (r.includes("idle timeout")) return "idle timeout";
  if (code === 1008) return "too many requests"; // generic 1008 fallback
  return "unknown";
}

export function recoveryFor(code: number, reasonRaw: string, retryCount: number): Recovery {
  const reason = classifyClose(code, reasonRaw);
  const backoff = RETRY[Math.min(retryCount, RETRY.length - 1)]!;
  if (reason === "unauthorized") {
    return { action: "reconnect_auth", reason, backoffMs: backoff };
  }
  if (reason === "going away") {
    return { action: "reconnect_immediate", reason, backoffMs: 0 };
  }
  return { action: "reconnect_backoff", reason, backoffMs: backoff };
}

export function jitter(ms: number): number {
  if (ms <= 0) return 0;
  const j = Math.floor(Math.random() * Math.min(250, ms / 4));
  return ms + j;
}
