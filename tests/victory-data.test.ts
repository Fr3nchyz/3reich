import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { VICTORY_1939, VICTORY_1942 } from "../src/data/victory";
import { evaluateVictory } from "../src/engine/victory";
import { verdictName } from "../src/engine/victory-record";
import type { Conquest } from "../src/engine/conquest-record";
import { newGame } from "../src/engine/game";
import { objectiveStandings } from "../src/engine/objectives";
import type { GameState, GameTurn, Scenario } from "../src/engine/types";
import { ctxFor } from "./helpers";
import { withSplit } from "./helpers-victory";

/**
 * The victory numbers against the game's own victory list (Ref 2.1 to 2.4; spec 14 F1, ticket 14-2). The oracle below is the list written out a
 * second time, row by row, in the list's own words ("16 Objectives", "14 or less for the Allies and 24 or less for the Axis"), not in the
 * threshold form src/data/victory.ts uses. It was compared by hand with the list itself (VIC_COND.TXT of the owner's game folder) on 2026-10-21.
 */

type Row = [verdict: string, matches: (allies: number, axis: number) => boolean];
const ROWS_1939: Row[] = [
  ["Allied Decisive Victory", (a) => a >= 17],
  ["Allied Tactical Victory", (a) => a === 16],
  ["Allied Marginal Victory", (a) => a === 15],
  ["Stalemate", (a, x) => a <= 14 && x <= 24],
  ["Axis Marginal Victory", (_a, x) => x === 25],
  ["Axis Tactical Victory", (_a, x) => x === 26],
  ["Axis Decisive Victory", (_a, x) => x >= 27],
];
const ROWS_1939_SIBERIAN: Row[] = [
  ["Allied Decisive Victory", (a) => a >= 18],
  ["Allied Tactical Victory", (a) => a === 17],
  ["Allied Marginal Victory", (a) => a === 16],
  ["Stalemate", (a, x) => a <= 15 && x <= 24],
  ["Axis Marginal Victory", (_a, x) => x === 25],
  ["Axis Tactical Victory", (_a, x) => x === 26],
  ["Axis Decisive Victory", (_a, x) => x >= 27],
];
const ROWS_1942: Row[] = [
  ["Allied Decisive Victory", (a) => a >= 28],
  ["Allied Tactical Victory", (a) => a === 27],
  ["Allied Marginal Victory", (a) => a === 26],
  ["Stalemate", (a, x) => a <= 25 && x <= 13],
  ["Axis Marginal Victory", (_a, x) => x === 14],
  ["Axis Tactical Victory", (_a, x) => x === 15],
  ["Axis Decisive Victory", (_a, x) => x >= 16],
];
const ROWS_1942_SIBERIAN: Row[] = [
  ["Allied Decisive Victory", (a) => a >= 29],
  ["Allied Tactical Victory", (a) => a === 28],
  ["Allied Marginal Victory", (a) => a === 27],
  ["Stalemate", (a, x) => a <= 26 && x <= 13],
  ["Axis Marginal Victory", (_a, x) => x === 14],
  ["Axis Tactical Victory", (_a, x) => x === 15],
  ["Axis Decisive Victory", (_a, x) => x >= 16],
];

describe("the 1939 and 1942 tables, every split of the Objectives somebody can hold (Ref 2.1, 2.2, 11.63)", () => {
  const cases: [string, Scenario, boolean, Row[]][] = [
    ["1939", SCENARIO_1939, false, ROWS_1939],
    ["1939 with the Free Siberian Transfer", SCENARIO_1939, true, ROWS_1939_SIBERIAN],
    ["1942", SCENARIO_1942, false, ROWS_1942],
    ["1942 with the Free Siberian Transfer", SCENARIO_1942, true, ROWS_1942_SIBERIAN],
  ];
  for (const [name, scenario, siberian, rows] of cases) {
    it(`${name}: exactly one row of the list matches, and the result is that row`, () => {
      const ctx = ctxFor(scenario);
      const total = objectiveStandings(ctx, newGame(scenario, 1));
      const held = total.axis.length + total.allies.length;
      for (let a = 0; a <= held; a++) {
        const state = withSplit(scenario, a, siberian);
        const r = evaluateVictory(ctx, state, "end-of-play");
        expect([r.objectives.allies, r.objectives.axis]).toEqual([a, held - a]);
        const matching = rows.filter(([, m]) => m(a, held - a)).map(([v]) => v);
        expect(matching, `Allies ${a}, Axis ${held - a}`).toHaveLength(1);
        expect(verdictName(r), `Allies ${a}, Axis ${held - a}`).toBe(matching[0]);
      }
    });
  }

  it("the 1939 start (Allies 23, Axis 9) is an Allied Decisive Victory and the 1942 start (Allies 14, Axis 25) an Axis Decisive one", () => {
    expect(verdictName(evaluateVictory(ctxFor(SCENARIO_1939), newGame(SCENARIO_1939, 1), "end-of-play"))).toBe("Allied Decisive Victory");
    expect(verdictName(evaluateVictory(ctxFor(SCENARIO_1942), newGame(SCENARIO_1942, 1), "end-of-play"))).toBe("Axis Decisive Victory");
  });

  it("the Transfer changes only the Allied numbers (one more at each level) and the Axis numbers are the same", () => {
    for (const rules of [VICTORY_1939, VICTORY_1942]) {
      if (rules.kind !== "objectives") throw new Error("not an Objectives table");
      for (const level of ["marginal", "tactical", "decisive"] as const) {
        expect(rules.siberian.allies[level]).toBe(rules.plain.allies[level] + 1);
        expect(rules.siberian.axis[level]).toBe(rules.plain.axis[level]);
      }
    }
  });

  it("all four scenarios carry their rules: Objectives for 1939 and 1942, Germany's fall for 1944, conquest of the Axis for the Campaign", () => {
    expect([SCENARIO_1939, SCENARIO_1942, SCENARIO_1944, SCENARIO_CAMPAIGN].map((s) => s.victory.kind)).toEqual(["objectives", "objectives", "germany-falls", "campaign"]);
  });
});

const at = (year: number, season: GameTurn["season"]): GameTurn => ({ year, season });
const conquest = (country: Conquest["country"], when: GameTurn): Conquest => ({ country, by: "britain", side: "axis", how: "capital", at: when });
const standing = (scenario: Scenario, when: GameTurn, conquests: Conquest[], more: Partial<GameState> = {}): GameState => ({ ...newGame(scenario, 1), ...when, conquests, ...more });
const verdictAt = (scenario: Scenario, when: GameTurn, conquests: Conquest[], more: Partial<GameState> = {}) =>
  verdictName(evaluateVictory(ctxFor(scenario), standing(scenario, when, conquests, more), "end-of-play"));

describe("the 1944 table, by the Game Turn in which Germany is conquered (Ref 2.3)", () => {
  // The list: in/before Winter 1944 Allied Decisive; Spring 1945 Tactical; Summer 1945 Marginal; Fall 1945 Axis Marginal; Winter 1945 Axis Tactical; Spring 1946 Axis Decisive.
  const LIST: [GameTurn, string][] = [
    [at(1944, "spring"), "Allied Decisive Victory"],
    [at(1944, "summer"), "Allied Decisive Victory"],
    [at(1944, "fall"), "Allied Decisive Victory"],
    [at(1944, "winter"), "Allied Decisive Victory"],
    [at(1945, "spring"), "Allied Tactical Victory"],
    [at(1945, "summer"), "Allied Marginal Victory"],
    [at(1945, "fall"), "Axis Marginal Victory"],
    [at(1945, "winter"), "Axis Tactical Victory"],
    [at(1946, "spring"), "Axis Decisive Victory"],
  ];
  it("every Game Turn from Spring 1944 to Spring 1946 gives the listed verdict, at once (the early end) and at the end of play", () => {
    for (const [when, verdict] of LIST) {
      const state = standing(SCENARIO_1944, when, [conquest("germany", when)]);
      expect(verdictName(evaluateVictory(ctxFor(SCENARIO_1944), state, "after-conquest")!), label(when)).toBe(verdict);
      expect(verdictAt(SCENARIO_1944, when, [conquest("germany", when)]), label(when)).toBe(verdict);
    }
  });
});

const label = (t: GameTurn) => `${t.season} ${t.year}`;

describe("the Campaign table, by the Game Turn in which the Axis (Germany and Italy) is conquered (Ref 2.4, 11.63)", () => {
  // The list: in/before Summer 1944 Decisive; Fall or Winter 1944 Tactical; Spring or Summer 1945 Marginal. With the Transfer: in/before Spring 1944; Summer or Fall 1944; Winter 1944 or Spring 1945.
  const PLAIN: [GameTurn, string][] = [
    [at(1940, "spring"), "Allied Decisive Victory"],
    [at(1944, "spring"), "Allied Decisive Victory"],
    [at(1944, "summer"), "Allied Decisive Victory"],
    [at(1944, "fall"), "Allied Tactical Victory"],
    [at(1944, "winter"), "Allied Tactical Victory"],
    [at(1945, "spring"), "Allied Marginal Victory"],
    [at(1945, "summer"), "Allied Marginal Victory"],
  ];
  const SIBERIAN: [GameTurn, string][] = [
    [at(1940, "spring"), "Allied Decisive Victory"],
    [at(1944, "spring"), "Allied Decisive Victory"],
    [at(1944, "summer"), "Allied Tactical Victory"],
    [at(1944, "fall"), "Allied Tactical Victory"],
    [at(1944, "winter"), "Allied Marginal Victory"],
    [at(1945, "spring"), "Allied Marginal Victory"],
  ];
  const both = (when: GameTurn) => [conquest("italy", at(1943, "fall")), conquest("germany", when)];
  it("without the Transfer", () => {
    for (const [when, verdict] of PLAIN) expect(verdictAt(SCENARIO_CAMPAIGN, when, both(when)), label(when)).toBe(verdict);
  });
  it("with the Transfer, every Allied date is one Game Turn earlier", () => {
    const siberian = { siberian: { used: true, taken: {} } };
    for (const [when, verdict] of SIBERIAN) expect(verdictAt(SCENARIO_CAMPAIGN, when, both(when), siberian), label(when)).toBe(verdict);
  });
  it("the date is the later of the two conquests: Italy first, Germany last", () => {
    expect(verdictAt(SCENARIO_CAMPAIGN, at(1945, "summer"), [conquest("germany", at(1944, "spring")), conquest("italy", at(1945, "summer"))])).toBe("Allied Marginal Victory");
  });
});
