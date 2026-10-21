import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { newGame } from "../src/engine/game";
import type { GameState, Scenario } from "../src/engine/types";
import type { GameResult } from "../src/engine/victory-record";
import { endCard, endHtml, endShown, statusText } from "../src/ui/endCard";
import { newSession, type Session } from "../src/ui/session";
import { statusHtml } from "../src/ui/statusView";
import { withCounts } from "./helpers-victory";
import { ctxFor } from "./helpers";

// Spec 14 part D2 (ticket 14-4): the result card. Ref 2.0 to 2.4 give the numbers; the card says them in plain words.

const over = (scenario: Scenario, state: GameState, result: GameResult): Session => {
  const s = newSession(scenario, "axis", 1);
  s.state = { ...state, phase: "game-over", result };
  return s;
};
const base: GameResult = { winner: "allies", level: "marginal", basis: "objectives", objectives: { axis: 24, allies: 15, nobody: 3 }, at: { year: 1942, season: "summer" }, early: false, siberian: false };

describe("the card of a game ended on Objectives (D2)", () => {
  const ctx = ctxFor(SCENARIO_1939);
  const state = withCounts(SCENARIO_1939, 15, 24);
  it("holds the verdict, why, the counts and what the winner needed", () => {
    expect(endCard(ctx, { ...state, phase: "game-over", result: base })).toEqual({
      label: "Game over",
      title: "Allied Marginal Victory",
      meaning: "(a small win for the Allies)",
      reasons: ["The scenario ended after Summer 1942."],
      counts: "Objectives held: Axis 24, Allies 15, nobody 3",
      needs: ["The Allies needed 15 for a Marginal victory.", "They needed 16 for a Tactical victory (1 more)."],
      siberian: null,
    });
  });
  it("a Stalemate says that neither side reached its target and what each missed", () => {
    const c = endCard(ctx, { ...state, phase: "game-over", result: { ...base, winner: null, level: null, objectives: { axis: 20, allies: 14, nobody: 8 } } })!;
    expect(c.title).toBe("Stalemate");
    expect(c.reasons).toEqual(["Neither side reached its target."]);
    expect(c.needs).toEqual(["The Allies needed 15 for a Marginal victory (1 more).", "The Axis needed 25 for a Marginal victory (5 more)."]);
  });
  it("with the Free Siberian Transfer the Allied numbers are one higher and the card says so", () => {
    const c = endCard(ctx, { ...state, phase: "game-over", result: { ...base, level: "tactical", objectives: { axis: 16, allies: 17, nobody: 9 }, siberian: true } })!;
    expect(c.needs[0]).toBe("The Allies needed 17 for a Tactical victory.");
    expect(c.siberian).toMatch(/Free Siberian Transfer/);
  });
  it("is not there while the game goes on, or for a game over saved without a result", () => {
    expect(endCard(ctx, state)).toBeNull();
    expect(endCard(ctx, { ...state, phase: "game-over" })).toBeNull();
  });
});

describe("the card of a game ended by a conquest or by the Campaign's other tests", () => {
  it("1944, early: the second line says what decided it, and there are no Objective lines to meet", () => {
    const ctx = ctxFor(SCENARIO_1944);
    const c = endCard(ctx, { ...newGame(SCENARIO_1944, 1), phase: "game-over", result: { ...base, winner: "allies", level: "decisive", basis: "conquest", early: true, at: { year: 1944, season: "fall" } } })!;
    expect(c.reasons).toEqual(["Germany was conquered in Fall 1944."]);
    expect(c.needs).toEqual([]);
  });
  it("1944, Germany standing at the end: Axis Decisive, with the reason", () => {
    const c = endCard(ctxFor(SCENARIO_1944), { ...newGame(SCENARIO_1944, 1), phase: "game-over", result: { ...base, winner: "axis", level: "decisive", basis: "turn-limit", at: { year: 1946, season: "spring" } } })!;
    expect(c.title).toBe("Axis Decisive Victory");
    expect(c.reasons).toEqual(["The scenario ended after Spring 1946.", "Germany was still standing when the scenario ended after Spring 1946."]);
  });
  it("the Campaign, Axis Marginal: the checkpoint count is named", () => {
    const state = { ...newGame(SCENARIO_CAMPAIGN, 1), phase: "game-over" as const, victory: { checkpoints: { "1943-winter": 29 } }, result: { ...base, winner: "axis" as const, level: "marginal" as const, at: { year: 1945, season: "summer" as const } } };
    expect(endCard(ctxFor(SCENARIO_CAMPAIGN), state)!.reasons).toEqual(["The scenario ended after Summer 1945.", "The Axis held 29 Objectives when Winter 1943 ended."]);
  });
});

describe("the dialog", () => {
  const s = over(SCENARIO_1939, withCounts(SCENARIO_1939, 15, 24), base);
  const html = endHtml(s);
  it("is a labelled dialog with the verdict as its heading and three buttons", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="end-title"');
    expect(html).toMatch(/<h2 id="end-title" tabindex="-1">Allied Marginal Victory<\/h2>/);
    for (const id of ["end-look", "end-log", "end-new"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Look at the map");
    expect(html).toContain("Read the log");
    expect(html).toContain("New game");
  });
  it("shows no raw ids of hexes or units", () => {
    const text = html.replace(/<[^>]*>/g, " ");
    expect(text).not.toMatch(/\b[A-Z]{1,2}\d{1,2}\b/);
  });
  it("goes away with 'Look at the map' (and comes back with 'Show the result'), and is not drawn for a watched game or a game still on", () => {
    expect(endShown(s)).toBe(true);
    expect(endHtml({ ...s, endDismissed: true })).toBe("");
    expect(endHtml({ ...s, watch: {} as never })).toBe("");
    expect(endHtml(newSession(SCENARIO_1939, "axis", 1))).toBe("");
  });
  it("the status line of a finished game names the verdict", () => {
    expect(statusText(s.state)).toBe("Game over: Allied Marginal Victory");
    expect(statusText({ ...s.state, result: undefined })).toBe("Game over");
    expect(statusHtml(s, null, [])).toContain("Game over: Allied Marginal Victory");
  });
  it("every scenario's own result reads cleanly (no card throws)", () => {
    for (const sc of [SCENARIO_1939, SCENARIO_1942, SCENARIO_1944, SCENARIO_CAMPAIGN]) {
      const st = { ...newGame(sc, 1), phase: "game-over" as const };
      expect(() => endHtml(over(sc, st, { ...base, winner: null, level: null, basis: "turn-limit" }))).not.toThrow();
    }
  });
});
