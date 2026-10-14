import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { applyAction, legalActions } from "../src/engine/actions";
import type { GameContext } from "../src/engine/context";
import { newGame, turnIndex } from "../src/engine/game";
import { setupStatus } from "../src/engine/requirements";
import type { GameState, Scenario } from "../src/engine/types";
import { chooseAction, computerSetup } from "../src/ai";

const SCENARIOS: Scenario[] = [SCENARIO_1939, SCENARIO_CAMPAIGN, SCENARIO_1942, SCENARIO_1944];
const GAME_TURNS = 3;
const MAX_ACTIONS = 3000;

/** A computer plays both sides through `GAME_TURNS` Game Turns; every action is checked against legalActions first. */
function selfPlay(scenario: Scenario, seed: number): { state: GameState; log: string[]; actions: number } {
  const ctx: GameContext = { map: MAP, scenario };
  let state = newGame(scenario, seed);
  state = computerSetup(ctx, state, ["axis", "allies"]).state;
  expect(state.phase).toBe("player-turn");
  const stop = turnIndex(state) + GAME_TURNS;
  const log: string[] = [];
  let actions = 0;
  while (state.phase === "player-turn" && turnIndex(state) < stop) {
    expect(actions++, "the computer must not stall").toBeLessThan(MAX_ACTIONS);
    const d = chooseAction(ctx, state, { seed });
    expect(d, `a decision at ${JSON.stringify(state.position)}`).not.toBeNull();
    expect(legalActions(ctx, state), "the chosen action is on the legal list").toContainEqual(d!.action);
    const r = applyAction(ctx, state, d!.action);
    if (!r.ok) throw new Error(`illegal action ${JSON.stringify(d!.action)}: ${r.error}`);
    expect(d!.why.length).toBeGreaterThan(0);
    log.push(`${JSON.stringify(d!.action)} ${d!.why}`);
    state = r.state;
  }
  return { state, log, actions };
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
