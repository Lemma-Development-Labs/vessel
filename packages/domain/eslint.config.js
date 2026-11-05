import tseslint from "typescript-eslint";
import { moneyRules } from "./eslint-money-rules.js";

export default tseslint.config(
  { ignores: ["node_modules/**"] },
  {
    files: ["src/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    rules: moneyRules,
  },
);
