import { describe, expect, it } from "vitest";
import {
  ATTRITION_TABLE,
  attritionColumn,
  OFFENSIVE_CRT,
  oddsColumn,
  resolveAttrition,
  resolveOffensiveCombat,
} from "../src/engine/combat";
import { defenseMultiplier } from "../src/engine/terrain";

describe("odds", () => {
  it("ignores fractions and caps at 5:1", () => {
    expect(oddsColumn(12, 6)).toBe("2-1");
    expect(oddsColumn(17, 6)).toBe("2-1");
    expect(oddsColumn(6, 6)).toBe("1-1");
    expect(oddsColumn(40, 4)).toBe("5-1");
  });
  it("rounds weak attacks in the defender's favour and fails below 1:4", () => {
    expect(oddsColumn(6, 12)).toBe("1-2");
    expect(oddsColumn(5, 12)).toBe("1-3");
    expect(oddsColumn(3, 12)).toBe("1-4");
    expect(oddsColumn(2, 12)).toBeNull();
  });
});

describe("offensive CRT", () => {
  it("matches spot checks against the printed table", () => {
    expect(OFFENSIVE_CRT["1-1"]).toEqual(["Ex", "CA", "CA", "Ex", "A", "D"]);
    expect(OFFENSIVE_CRT["2-1"][3]).toBe("CA1");
    expect(OFFENSIVE_CRT["3-1"][2]).toBe("CA3");
    expect(OFFENSIVE_CRT["5-1"]).toEqual(["Ex", "D", "D", "D", "D", "D"]);
  });
  it("auto-eliminates attacks weaker than 1:4", () => {
    const r = resolveOffensiveCombat({ attackFactors: 1, defenseBasicFactors: 3, defenseMultiplier: 2 }, 1);
    expect(r.outcome).toEqual({ kind: "attacker-eliminated" });
    expect(r.rounds[0]!.result).toBe("auto-eliminated");
  });
  it("never ends on a counterattack result and is reproducible", () => {
    for (let seed = 1; seed < 500; seed++) {
      const input = { attackFactors: 6, defenseBasicFactors: 3, defenseMultiplier: 2 };
      const r = resolveOffensiveCombat(input, seed);
      expect(r).toEqual(resolveOffensiveCombat(input, seed));
      const last = r.rounds[r.rounds.length - 1]!.result;
      expect(["A", "D", "Ex", "auto-eliminated"]).toContain(last);
      // Every counterattack round follows an attacker CA result.
      r.rounds.forEach((round, i) => {
        if (round.by === "defender") expect(r.rounds[i - 1]!.result).toMatch(/^CA/);
      });
    }
  });
  it("uses the forced column for CA1-CA3 counterattacks", () => {
    for (let seed = 1; seed < 2000; seed++) {
      const r = resolveOffensiveCombat({ attackFactors: 12, defenseBasicFactors: 3, defenseMultiplier: 2 }, seed);
      r.rounds.forEach((round, i) => {
        const prev = r.rounds[i - 1]?.result;
        if (round.by === "defender" && prev === "CA2") expect(round.column).toBe("1-2");
        if (round.by === "defender" && prev === "CA1") expect(round.column).toBe("1-1");
      });
    }
  });
});

describe("defence multipliers", () => {
  it("doubles by default, triples in rough terrain, quadruples in fortresses, never stacks", () => {
    expect(defenseMultiplier({ terrain: "plain" })).toBe(2);
    expect(defenseMultiplier({ terrain: "plain", features: ["city"] })).toBe(2);
    expect(defenseMultiplier({ terrain: "mountains" })).toBe(3);
    expect(defenseMultiplier({ terrain: "swamp" })).toBe(3);
    expect(defenseMultiplier({ terrain: "plain", behindRiverOrArrow: true })).toBe(3);
    expect(defenseMultiplier({ terrain: "mountains", behindRiverOrArrow: true })).toBe(3);
    expect(defenseMultiplier({ terrain: "plain", features: ["beach"] })).toBe(2);
    expect(defenseMultiplier({ terrain: "plain", features: ["beach"], seaborneInvasion: true })).toBe(3);
    expect(defenseMultiplier({ terrain: "mountains", fortress: true })).toBe(4);
    expect(defenseMultiplier({ terrain: "plain", features: ["city"], fortress: false })).toBe(2);
  });
});

describe("attrition", () => {
  it("maps factors to columns", () => {
    expect(attritionColumn(0)).toBeNull();
    expect(attritionColumn(1)).toBe("1-10");
    expect(attritionColumn(10)).toBe("1-10");
    expect(attritionColumn(11)).toBe("11-20");
    expect(attritionColumn(60)).toBe("51-60");
    expect(attritionColumn(61)).toBe("61+");
  });
  it("matches spot checks against the printed table", () => {
    expect(ATTRITION_TABLE["1-10"][0]).toEqual([1, 0]);
    expect(ATTRITION_TABLE["31-40"][0]).toEqual([4, 3]);
    expect(ATTRITION_TABLE["61+"][5]).toEqual([4, 2]);
    expect(ATTRITION_TABLE["11-20"][5]).toEqual([0, 0]);
  });
  it("resolves reproducibly", () => {
    expect(resolveAttrition(25, 9)).toEqual(resolveAttrition(25, 9));
    expect(resolveAttrition(0, 9).roll).toBeNull();
  });
});
