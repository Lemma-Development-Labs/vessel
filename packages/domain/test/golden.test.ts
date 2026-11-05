import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  conservationHolds,
  parseGoldenVectors,
  type GoldenVector,
} from "../src/goldenVectors.js";

const url = new URL(
  "../../../docs/spec/ACCOUNTING_GOLDEN_VECTORS.json",
  import.meta.url,
);
const vectors = parseGoldenVectors(JSON.parse(readFileSync(url, "utf8")));

describe("canonical golden vectors (docs/spec)", () => {
  it("has the five spec §7 cases with unique names", () => {
    expect(vectors.map((v) => v.name)).toEqual([
      "positive",
      "coupon_shortfall",
      "junior_loss",
      "reserve_loss",
      "senior_loss",
    ]);
  });

  it("every vector satisfies ΔH + ΔB + ΔR + FT = G", () => {
    for (const v of vectors) {
      expect(conservationHolds(v), v.name).toBe(true);
    }
  });

  it("the check actually detects violations", () => {
    const broken: GoldenVector = {
      ...vectors[0]!,
      end: { ...vectors[0]!.end, FT: "6.000001" },
    };
    expect(conservationHolds(broken)).toBe(false);
  });

  it("rejects malformed vectors", () => {
    expect(() => parseGoldenVectors([{ name: "x" }])).toThrow(TypeError);
    expect(() => parseGoldenVectors("nope")).toThrow(TypeError);
    expect(() =>
      parseGoldenVectors([{ ...vectors[0]!, G: "1e3" }]),
    ).toThrow(SyntaxError);
  });
});
