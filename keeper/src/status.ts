import type { Decision, LastDecision } from "./types.ts";

let last: LastDecision | null = null;
let startedAt = Date.now();
let healthy = true;
let detail = "boot";
/** Latched by authenticated CRE POST /cre/decision when kind=halt. */
let creHaltLatched = false;

export function isCreHaltLatched(): boolean {
  return creHaltLatched;
}

export function latchCreHalt(reason: string): void {
  creHaltLatched = true;
  setHealth(false, `CRE halt: ${reason}`);
}

export function clearCreHalt(): void {
  creHaltLatched = false;
}

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
    creHaltLatched,
  };
}

export function recordDecision(
  decision: Decision,
  dryRun: boolean,
  orderId?: string | number,
  note?: string,
  source: "CRE" | "keeper" = "keeper",
): void {
  setLastDecision({ at: Date.now(), decision, dryRun, orderId, note, source });
}
