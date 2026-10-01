import { describe, expect, it } from "vitest";
import { endPlayerTurn, newGame } from "../src/engine/game";
import { fall1939Nations, sideBRPs, spendingLimit } from "../src/engine/nations";
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
});

describe("turn sequence", () => {
  it("gives each side a player turn, then advances the season and year", () => {
    let s = newGame(1);
    expect(s.season).toBe("fall");
    expect(s.activeSide).toBe("axis");
    s = endPlayerTurn(s);
    expect(s.activeSide).toBe("allies");
    s = endPlayerTurn(s);
    expect(s.season).toBe("winter");
    expect(s.year).toBe(1939);
    expect(s.activeSide).toBe("axis");
    s = endPlayerTurn(endPlayerTurn(s));
    expect(s.season).toBe("spring");
    expect(s.year).toBe(1940);
  });
});

describe("Fall 1939 economy", () => {
  const nations = fall1939Nations();
  it("matches the status screen side totals", () => {
    expect(sideBRPs(nations, "axis")).toBe(225);
    expect(sideBRPs(nations, "allies")).toBe(210);
  });
  it("matches the status screen spending limits", () => {
    const limits = Object.fromEntries(Object.values(nations).map((n) => [n.id, spendingLimit(n)]));
    expect(limits).toEqual({ france: 42, britain: 62, usa: 135, ussr: 45, germany: 75, italy: 37 });
  });
});
