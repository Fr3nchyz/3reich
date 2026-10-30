import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import type { GameContext } from "../src/engine/context";
import { newGame, turnIndex } from "../src/engine/game";
import { setupStatus } from "../src/engine/requirements";
import type { GameState, Scenario } from "../src/engine/types";
import { autoSetup } from "../src/engine/autosetup";
import { OPEN_SET_ACTIONS } from "../src/engine/attrition-step";
import { chooseAction } from "../src/ai";

const SCENARIOS: Scenario[] = [SCENARIO_1939, SCENARIO_CAMPAIGN, SCENARIO_1942, SCENARIO_1944];
const GAME_TURNS = 2;
const MAX_ACTIONS = 3000;

/** A computer plays both sides through `GAME_TURNS` Game Turns; every action is checked against legalActions first. */
function selfPlay(scenario: Scenario, seed: number): { state: GameState; log: string[]; actions: number } {
  const ctx: GameContext = { map: MAP, scenario };
  return playFrom(ctx, setUp(ctx, seed), seed, turnIndex(newGame(scenario, seed)) + GAME_TURNS);
}

/** The engine's automatic setup for every nation (the computer's setup is that placeholder, spec 05). */
function setUp(ctx: GameContext, seed: number): GameState {
  let state = newGame(ctx.scenario, seed);
  for (const a of autoSetup(ctx, state)) {
    const r = applyAction(ctx, state, a);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
  }
  return state;
}

function playFrom(ctx: GameContext, from: GameState, seed: number, stop: number): { state: GameState; log: string[]; actions: number; played: Action[] } {
  let state = from;
  expect(state.phase).toBe("player-turn");
  const log: string[] = [];
  const played: Action[] = [];
  let actions = 0;
  while (state.phase === "player-turn" && turnIndex(state) < stop) {
    expect(actions++, "the computer must not stall").toBeLessThan(MAX_ACTIONS);
    const d = chooseAction(ctx, state, { seed });
    expect(d, `a decision at ${JSON.stringify(state.position)}`).not.toBeNull();
    // A redeployment of part of a stack is accepted by the engine but not listed (sr-action.ts), and the Attrition losses and occupation take any valid set (spec 16 C3): applyAction below is their check.
    if (d!.action.type !== "SR_UNITS" && !OPEN_SET_ACTIONS.includes(d!.action.type)) expect(legalActions(ctx, state), "the chosen action is on the legal list").toContainEqual(d!.action);
    const r = applyAction(ctx, state, d!.action);
    if (!r.ok) throw new Error(`illegal action ${JSON.stringify(d!.action)}: ${r.error}`);
    expect(d!.why.length).toBeGreaterThan(0);
    log.push(`${JSON.stringify(d!.action)} ${d!.why}`);
    played.push(d!.action);
    state = r.state;
  }
  return { state, log, actions, played };
}

describe("computer self-play (spec 05, Ops 5.0)", () => {
  for (const scenario of SCENARIOS) {
    const startable = setupStatus({ map: MAP, scenario }).startable;
    it.skipIf(!startable)(`${scenario.name}: both sides, ${GAME_TURNS} Game Turns, no illegal action, same result from the same seed`, () => {
      const a = selfPlay(scenario, 7);
      const b = selfPlay(scenario, 7);
      expect(turnIndex(a.state)).toBeGreaterThanOrEqual(turnIndex(newGame(scenario, 7)) + GAME_TURNS);
      expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
      expect(b.log).toEqual(a.log);
    }, 120_000);
  }
});

describe("computer declarations over a long game (Ref 13.0)", () => {
  it("keeps BRPs back for its plan, so Germany does declare on the Soviet Union in Summer 1941 (1939 scenario)", () => {
    const ctx: GameContext = { map: MAP, scenario: SCENARIO_1939 };
    const stop = turnIndex({ year: 1941, season: "summer" }) + 1;
    const out = playFrom(ctx, setUp(ctx, 1), 1, stop);
    const declared = out.played.filter((a) => a.type === "DECLARE_WAR");
    expect(declared).toEqual([{ type: "DECLARE_WAR", by: "germany", on: "ussr" }]);
    expect(out.state.wars).toContainEqual(["germany", "ussr"]);
  }, 120_000);

  it("different seeds can make different choices, the same seed never does", () => {
    const ctx: GameContext = { map: MAP, scenario: SCENARIO_1939 };
    const start = setUp(ctx, 1);
    const run = (seed: number) => playFrom(ctx, start, seed, turnIndex(start) + 1).log;
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  }, 120_000);
});
