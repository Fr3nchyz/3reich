// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig(
  { ignores: ["dist/", "coverage/", "playwright-report/", "test-results/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  // Type-aware rules (they need the TypeScript program) only where tsconfig.json covers the files.
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "scripts/gamedata/**/*.ts"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      // A leading underscore marks a deliberately unused name, e.g. dropping a key with rest destructuring.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  // Off on purpose in these files: `HexId | OffMapBox` is HexId = string plus the literal box names, written out
  // to document that boxes are valid places; collapsing it to `string` would lose that.
  {
    files: ["src/engine/action-types.ts", "src/engine/areas.ts", "src/engine/types.ts"],
    rules: { "@typescript-eslint/no-redundant-type-constituents": "off" },
  },
  // Tests deep-copy states with JSON.parse (typed any) and poke at data on purpose; the unsafe-any family adds noise there.
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  // Size limit from the working rules: files under src/ stay at or under 300 lines of code.
  {
    files: ["src/**/*.ts"],
    rules: { "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }] },
  },
  { files: ["src/**/*.ts"], languageOptions: { globals: globals.browser } },
  { files: ["eslint.config.js", "scripts/**/*.mjs", "scripts/gamedata/**/*.ts", "tests/e2e/**/*.ts", "playwright.config.ts", "vite.config.ts"], languageOptions: { globals: globals.node } },
);
