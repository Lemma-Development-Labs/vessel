import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

/**
 * Prompt 08/09 review bar — source-level checks (Playwright stranger path
 * needs a live browser + faucets; these catch the UI blockers in CI).
 */
describe("prompt 09 review bar", () => {
  it("ActionBar always exposes Unwind with a disabled reason path", () => {
    const src = read("components/action-bar.tsx");
    expect(src).toMatch(/Unwind/);
    expect(src).toMatch(/Nothing deployed/);
    expect(src).not.toMatch(/return null/);
  });

  it("UnwindCard never returns null when undeployed", () => {
    const src = read("components/exit-flow.tsx");
    expect(src).toMatch(/Nothing deployed — vault cash is already idle/);
    expect(src).not.toMatch(/if \(shortId\.status === "ok".*return null/s);
  });

  it("Deposit lists Ballast before Hull (Ballast fills first)", () => {
    const src = read("components/deposit-screen.tsx");
    const ballast = src.indexOf('kind="ballast"');
    const hull = src.indexOf('kind="hull"');
    expect(ballast).toBeGreaterThan(0);
    expect(hull).toBeGreaterThan(ballast);
    expect(src).toMatch(/Ballast fills first|FILLS FIRST/);
  });

  it("honesty chips stay SIM until ADDRESSES hashes exist", () => {
    const src = read("components/integration-chips.tsx");
    expect(src).toMatch(/TX_KURU_SPOT: false/);
    expect(src).toMatch(/PERPL_KEEPER_ORDER: false/);
    expect(src).toMatch(/MockRouter/);
    expect(src).toMatch(/SimVenue/);
    expect(src).not.toMatch(/powered by Perpl/);
  });

  it("SIM badge does not claim Perpl next as integrated", () => {
    const badge = read("components/ui.tsx");
    expect(badge).toMatch(/MockRouter \+ SimVenue/);
    expect(badge).not.toMatch(/SIM VENUE — Perpl next/);
  });

  it("banner names chain 10143 and not Vessel Finance", () => {
    const copy = read("lib/provider.ts");
    expect(copy).toMatch(/chain 10143/);
    expect(copy).toMatch(/not Vessel Finance/);
    expect(copy).not.toMatch(/\bAPY\b/);
    expect(copy).not.toMatch(/partnered|guaranteed/i);
  });
});
