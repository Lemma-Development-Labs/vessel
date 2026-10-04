/**
 * Versioned unit definitions and integer decimal-string math (spec §7).
 *
 * Money never touches JavaScript Number. Values are BigInt at runtime and
 * decimal strings in JSON. Token decimals below are chain-verified where
 * noted (docs/FACT_CHECKS.md, 2026-09-23).
 */

export const UNITS_VERSION = 1;

export const UNIT_DEFS = {
  USDC: { decimals: 6, note: "Circle USDC, Monad mainnet — chain-verified" },
  AUSD: { decimals: 6, note: "Agora USD, Perpl margin — chain-verified" },
  DUSD: { decimals: 6, note: "DemoUSD, valueless testnet faucet token" },
  WMON: { decimals: 18, note: "Wrapped MON — chain-verified" },
  USD18: { decimals: 18, note: "internal normalized USD valuation" },
  BPS: { decimals: 0, note: "basis points; 10000 = 100%" },
} as const;

export type UnitKey = keyof typeof UNIT_DEFS;

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Parse a strict decimal string into a scaled BigInt.
 * Rejects exponents, hex, whitespace, bare "."/"" and excess precision.
 */
export function parseDecimal(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
    throw new RangeError(`unsupported decimals: ${decimals}`);
  }
  const m = DECIMAL_RE.exec(value);
  if (m === null) {
    throw new SyntaxError(`not a decimal string: ${JSON.stringify(value)}`);
  }
  const sign = m[1];
  const whole = m[2] as string;
  const frac = m[3] ?? "";
  if (frac.length > decimals) {
    throw new RangeError(
      `${JSON.stringify(value)} has ${frac.length} fractional digits; unit allows ${decimals}`,
    );
  }
  const scaled = BigInt(whole + frac.padEnd(decimals, "0"));
  return sign === "-" ? -scaled : scaled;
}

/** Canonical decimal-string form: no exponent, no trailing zeros, "-0" → "0". */
export function formatDecimal(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
    throw new RangeError(`unsupported decimals: ${decimals}`);
  }
  const neg = value < 0n;
  const abs = (neg ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = abs.slice(0, abs.length - decimals);
  const frac =
    decimals === 0 ? "" : abs.slice(abs.length - decimals).replace(/0+$/, "");
  const out = frac === "" ? whole : `${whole}.${frac}`;
  return neg && out !== "0" ? `-${out}` : out;
}

export function parseUnit(value: string, unit: UnitKey): bigint {
  return parseDecimal(value, UNIT_DEFS[unit].decimals);
}

export function formatUnit(value: bigint, unit: UnitKey): string {
  return formatDecimal(value, UNIT_DEFS[unit].decimals);
}
