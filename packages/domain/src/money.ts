/**
 * Money as it crosses a JSON boundary (spec §7, §13).
 *
 * The wire form is `{ amount, unit }` where `amount` is an integer decimal
 * string in the unit's base units ("1500000" for 1.5 USDC). A JavaScript
 * number is rejected outright, even when it happens to be an integer: once a
 * value has been a double it may already have lost precision, and accepting
 * "safe" numbers would let the unsafe ones through the same door.
 */

import { UNIT_DEFS, type UnitKey } from "./units.js";

export interface MoneyJson {
  /** integer decimal string in base units; may be negative (e.g. G) */
  amount: string;
  unit: UnitKey;
}

export interface Money {
  amount: bigint;
  unit: UnitKey;
}

const INTEGER_RE = /^-?(0|[1-9]\d*)$/;

export class MoneySchemaError extends TypeError {
  override name = "MoneySchemaError";
}

function isUnitKey(u: unknown): u is UnitKey {
  return typeof u === "string" && Object.hasOwn(UNIT_DEFS, u);
}

/** Validate and decode wire money. Throws MoneySchemaError on any deviation. */
export function decodeMoney(input: unknown): Money {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new MoneySchemaError("money must be an object {amount, unit}");
  }
  const { amount, unit, ...rest } = input as Record<string, unknown>;
  if (Object.keys(rest).length > 0) {
    throw new MoneySchemaError(`unexpected money fields: ${Object.keys(rest).join(", ")}`);
  }
  if (typeof amount === "number" || typeof amount === "bigint") {
    throw new MoneySchemaError(
      `amount must be an integer decimal string, got JavaScript ${typeof amount}`,
    );
  }
  if (typeof amount !== "string" || !INTEGER_RE.test(amount)) {
    throw new MoneySchemaError(`amount is not an integer decimal string: ${JSON.stringify(amount)}`);
  }
  if (amount === "-0") {
    throw new MoneySchemaError('amount "-0" is not canonical');
  }
  if (!isUnitKey(unit)) {
    throw new MoneySchemaError(`unknown unit: ${JSON.stringify(unit)}`);
  }
  return { amount: BigInt(amount), unit };
}

/** Encode for the wire. The inverse of decodeMoney for canonical input. */
export function encodeMoney(m: Money): MoneyJson {
  if (typeof m.amount !== "bigint") {
    throw new MoneySchemaError(`amount must be bigint, got ${typeof m.amount}`);
  }
  if (!isUnitKey(m.unit)) {
    throw new MoneySchemaError(`unknown unit: ${JSON.stringify(m.unit)}`);
  }
  return { amount: m.amount.toString(), unit: m.unit };
}
