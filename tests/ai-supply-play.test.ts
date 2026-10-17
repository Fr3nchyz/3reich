import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { runGame } from "../scripts/selfplay/runner";
import { SCENARIO_KEYS } from "../scripts/selfplay/scenarios";
import type { RunOptions } from "../scripts/selfplay/types";

// Whole games with the supply effects switched on through the game's context (GameContext.supplyEffects), the shipped constant left as it is.
const rulesOff = { choose: ((ctx, state, cfg) => chooseAction(ctx, state, { ...cfg, supplyRules: false })) satisfies typeof chooseAction };
const actions = (o: RunOptions, hooks = {}) => JSON.stringify(runGame(o, hooks).actions);

describe("four Game Turns with the supply effects on, computer against computer", () => {
  for (const scenario of SCENARIO_KEYS) {
    it(`${scenario}, seed 1: no anomaly (every choice checked against legalActions), four whole Game Turns`, () => {
      const r = runGame({ scenario, seed: 1, turns: 4, verify: true, supplyEffects: true });
      expect(r.anomalies).toEqual([]);
      expect(r.ended).toBe("turn-limit");
      expect(r.turns.filter((t) => !t.partial)).toHaveLength(4);
      expect(r.ctx.supplyEffects).toBe(true);
    }, 120_000);
  }
  it("1942: the Italians in Sardinia and the Germans in Norway, who can only be supplied by sea (not built), are lost at the end of the first Axis Player Turn", () => {
    const r = runGame({ scenario: "1942", seed: 1, turns: 1, verify: false, supplyEffects: true });
    expect(r.turns[0]!.lostUnsupplied.axis).toBe(4);
  }, 60_000);
});

describe("the computer's supply rules change nothing while the effects are off", () => {
  it("1939 seed 1, four Game Turns: the same actions with the rules on or switched off", () => {
    const o: RunOptions = { scenario: "1939", seed: 1, turns: 4, verify: false, supplyEffects: false };
    expect(actions(o)).toBe(actions(o, rulesOff));
  }, 60_000);
  it("...while with the effects on they do change the game", () => {
    const o: RunOptions = { scenario: "1939", seed: 2, turns: 4, verify: false, supplyEffects: true };
    expect(actions(o)).not.toBe(actions(o, rulesOff));
  }, 60_000);
});
