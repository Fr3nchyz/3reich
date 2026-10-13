/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// base "./" lets the built game run from any path (Vercel, a USB stick, file server).
export default defineConfig({
  base: "./",
  test: {
    // Playwright specs live in tests/e2e and run with `npm run e2e`, not under vitest.
    exclude: ["**/node_modules/**", "dist/**", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      include: ["src/engine/**"],
      reporter: ["text-summary", "text", "html"],
      // Floors for the rules engine only, a few points under what is measured today.
      thresholds: { statements: 95, lines: 95, branches: 83, functions: 94 },
    },
  },
});
