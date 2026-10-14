import { describe, expect, it } from "vitest";
import {
  UNIT_DEFS,
  formatDecimal,
  formatUnit,
  parseDecimal,
  parseUnit,
} from "../src/units.js";

describe("parseDecimal", () => {
  it("scales whole and fractional parts", () => {
    expect(parseDecimal("100", 6)).toBe(100_000000n);
    expect(parseDecimal("0.5", 6)).toBe(500000n);
    expect(parseDecimal("200.5", 6)).toBe(200_500000n);
    expect(parseDecimal("-100.5", 6)).toBe(-100_500000n);
    expect(parseDecimal("0", 6)).toBe(0n);
    expect(parseDecimal("-0.0", 6)).toBe(0n);
    expect(parseDecimal("42", 0)).toBe(42n);
  });

  it("is exact beyond Number precision", () => {
    expect(parseDecimal("9007199254740993.000001", 6)).toBe(
      9007199254740993_000001n,
    );
  });

  it("rejects malformed input", () => {
    for (const bad of ["", ".", ".5", "1.", "1e5", "0x10", " 1", "1 ", "1,5", "−1", "NaN"]) {
      expect(() => parseDecimal(bad, 6), bad).toThrow(SyntaxError);
    }
  });

  it("rejects excess precision and bad decimals", () => {
    expect(() => parseDecimal("1.2345678", 6)).toThrow(RangeError);
    expect(() => parseDecimal("42.0", 0)).toThrow(RangeError);
    expect(() => parseDecimal("1", -1)).toThrow(RangeError);
    expect(() => parseDecimal("1", 1.5)).toThrow(RangeError);
  });
});

describe("formatDecimal", () => {
  it("produces canonical strings", () => {
    expect(formatDecimal(200_500000n, 6)).toBe("200.5");
    expect(formatDecimal(100_000000n, 6)).toBe("100");
    expect(formatDecimal(1n, 6)).toBe("0.000001");
    expect(formatDecimal(-100_500000n, 6)).toBe("-100.5");
    expect(formatDecimal(0n, 6)).toBe("0");
    expect(formatDecimal(42n, 0)).toBe("42");
  });

  it("round-trips through parseDecimal", () => {
    const samples = [0n, 1n, -1n, 500000n, 200_500000n, -7_654321n, 9007199254740993_000001n];
    for (const v of samples) {
      expect(parseDecimal(formatDecimal(v, 6), 6), v.toString()).toBe(v);
    }
  });
});

describe("units", () => {
  it("chain-verified decimals", () => {
    expect(UNIT_DEFS.USDC.decimals).toBe(6);
    expect(UNIT_DEFS.AUSD.decimals).toBe(6);
    expect(UNIT_DEFS.WMON.decimals).toBe(18);
  });

  it("parseUnit/formatUnit use the unit's decimals", () => {
    expect(parseUnit("1.5", "WMON")).toBe(1_500000000000000000n);
    expect(formatUnit(1_500000000000000000n, "WMON")).toBe("1.5");
    expect(parseUnit("250", "BPS")).toBe(250n);
    expect(() => parseUnit("2.5", "BPS")).toThrow(RangeError);
  });
});
