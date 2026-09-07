import { describe, expect, it } from "vitest";
import { decide } from "../src/policy.ts";
import { POLICY_FIXTURES } from "../src/fixtures.ts";

describe("policy decide fixtures", () => {
  for (const f of POLICY_FIXTURES) {
    it(f.name, () => {
      const d = decide(f.state);
      expect(d.kind).toBe(f.expectKind);
      if (f.reasonMatch) expect(d.reason).toMatch(f.reasonMatch);
      if (f.expectKind === "reduce" && d.kind === "reduce") {
        expect(d.targetNotional).toBe(50_000_000n);
      }
    });
  }
});
