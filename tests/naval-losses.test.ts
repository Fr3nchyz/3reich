import { describe, expect, it } from "vitest";
import { breakDownFleet, NAVAL_LOSS_CHOICE } from "../src/engine/naval-losses";

describe("spec 12 R1/R12.6 fleet break-down (Ref 21.51, 21.7; N1)", () => {
  it.each<[number, number, number[], number]>([
    [9, 3, [6], 3], [9, 2, [6, 1], 2], [6, 6, [], 6],
    [9, 0, [9], 0], [9, 1, [6, 2], 1], [9, 4, [2, 2, 1], 4],
    [6, 99, [], 6], [0, 0, [], 0], [18, 0, [9, 9], 0],
    // Greedy largest first would keep 9+2+1; the fewest counters are 6+6.
    [18, 6, [6, 6], 6],
  ])("R1/R12.6 strength %i owing %i keeps %j and loses %i", (strength, owed, counters, lost) => {
    expect(breakDownFleet(strength, owed)).toEqual({ counters, lost });
  });

  it("R1/R12.6 loses more than owed when no exact remainder can be made", () => {
    expect(breakDownFleet(9, 2, [6, 2])).toEqual({ counters: [6], lost: 3 });
    // The largest total wins before considering counter count: keep 2+2, rather than just 3.
    expect(breakDownFleet(6, 2, [3, 2])).toEqual({ counters: [2, 2], lost: 2 });
    expect(breakDownFleet(9, 1, [6])).toEqual({ counters: [6], lost: 3 });
    expect(breakDownFleet(3, 1, [6])).toEqual({ counters: [], lost: 3 });
    expect(breakDownFleet(9, 1, [])).toEqual({ counters: [], lost: 9 });
  });

  it("R1 minimizes counter count even with unsorted, duplicate and non-greedy sizes", () => {
    const sizes = Object.freeze([1, 4, 3, 4]);
    expect(breakDownFleet(9, 3, sizes)).toEqual({ counters: [3, 3], lost: 3 });
    expect(sizes).toEqual([1, 4, 3, 4]);
  });

  it("R12.5 N25 names the owner's loss choice without allocating losses", () => {
    expect(NAVAL_LOSS_CHOICE).toBe("owner");
  });

  it("rejects negative, fractional and nonfinite strength or owed", () => {
    for (const bad of [-1, 0.5, NaN, Infinity]) {
      expect(() => breakDownFleet(bad, 1)).toThrow(RangeError);
      expect(() => breakDownFleet(9, bad)).toThrow(RangeError);
    }
  });

  it("rejects nonpositive, fractional and nonfinite counter sizes, even when all factors are lost", () => {
    for (const bad of [0, -1, 0.5, NaN, Infinity]) {
      expect(() => breakDownFleet(9, 1, [1, bad])).toThrow(RangeError);
      expect(() => breakDownFleet(6, 6, [bad])).toThrow(RangeError);
    }
  });
});
