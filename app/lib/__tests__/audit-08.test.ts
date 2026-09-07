import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");

describe("prompt 08 fabricated / claim sweep (sampled)", () => {
  it("indexer crank handler does not invent spotInventory 0", () => {
    const src = readFileSync(
      join(root, "../indexer/src/handlers/vessel.ts"),
      "utf8",
    );
    expect(src).toMatch(/Do NOT invent spotInventory/);
    // No assignment of spotInventory: 0n on the Cranked path.
    const cranked = src.split("EngineLite.Cranked.handler")[1]?.split("EngineLite.LiquidityDeployed")[0] ?? "";
    expect(cranked).not.toMatch(/spotInventory:\s*0n/);
  });

  it("PerplVenue stub isSimulated true", () => {
    const src = readFileSync(
      join(root, "../contracts/src/venues/PerplVenue.stub.sol"),
      "utf8",
    );
    expect(src).toMatch(/function isSimulated[\s\S]*return true/);
  });

  it("FINDINGS-08 and RISK document pause egress policy", () => {
    const findings = readFileSync(join(root, "../docs/FINDINGS-08.md"), "utf8");
    const risk = readFileSync(join(root, "../docs/risk.md"), "utf8");
    const addendum = readFileSync(join(root, "../docs/FINDINGS-08-ADDENDUM.md"), "utf8");
    expect(findings).toMatch(/Guardian `pause\(\)`/);
    expect(risk).toMatch(/Who can call `unwind`/);
    expect(risk).toMatch(/including while paused/);
    expect(addendum).toMatch(/pause-exempt/);
  });
});
