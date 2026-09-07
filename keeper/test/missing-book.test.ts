import { describe, expect, it } from "vitest";
import { decide } from "../src/policy.ts";
import { baseState } from "../src/fixtures.ts";

describe("missing market data must halt (never coerce book to 0)", () => {
  it("stale / max age from missing ask path ⇒ halt", () => {
    const d = decide(
      baseState({
        marketDataAgeMs: Number.MAX_SAFE_INTEGER,
        maxMarketDataAgeMs: 60_000,
      }),
    );
    expect(d.kind).toBe("halt");
    expect(d.reason).toMatch(/stale market data/);
  });
});
