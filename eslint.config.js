import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Flat config. Non-type-checked recommended rules — fast, and tsc already
// enforces the type-level guarantees (strict, noUnusedLocals).
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "scripts/**", "src/dashboard/public/**", "data/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
