import { describe, expect, it } from "vitest";
import { MoneySchemaError, decodeMoney, encodeMoney } from "../src/money.js";

describe("money JSON schema", () => {
  it("money_schema_rejects_js_number", () => {
    // Even a safe integer is refused: the wire form is a string, full stop.
    for (const amount of [1, 1500000, 0, -5, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => decodeMoney({ amount, unit: "USDC" }), String(amount)).toThrow(
        MoneySchemaError,
      );
    }
    expect(() => decodeMoney({ amount: 10n, unit: "USDC" })).toThrow(MoneySchemaError);
  });

  it("rejects non-canonical and non-integer strings", () => {
    for (const amount of ["1.5", "1e6", "0x10", " 1", "01", "", "-", "-0", "+1", "1_000"]) {
      expect(() => decodeMoney({ amount, unit: "USDC" }), amount).toThrow(MoneySchemaError);
    }
  });

  it("rejects unknown units and extra fields", () => {
    expect(() => decodeMoney({ amount: "1", unit: "USDT" })).toThrow(MoneySchemaError);
    expect(() => decodeMoney({ amount: "1", unit: "toString" })).toThrow(MoneySchemaError);
    expect(() => decodeMoney({ amount: "1", unit: "USDC", decimals: 6 })).toThrow(
      MoneySchemaError,
    );
    expect(() => decodeMoney(null)).toThrow(MoneySchemaError);
    expect(() => decodeMoney(["1", "USDC"])).toThrow(MoneySchemaError);
  });

  it("round-trips beyond 2^53 without precision loss", () => {
    const wire = { amount: "123456789012345678901234567890", unit: "USD18" } as const;
    const m = decodeMoney(JSON.parse(JSON.stringify(wire)));
    expect(m.amount).toBe(123456789012345678901234567890n);
    expect(encodeMoney(m)).toEqual(wire);
    expect(decodeMoney({ amount: "-7", unit: "USD18" }).amount).toBe(-7n);
  });
});
