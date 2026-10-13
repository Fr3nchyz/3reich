import { describe, expect, it } from "vitest";
import {
  ATTRITION_COLUMNS,
  ATTRITION_TABLE,
  attritionColumn,
  ODDS_COLUMNS,
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
  it("puts exact ratios on their own column", () => {
    expect(oddsColumn(1, 4)).toBe("1-4");
    expect(oddsColumn(1, 3)).toBe("1-3");
    expect(oddsColumn(2, 6)).toBe("1-3");
    expect(oddsColumn(1, 2)).toBe("1-2");
    expect(oddsColumn(4, 9)).toBe("1-3");
    expect(oddsColumn(5, 9)).toBe("1-2");
    expect(oddsColumn(1, 5)).toBeNull();
    expect(oddsColumn(25, 5)).toBe("5-1");
  });
  // The original program's odds routine (3R2.EXE, decoded with scripts/gamedata/tables.ts; see
  // docs/GAME_DATA.md) divides attack by defence in single precision and compares the ratio with
  // these lower bounds, one per column from 1-4 to 5-1. Below 1/4 the attacker is eliminated.
  // This settles the old TODO(verify) on rounding below 1:1.
  it("matches the original program's odds thresholds for every attack and defence up to 80", () => {
    const lowerBounds = [1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 5];
    const gameColumn = (a: number, d: number) => {
      const ratio = Math.fround(a / d);
      let column: (typeof ODDS_COLUMNS)[number] | null = null;
      lowerBounds.forEach((bound, i) => {
        if (ratio >= bound) column = ODDS_COLUMNS[i]!;
      });
      return column;
    };
    for (let a = 1; a <= 80; a++) for (let d = 1; d <= 80; d++) expect(oddsColumn(a, d), `${a} vs ${d}`).toBe(gameColumn(a, d));
  });
});

describe("offensive CRT", () => {
  // Every cell, transcribed by die roll from the game's own chart screen (TABLE5.TAB) and from the
  // table its combat code reads in 3R2.EXE, which is also stored by die roll (docs/GAME_DATA.md).
  // Columns: 1-4 1-3 1-2 1-1 2-1 3-1 4-1 5-1.
  const BY_ROLL = [
    "Ex Ex  Ex  Ex Ex  Ex  Ex  Ex",
    "A  Ex  Ex  CA CA2 CA2 CA3 D",
    "A  A   CA  CA CA2 CA3 D   D",
    "A  A   A   Ex CA1 D   D   D",
    "A  A   A   A  D   D   D   D",
    "A  A   A   D  D   D   D   D",
  ].map((row) => row.split(/\s+/));

  it("matches the game's chart and data table in every cell", () => {
    BY_ROLL.forEach((row, r) =>
      ODDS_COLUMNS.forEach((col, c) => expect(OFFENSIVE_CRT[col][r], `${col} roll ${r + 1}`).toBe(row[c])),
    );
  });
  it("has the shape of the printed table", () => {
    for (const col of ODDS_COLUMNS) {
      expect(OFFENSIVE_CRT[col]).toHaveLength(6);
      expect(OFFENSIVE_CRT[col][0]).toBe("Ex");
    }
    // Better odds never give the attacker more eliminations or fewer defender eliminations.
    const count = (col: (typeof ODDS_COLUMNS)[number], r: string) => OFFENSIVE_CRT[col].filter((x) => x === r).length;
    for (let i = 1; i < ODDS_COLUMNS.length; i++) {
      expect(count(ODDS_COLUMNS[i]!, "A")).toBeLessThanOrEqual(count(ODDS_COLUMNS[i - 1]!, "A"));
      expect(count(ODDS_COLUMNS[i]!, "D")).toBeGreaterThanOrEqual(count(ODDS_COLUMNS[i - 1]!, "D"));
    }
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
  // The same three forced columns are in the original program's combat routine (GAME_DATA.md).
  it("uses the forced column for CA1-CA3 counterattacks", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 2000; seed++) {
      for (const attackFactors of [12, 18]) {
        const r = resolveOffensiveCombat({ attackFactors, defenseBasicFactors: 3, defenseMultiplier: 2 }, seed);
        r.rounds.forEach((round, i) => {
          const prev = r.rounds[i - 1]?.result;
          if (round.by !== "defender" || !prev) return;
          seen.add(prev);
          if (prev === "CA1") expect(round.column).toBe("1-1");
          if (prev === "CA2") expect(round.column).toBe("1-2");
          if (prev === "CA3") expect(round.column).toBe("1-3");
        });
      }
    }
    expect([...seen].sort()).toEqual(["CA1", "CA2", "CA3"]);
  });
});

describe("defence multipliers", () => {
  // Matches the game's own terrain effects chart screen (TABLE11.TAB).
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
  // Every cell, by die roll, from the game's own chart screen (TABLE2.TAB) and the two tables its
  // attrition code reads in 3R2.EXE (units and hexes, each stored by die roll; GAME_DATA.md).
  // Columns: 1-10 11-20 21-30 31-40 41-50 51-60 61+. "3/1" = 3 units eliminated, 1 hex vacated.
  it("matches the game's chart and data tables in every cell", () => {
    const BY_ROLL = [
      "1/0 2/1 3/2 4/3 5/4 6/4 7/4",
      "1/0 2/0 3/1 4/2 5/3 6/3 7/3",
      "0/0 1/1 3/0 4/1 5/2 6/2 7/2",
      "0/0 1/0 2/1 3/1 4/1 5/2 6/2",
      "0/0 1/0 2/0 3/0 3/1 4/1 5/2",
      "0/0 0/0 1/0 2/0 3/0 4/1 4/2",
    ].map((row) => row.split(" ").map((cell) => cell.split("/").map(Number)));
    BY_ROLL.forEach((row, r) =>
      ATTRITION_COLUMNS.forEach((col, c) => expect(ATTRITION_TABLE[col][r], `${col} roll ${r + 1}`).toEqual(row[c])),
    );
  });
  it("never asks for fewer losses with more factors or a lower roll", () => {
    ATTRITION_COLUMNS.forEach((col, c) => {
      for (let r = 0; r < 6; r++) {
        const [units, hexes] = ATTRITION_TABLE[col][r]!;
        expect(hexes).toBeLessThanOrEqual(units);
        if (r > 0) expect(units).toBeLessThanOrEqual(ATTRITION_TABLE[col][r - 1]![0]);
        if (c > 0) expect(units).toBeGreaterThanOrEqual(ATTRITION_TABLE[ATTRITION_COLUMNS[c - 1]!][r]![0]);
      }
    });
  });
  // The game picks the column as (factors - 1) / 10 rounded down, capped at the last column.
  it("uses the game's column bands", () => {
    for (let n = 1; n <= 100; n++) expect(attritionColumn(n)).toBe(ATTRITION_COLUMNS[Math.min(6, Math.floor((n - 1) / 10))]);
  });
  it("resolves reproducibly", () => {
    expect(resolveAttrition(25, 9)).toEqual(resolveAttrition(25, 9));
    expect(resolveAttrition(0, 9).roll).toBeNull();
  });
});
