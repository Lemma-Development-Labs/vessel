import { describe, expect, it } from "vitest";
import { RequestBudget } from "../src/budget.ts";

describe("RequestBudget", () => {
  it("never exceeds 60/min including pings", () => {
    const b = new RequestBudget({ limitPerMin: 60, reservePerMin: 10 });
    const t0 = 1_000_000;
    let ok = 0;
    for (let i = 0; i < 70; i++) {
      // pings count
      const r = b.trySpend(i % 5 === 0 ? "ping" : "order", false, t0 + i);
      if (r.ok) ok++;
    }
    // Non-emergency ceiling = 50
    expect(ok).toBe(50);
    expect(b.queuedCount()).toBe(20);
  });

  it("preserves reserve under burst; emergency can use it", () => {
    const b = new RequestBudget({ limitPerMin: 60, reservePerMin: 10 });
    const t0 = 2_000_000;
    for (let i = 0; i < 50; i++) {
      expect(b.trySpend("normal", false, t0 + i).ok).toBe(true);
    }
    expect(b.trySpend("normal", false, t0 + 50).ok).toBe(false);
    let emerg = 0;
    for (let i = 0; i < 15; i++) {
      if (b.trySpend("reduce", true, t0 + 50 + i).ok) emerg++;
    }
    expect(emerg).toBe(10);
    expect(b.used(t0 + 70)).toBe(60);
  });
});
