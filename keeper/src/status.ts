import type { Decision, LastDecision } from "./types.ts";

let last: LastDecision | null = null;
let startedAt = Date.now();
let healthy = true;
let detail = "boot";

export function setLastDecision(d: LastDecision): void {
  last = d;
}

export function getLastDecision(): LastDecision | null {
  return last;
}

export function setHealth(ok: boolean, reason: string): void {
  healthy = ok;
  detail = reason;
}

export function healthPayload(): object {
  return {
    ok: healthy,
    detail,
    startedAt,
    uptimeMs: Date.now() - startedAt,
    lastDecision: last,
  };
}

export function recordDecision(decision: Decision, dryRun: boolean, orderId?: string | number, note?: string): void {
  setLastDecision({ at: Date.now(), decision, dryRun, orderId, note });
}
