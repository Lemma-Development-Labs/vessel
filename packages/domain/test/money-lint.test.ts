import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { moneyRules } from "../eslint-money-rules.js";

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [{ files: ["**/*.ts"], languageOptions: { parser: tseslint.parser }, rules: moneyRules }],
});

async function errors(code: string): Promise<number> {
  const [r] = await eslint.lintText(code, { filePath: "src/probe.ts" });
  return r?.errorCount ?? -1;
}

describe("money lint rules", () => {
  it.each([
    ["Number() coercion", "const x = Number(amount);"],
    ["parseFloat", "const x = parseFloat(s);"],
    ["parseInt", "const x = parseInt(s, 10);"],
    ["Number.parseFloat", "const x = Number.parseFloat(s);"],
    ["Math rounding", "const x = Math.round(a * 1.1);"],
    ["toFixed", "const s = fee.toFixed(2);"],
    ["unary plus", "const x = +amount;"],
    ["float literal", "const fee = gross * 0.1;"],
    ["exponent literal", "const unit = 1e6;"],
  ])("rejects %s", async (_label, code) => {
    expect(await errors(code)).toBeGreaterThan(0);
  });

  it.each([
    ["bigint math", "const fee = (gross * 1000n) / 10000n;"],
    ["integer checks", "if (!Number.isInteger(decimals)) throw new Error();"],
    ["BigInt parse", "const x = BigInt(s);"],
    ["integer literal", "const bps = 10000;"],
  ])("allows %s", async (_label, code) => {
    expect(await errors(code)).toBe(0);
  });
});
