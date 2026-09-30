/**
 * Lint rules that make JavaScript Number a hard error in code that handles
 * money, prices, quantities or rates (spec §7, AGENTS.md). Shared by every
 * package whose `src/` is economic: import this file, do not copy it.
 *
 * Integer bookkeeping helpers like Number.isInteger / Number.isSafeInteger
 * remain allowed — they inspect a value, they do not produce a float.
 */
const MSG =
  "JavaScript Number is banned for economic values — use bigint and integer decimal strings (packages/domain units/money).";

export const moneyRestrictedSyntax = [
  { selector: "CallExpression[callee.type='Identifier'][callee.name='Number']", message: MSG },
  { selector: "NewExpression[callee.name='Number']", message: MSG },
  { selector: "CallExpression[callee.name=/^parse(Float|Int)$/]", message: MSG },
  { selector: "MemberExpression[object.name='Number'][property.name=/^parse(Float|Int)$/]", message: MSG },
  { selector: "MemberExpression[object.name='Math']", message: MSG },
  { selector: "CallExpression[callee.property.name=/^(toFixed|toPrecision)$/]", message: MSG },
  { selector: "UnaryExpression[operator='+']", message: MSG },
  { selector: "Literal[raw=/^[0-9]*\\.[0-9]|e/i][value>0]", message: MSG },
];

export const moneyRules = {
  "no-restricted-syntax": ["error", ...moneyRestrictedSyntax],
  "no-restricted-globals": ["error", { name: "parseFloat", message: MSG }, { name: "parseInt", message: MSG }],
};
