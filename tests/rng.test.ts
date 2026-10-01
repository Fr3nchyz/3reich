import { describe, expect, it } from "vitest";
import { rollD6 } from "../src/engine/rng";

describe("rng", () => {
  it("is deterministic for a given seed and stays within 1..6", () => {
    let a = 42, b = 42;
    for (let i = 0; i < 200; i++) {
      const ra = rollD6(a), rb = rollD6(b);
      expect(ra.roll).toBe(rb.roll);
      expect(ra.roll).toBeGreaterThanOrEqual(1);
      expect(ra.roll).toBeLessThanOrEqual(6);
      a = ra.state; b = rb.state;
    }
  });

  it("rolls each face about equally often", () => {
    const counts = [0, 0, 0, 0, 0, 0];
    let s = 12345;
    const n = 60000;
    for (let i = 0; i < n; i++) {
      const r = rollD6(s);
      counts[r.roll - 1]!++;
      s = r.state;
    }
    // Expected 10,000 each; the standard deviation is about 91, so +-500 is over 5 sigma.
    for (const c of counts) expect(Math.abs(c - n / 6)).toBeLessThan(500);
  });
});
