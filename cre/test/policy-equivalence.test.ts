import { describe, expect, it } from "vitest";
import { decide } from "../../keeper/src/policy.ts";
import { POLICY_FIXTURES } from "../../keeper/src/fixtures.ts";
import { snapshotToState, stateToSnapshot, decisionToJson } from "../snapshot.ts";

/**
 * Equivalence: CRE runtime and keeper runtime must call the same decide().
 * Fixture table shared with keeper/test/policy.test.ts.
 */
describe("CRE ↔ keeper policy equivalence", () => {
  for (const f of POLICY_FIXTURES) {
    it(`identical decision: ${f.name}`, () => {
      const d = decide(f.state);
      expect(d.kind).toBe(f.expectKind);
      if (f.reasonMatch) expect(d.reason).toMatch(f.reasonMatch);
    });
  }

  it("imports decide from keeper (not a local copy)", async () => {
    const policyMod = await import("../../keeper/src/policy.ts");
    const creMainSrc = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../main.ts", import.meta.url), "utf8"),
    );
    expect(creMainSrc).toMatch(/from ["'].*keeper\/src\/policy/);
    expect(creMainSrc).not.toMatch(/function decide\s*\(/);
    expect(typeof policyMod.decide).toBe("function");
  });

  it("snapshot round-trip preserves decide() outcome", () => {
    for (const f of POLICY_FIXTURES) {
      const round = snapshotToState(stateToSnapshot(f.state));
      expect(decide(round)).toEqual(decide(f.state));
    }
  });

  it("decisionToJson is JSON-safe for CRE HTTP act", () => {
    const d = decide(POLICY_FIXTURES.find((x) => x.expectKind === "reduce")!.state);
    const j = decisionToJson(d);
    expect(() => JSON.stringify(j)).not.toThrow();
    expect(j.kind).toBe("reduce");
  });
});
