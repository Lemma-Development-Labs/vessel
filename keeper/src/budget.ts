/**
 * Request budget for Perpl trading WS — hard ceiling 60/min on testnet.
 * Application pings count. A reserve is held so reconcile cannot starve reduce.
 */
export type BudgetOpts = {
  /** Hard ceiling (testnet trading = 60). */
  limitPerMin?: number;
  /** Reserved for emergency reduce / halt path. */
  reservePerMin?: number;
};

export type BudgetSpendResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: "budget_exhausted"; remaining: number; queued: true };

export class RequestBudget {
  readonly limitPerMin: number;
  readonly reservePerMin: number;
  private stamps: number[] = [];
  private queue: Array<{ label: string; at: number }> = [];

  constructor(opts: BudgetOpts = {}) {
    this.limitPerMin = opts.limitPerMin ?? 60;
    this.reservePerMin = opts.reservePerMin ?? 10;
    if (this.reservePerMin >= this.limitPerMin) {
      throw new Error("reserve must be < limit");
    }
  }

  private prune(now: number): void {
    const cut = now - 60_000;
    while (this.stamps.length && this.stamps[0]! < cut) this.stamps.shift();
  }

  /** Current spend in the rolling 60s window. */
  used(now = Date.now()): number {
    this.prune(now);
    return this.stamps.length;
  }

  remaining(now = Date.now()): number {
    return Math.max(0, this.limitPerMin - this.used(now));
  }

  /**
   * Try to spend one request slot.
   * @param emergency use reserve (reduce / reconnect-critical).
   */
  trySpend(label: string, emergency = false, now = Date.now()): BudgetSpendResult {
    this.prune(now);
    const used = this.stamps.length;
    const ceiling = emergency ? this.limitPerMin : this.limitPerMin - this.reservePerMin;
    if (used >= ceiling) {
      this.queue.push({ label, at: now });
      return { ok: false, reason: "budget_exhausted", remaining: this.remaining(now), queued: true };
    }
    this.stamps.push(now);
    return { ok: true, remaining: this.remaining(now) };
  }

  drainQueue(): Array<{ label: string; at: number }> {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  queuedCount(): number {
    return this.queue.length;
  }
}
