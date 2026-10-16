import { describe, expect, it } from "vitest";
import { AIR_COMBAT_RULES, type AirCombatRules } from "../src/engine/air-combat";
import { type AirCounter, applyAirLosses, autoAirLosses, breakDownAirUnit } from "../src/engine/air-losses";

describe("R6/R7 break-down of a lost counter (Ref 20.6, errata)", () => {
  // Sizes 1, 2, 3, 5: the unit left is the largest size not above strength - owed.
  const cases: [number, number, number, number][] = [
    // strength, owed, remaining, lost
    [5, 0, 5, 0],
    [5, 1, 3, 2], // the manual's example: 1 factor from a 5-4 takes 2, leaving a 3-4
    [5, 2, 3, 2],
    [5, 3, 2, 3],
    [5, 4, 1, 4],
    [5, 5, 0, 5],
    [3, 1, 2, 1],
    [3, 2, 1, 2],
    [3, 3, 0, 3],
    [2, 1, 1, 1],
    [1, 1, 0, 1],
    [3, 9, 0, 3],
  ];
  for (const [strength, owed, remaining, lost] of cases) {
    it(`R6 a ${strength} that owes ${owed} keeps ${remaining} and loses ${lost}`, () => {
      expect(breakDownAirUnit(strength, owed)).toEqual({ remaining, lost });
    });
  }
  it("refuses a non-integer or NaN amount or strength instead of guessing", () => {
    expect(() => breakDownAirUnit(5, Number.NaN)).toThrow(RangeError);
    expect(() => breakDownAirUnit(5, 1.5)).toThrow(RangeError);
    expect(() => breakDownAirUnit(Number.NaN, 1)).toThrow(RangeError);
    expect(() => breakDownAirUnit(2.5, 1)).toThrow(RangeError);
    expect(() => breakDownAirUnit(-1, 1)).toThrow(RangeError);
  });
  // lossMayExceedOwed is a TODO(verify) switch that is ON. Turned off, the break-down is skipped altogether: the
  // unit keeps strength - owed, which can be a size no counter has (a 4). It only matters if someone flips the switch.
  it("lossMayExceedOwed off: exactly the factors owed, even a size no counter has (documented, not a rule)", () => {
    const rules: AirCombatRules = { ...AIR_COMBAT_RULES, lossMayExceedOwed: false };
    expect(breakDownAirUnit(5, 1, rules)).toEqual({ remaining: 4, lost: 1 });
  });
  it("a different set of counter sizes changes the break-down (4 exists)", () => {
    const rules: AirCombatRules = { ...AIR_COMBAT_RULES, counterSizes: [1, 2, 3, 4, 5] };
    expect(breakDownAirUnit(5, 1, rules)).toEqual({ remaining: 4, lost: 1 });
  });
});

describe("R7 owner's choice of losses (Ref 20.44)", () => {
  const pool = [
    { id: "a", strength: 5 },
    { id: "b", strength: 1 },
    { id: "c", strength: 3 },
  ];
  it("applies a legal choice with break-down: 1 from the 5 loses 2", () => {
    expect(applyAirLosses(pool, [{ id: "a", factors: 1 }], 1)).toEqual({ applied: [{ id: "a", remaining: 3, lost: 2 }], lost: 2 });
  });
  it("applies a mixed choice: the whole 1 and 2 of the 3", () => {
    expect(applyAirLosses(pool, [{ id: "b", factors: 1 }, { id: "c", factors: 2 }], 3)).toEqual({
      applied: [
        { id: "b", remaining: 0, lost: 1 },
        { id: "c", remaining: 1, lost: 2 },
      ],
      lost: 3,
    });
  });
  it("refuses a wrong total, an unknown unit, a repeat, zero, and more than the unit has", () => {
    const problem = (take: { id: string; factors: number }[], owed: number) => applyAirLosses(pool, take, owed);
    expect(problem([{ id: "a", factors: 1 }], 2)).toHaveProperty("problem");
    expect(problem([{ id: "a", factors: 3 }], 2)).toHaveProperty("problem");
    expect(problem([{ id: "z", factors: 1 }], 1)).toHaveProperty("problem");
    expect(problem([{ id: "a", factors: 1 }, { id: "a", factors: 1 }], 2)).toHaveProperty("problem");
    expect(problem([{ id: "b", factors: 0 }], 0)).toHaveProperty("problem");
    expect(problem([{ id: "b", factors: 2 }], 2)).toHaveProperty("problem");
    expect(problem([{ id: "b", factors: 0.5 }], 0.5)).toHaveProperty("problem");
  });
});

describe("the computer's choice of air losses: fewest units broken, smallest first (spec 09 R7 option b)", () => {
  const pool = [
    { id: "a", strength: 5 },
    { id: "b", strength: 1 },
    { id: "c", strength: 3 },
  ];
  it("takes nothing for nothing and everything for more than the pool", () => {
    expect(autoAirLosses(pool, 0)).toEqual([]);
    expect(autoAirLosses(pool, -2)).toEqual([]);
    expect(autoAirLosses(pool, 99)).toEqual([{ id: "b", factors: 1 }, { id: "c", factors: 3 }, { id: "a", factors: 5 }]);
  });
  it("whole counters when they add up (smallest first): 1, 4 = 1+3, 6 = 1+5, 8 = 3+5", () => {
    expect(autoAirLosses(pool, 1)).toEqual([{ id: "b", factors: 1 }]);
    expect(autoAirLosses(pool, 4)).toEqual([{ id: "b", factors: 1 }, { id: "c", factors: 3 }]);
    expect(autoAirLosses(pool, 6)).toEqual([{ id: "b", factors: 1 }, { id: "a", factors: 5 }]);
    expect(autoAirLosses(pool, 8)).toEqual([{ id: "c", factors: 3 }, { id: "a", factors: 5 }]);
  });
  it("one counter broken when none add up: owed 2 from 1,3,5 is the 1 and 1 of the 3 (3 breaks to 2, loses 1)", () => {
    expect(autoAirLosses(pool, 2)).toEqual([{ id: "b", factors: 1 }, { id: "c", factors: 1 }]);
  });
  it("[2,5] owed 3: 3 from the 5 (5 breaks to 2, loses exactly 3), not 2 whole + 1 from the 5 (loses 4)", () => {
    const two: AirCounter[] = [{ id: "p", strength: 2 }, { id: "q", strength: 5 }];
    const take = autoAirLosses(two, 3);
    expect(take).toEqual([{ id: "q", factors: 3 }]);
    expect(applyAirLosses(two, take, 3)).toEqual({ applied: [{ id: "q", remaining: 2, lost: 3 }], lost: 3 });
  });
  it("equal counters go by id; the result is a legal choice", () => {
    const twins = [{ id: "y", strength: 3 }, { id: "x", strength: 3 }];
    const take = autoAirLosses(twins, 4);
    expect(take).toEqual([{ id: "x", factors: 3 }, { id: "y", factors: 1 }]);
    expect(applyAirLosses(twins, take, 4)).not.toHaveProperty("problem");
  });
  it("is deterministic: the same pool in any order gives the same choice", () => {
    expect(autoAirLosses([...pool].reverse(), 2)).toEqual(autoAirLosses(pool, 2));
  });

  // The old policy (smallest whole counters first, then break the next one) and an independent
  // brute-force oracle, written in the test: every way to take exactly `owed` factors.
  const size = (n: number) => [5, 3, 2, 1].find((s) => s <= n) ?? 0; // largest counter not above n
  const lostFrom = (s: number, t: number) => (t >= s ? s : t <= 0 ? 0 : s - size(s - t));
  function oldPolicy(p: AirCounter[], owed: number): number {
    let left = owed;
    let lost = 0;
    for (const u of [...p].sort((x, y) => x.strength - y.strength)) {
      if (left <= 0) break;
      const t = Math.min(u.strength, left);
      lost += lostFrom(u.strength, t);
      left -= t;
    }
    return lost;
  }
  function exactExists(p: AirCounter[], owed: number): boolean {
    const go = (i: number, left: number): boolean => {
      if (i === p.length) return left === 0;
      for (let t = 0; t <= Math.min(p[i]!.strength, left); t++) if (lostFrom(p[i]!.strength, t) <= t && go(i + 1, left - t)) return true;
      return false;
    };
    return go(0, owed);
  }
  it("sweep: never loses more than the old policy, and loses exactly the amount owed whenever some choice does", () => {
    const sizes = [1, 2, 3, 5];
    let pools = 0;
    for (let n = 1; n <= 4; n++) {
      const walk = (prefix: number[]) => {
        if (prefix.length === n) {
          const p = prefix.map((strength, i) => ({ id: `u${i}`, strength }));
          const total = prefix.reduce((x, y) => x + y, 0);
          pools++;
          for (let owed = 1; owed <= total; owed++) {
            const take = autoAirLosses(p, owed);
            const res = applyAirLosses(p, take, owed);
            expect(res, `pool ${prefix.join("+")} owed ${owed}`).not.toHaveProperty("problem");
            const lost = (res as { lost: number }).lost;
            expect(lost, `pool ${prefix.join("+")} owed ${owed}`).toBeGreaterThanOrEqual(owed);
            expect(lost, `pool ${prefix.join("+")} owed ${owed} vs old`).toBeLessThanOrEqual(oldPolicy(p, owed));
            if (exactExists(p, owed)) expect(lost, `pool ${prefix.join("+")} owed ${owed} exact`).toBe(owed);
          }
          return;
        }
        for (const s of sizes) walk([...prefix, s]);
      };
      walk([]);
    }
    expect(pools).toBe(4 + 16 + 64 + 256);
  });
});
