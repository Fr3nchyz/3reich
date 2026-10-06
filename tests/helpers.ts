import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import type { GameContext } from "../src/engine/context";
import { newGame } from "../src/engine/game";
import type { GameState, Scenario } from "../src/engine/types";

/** The map and a scenario, as every game is played on. */
export const ctxFor = (scenario: Scenario = SCENARIO_1939): GameContext => ({ map: MAP, scenario });
export const CTX = ctxFor();

/**
 * A game with the opening setup skipped, for tests of the turn sequence that do not care where
 * the counters are. (Setup itself is tested in setup.test.ts.)
 */
export function started(scenario: Scenario, seed: number): GameState {
  return { ...newGame(scenario, seed), phase: "player-turn", setup: null };
}
