import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Spec 05: the computer module imports nothing from the UI, reads no clock or global random, and
// changes the game only through the engine's actions. (The engine importing nothing from src/ai
// is already enforced by engine-purity.test.ts: engine modules may import only each other.)
const dir = fileURLToPath(new URL("../src/ai/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

describe("src/ai boundary", () => {
  it("finds the computer sources", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const f of files) {
    const text = readFileSync(`${dir}${f}`, "utf8");
    it(`${f} imports only the engine and its own modules`, () => {
      const imports = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g)].map((m) => m[1]!);
      for (const spec of imports) expect(spec, `${f} imports ${spec}`).toMatch(/^(\.\.\/engine\/[\w-]+|\.\/[\w-]+)$/);
    });
    it(`${f} is deterministic (no clock, no Math.random, no timers)`, () => {
      expect(/\bMath\.random\b|\bDate\.now\b|\bnew Date\b|\bperformance\.now\b|\bsetTimeout\b|\bsetInterval\b/.test(text)).toBe(false);
    });
  }
});
