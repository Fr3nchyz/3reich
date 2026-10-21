import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { newGame } from "../src/engine/game";
import type { GameState, Scenario } from "../src/engine/types";
import { victoryTarget } from "../src/engine/victory";
import type { ConquestWindow, GameResult } from "../src/engine/victory-record";
import { decidedBy, frontTitle, needLines, needsText, rowLabel, scoreLine, verdictMeaning, windowText } from "../src/ui/endText";
import { ctxFor } from "./helpers";
import { withCounts } from "./helpers-victory";

// Spec 14 part D1, D2 (ticket 14-4): the words of the victory screens. The numbers come from the engine (victoryTarget, Ref 2.1 to 2.4); the sentences are ours.
// Every test goes through victoryTarget on a real state, so a UI that worked a number out for itself would be caught when the two disagreed.

const t = (year: number, season: "spring" | "summer" | "fall" | "winter") => ({ year, season });
const result = (over: Partial<GameResult>): GameResult => ({ winner: "allies", level: "marginal", basis: "objectives", objectives: { axis: 24, allies: 15, nobody: 3 }, at: t(1942, "summer"), early: false, siberian: false, ...over });
const target = (scenario: Scenario, state: GameState) => victoryTarget(ctxFor(scenario), state);
const at1939 = (allies: number, axis: number, siberian = false) => target(SCENARIO_1939, withCounts(SCENARIO_1939, allies, axis, siberian));

describe("the score line and the verdict", () => {
  it("says the three counts in words", () => expect(scoreLine({ axis: 17, allies: 21, nobody: 4 })).toBe("Objectives held: Axis 17, Allies 21, nobody 4"));
  it("gives each level a plain meaning, for either side, and a draw for a Stalemate", () => {
    expect(verdictMeaning({ winner: "allies", level: "marginal" })).toBe("(a small win for the Allies)");
    expect(verdictMeaning({ winner: "axis", level: "tactical" })).toBe("(a clear win for the Axis)");
    expect(verdictMeaning({ winner: "allies", level: "decisive" })).toBe("(a complete win for the Allies)");
    expect(verdictMeaning({ winner: null, level: null })).toBe("(a draw: neither side won)");
  });
  it("names a block of the card and a row for a screen reader", () => {
    expect(frontTitle("western", 14)).toBe("Western Front (14)");
    expect(rowLabel("Berlin", "Axis")).toBe("Berlin: Axis. Show on the map.");
  });
});

describe("what the winner needed (D2: 'The Allies needed 15 for a Marginal victory. They needed 16 for a Tactical victory (1 more).')", () => {
  it("names the level won and the next one with how many more", () => {
    expect(needLines(result({}), at1939(15, 24))).toEqual(["The Allies needed 15 for a Marginal victory.", "They needed 16 for a Tactical victory (1 more)."]);
  });
  it("says nothing of a next level at Decisive", () => {
    expect(needLines(result({ level: "decisive" }), at1939(23, 9))).toEqual(["The Allies needed 17 for a Decisive victory."]);
  });
  it("for the Axis uses the Axis numbers", () => {
    expect(needLines(result({ winner: "axis", level: "marginal" }), at1939(14, 25))).toEqual(["The Axis needed 25 for a Marginal victory.", "They needed 26 for a Tactical victory (1 more)."]);
  });
  it("with the Free Siberian Transfer the Allied numbers are one higher", () => {
    expect(needLines(result({ siberian: true }), at1939(16, 24, true))).toEqual(["The Allies needed 16 for a Marginal victory.", "They needed 17 for a Tactical victory (1 more)."]);
  });
  it("for a Stalemate says what each side missed", () => {
    expect(needLines({ winner: null, level: null }, at1939(14, 20))).toEqual(["The Allies needed 15 for a Marginal victory (1 more).", "The Axis needed 25 for a Marginal victory (5 more)."]);
  });
  it("has nothing to say for the scenarios decided by conquest", () => {
    expect(needLines(result({}), target(SCENARIO_1944, newGame(SCENARIO_1944, 1)))).toEqual([]);
    expect(needLines(result({}), target(SCENARIO_CAMPAIGN, newGame(SCENARIO_CAMPAIGN, 1)))).toEqual([]);
  });
});

describe("Game Turn windows (the date tables)", () => {
  const w = (from: ConquestWindow["from"], to: ConquestWindow["to"]): ConquestWindow => ({ winner: "allies", level: "decisive", from, to });
  it("reads one turn, a range inside a year, a range across a year, and 'in or before'", () => {
    expect(windowText(w(undefined, t(1944, "winter")))).toBe("in or before Winter 1944");
    expect(windowText(w(t(1945, "spring"), t(1945, "spring")))).toBe("in Spring 1945");
    expect(windowText(w(t(1944, "fall"), t(1944, "winter")))).toBe("in Fall or Winter 1944");
    expect(windowText(w(t(1944, "winter"), t(1945, "spring")))).toBe("in Winter 1944 or Spring 1945");
  });
});

describe("what each side needs (the last block of the Objectives card)", () => {
  it("1939 and 1942: the numbers of the table, with the Transfer one higher for the Allies", () => {
    expect(needsText(at1939(23, 9), t(1942, "summer"))).toEqual({
      title: "What each side needs when Summer 1942 ends",
      lines: ["Allies: 15 = Marginal, 16 = Tactical, 17 = Decisive", "Axis: 25 = Marginal, 26 = Tactical, 27 = Decisive", "In between: Stalemate."],
    });
    expect(needsText(at1939(23, 9, true), t(1942, "summer")).lines[0]).toBe("Allies: 16 = Marginal, 17 = Tactical, 18 = Decisive");
    expect(needsText(target(SCENARIO_1942, newGame(SCENARIO_1942, 1)), t(1944, "winter")).lines[1]).toBe("Axis: 14 = Marginal, 15 = Tactical, 16 = Decisive");
  });
  it("1944: the sentences of D1", () => {
    expect(needsText(target(SCENARIO_1944, newGame(SCENARIO_1944, 1)), t(1946, "spring")).lines.slice(0, 2)).toEqual([
      "The Allies win by conquering Germany: Decisive in or before Winter 1944, Tactical in Spring 1945, Marginal in Summer 1945.",
      "The Axis wins by holding on: Marginal if Germany falls in Fall 1945, Tactical in Winter 1945, Decisive in Spring 1946 or later.",
    ]);
  });
  it("the Campaign: the Allied dates (also with the Transfer) and the three Axis ways", () => {
    const plain = needsText(target(SCENARIO_CAMPAIGN, newGame(SCENARIO_CAMPAIGN, 1)), t(1945, "summer")).lines;
    expect(plain[0]).toBe("The Allies win by conquering Germany and Italy: Decisive in or before Summer 1944, Tactical in Fall or Winter 1944, Marginal in Spring or Summer 1945.");
    expect(plain[1]).toBe("If they do not, the Axis wins: Decisive by conquering three Allied Major Powers, Tactical by conquering two, Marginal by holding 28 or more Objectives when Winter 1943 ends.");
    const siberian = { ...newGame(SCENARIO_CAMPAIGN, 1), siberian: { used: true, taken: {} } };
    expect(needsText(target(SCENARIO_CAMPAIGN, siberian), t(1945, "summer")).lines[0]).toBe("The Allies win by conquering Germany and Italy: Decisive in or before Spring 1944, Tactical in Summer or Fall 1944, Marginal in Winter 1944 or Spring 1945.");
  });
});

describe("what decided a game that did not end on Objectives", () => {
  const campaign = target(SCENARIO_CAMPAIGN, newGame(SCENARIO_CAMPAIGN, 1)).axis;
  it("names the country, the turn and the powers conquered", () => {
    expect(decidedBy("germany-falls", result({ basis: "conquest", at: t(1944, "fall"), early: true }), undefined)).toBe("Germany was conquered in Fall 1944.");
    expect(decidedBy("campaign", result({ basis: "conquest", at: t(1944, "spring") }), undefined, campaign)).toBe("The Axis was conquered in Spring 1944.");
    expect(decidedBy("campaign", result({ basis: "powers-conquered", level: "decisive", winner: "axis" }), undefined, campaign)).toBe("The Axis conquered three Allied Major Powers.");
    expect(decidedBy("campaign", result({ basis: "powers-conquered", level: "tactical", winner: "axis" }), undefined, campaign)).toBe("The Axis conquered two Allied Major Powers.");
    expect(decidedBy("germany-falls", result({ basis: "turn-limit", at: t(1946, "spring"), winner: "axis", level: "decisive" }), undefined)).toBe("Germany was still standing when the scenario ended after Spring 1946.");
    expect(decidedBy("campaign", result({ basis: "objectives", winner: "axis" }), 28, campaign)).toBe("The Axis held 28 Objectives when Winter 1943 ended.");
  });
});
