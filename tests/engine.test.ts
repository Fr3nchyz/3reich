import { describe, expect, it } from "vitest";
import { oddsColumn, resolveCombat } from "../src/engine/combat";
import { endPowerTurn, newGame, TURN_ORDER } from "../src/engine/game";
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

describe("combat", () => {
  it("clamps odds columns", () => {
    expect(oddsColumn(1, 10)).toBe(1);
    expect(oddsColumn(100, 1)).toBe(4);
    expect(oddsColumn(0, 5)).toBe(1);
  });
  it("resolves reproducibly", () => {
    expect(resolveCombat(6, 3, 7)).toEqual(resolveCombat(6, 3, 7));
  });
});

describe("turn sequence", () => {
  it("advances season and year after the last power acts", () => {
    let s = newGame(1);
    expect(s.season).toBe("fall");
    for (let i = 0; i < TURN_ORDER.length; i++) s = endPowerTurn(s);
    expect(s.season).toBe("winter");
    expect(s.year).toBe(1939);
    for (let i = 0; i < TURN_ORDER.length; i++) s = endPowerTurn(s);
    expect(s.season).toBe("spring");
    expect(s.year).toBe(1940);
    expect(s.activePower).toBe(TURN_ORDER[0]);
  });
});
