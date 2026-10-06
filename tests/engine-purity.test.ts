/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

// The engine and its static data must stay deterministic and headless. Browser and Node
// globals are already compile errors (tsconfig.engine.json has no DOM or Node types);
// this test catches the nondeterministic APIs that plain ES2022 still allows.
const sources = {
  ...import.meta.glob("../src/engine/**/*.ts", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../src/data/**/*.ts", { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;

const FORBIDDEN: [RegExp, string][] = [
  [/\bMath\.random\b/, "Math.random (use the seeded RNG in rng.ts)"],
  [/\bDate\.now\b|\bnew Date\b|\bperformance\.now\b/, "clock access"],
  [/\bsetTimeout\b|\bsetInterval\b|\bqueueMicrotask\b/, "timers"],
  [/\bawait\b|\basync\b|\bPromise\b|\bimport\s*\(/, "asynchronous code or dynamic import"],
];

describe("engine purity", () => {
  it("finds the engine sources", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
  });

  for (const [path, text] of Object.entries(sources)) {
    it(`${path} uses no nondeterministic or async APIs`, () => {
      for (const [pattern, what] of FORBIDDEN) expect(pattern.test(text), what).toBe(false);
    });

    it(`${path} imports only from the engine`, () => {
      // Static imports and re-exports, including bare side-effect imports (import "x").
      const imports = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g)].map((m) => m[1]!);
      // Engine modules import each other; data modules import engine types, their own JSON and sibling data modules.
      const allowed = path.includes("/src/engine/") ? /^\.\/[\w-]+$/ : /^(\.\.\/engine\/[\w-]+|\.\/[\w-]+(\.json)?)$/;
      for (const spec of imports) expect(spec, `${path} imports ${spec}`).toMatch(allowed);
    });
  }
});
