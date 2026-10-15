import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { chooseAction } from "../src/ai";
import { applyAction } from "../src/engine/actions";
import { autoSetup } from "../src/engine/autosetup";
import type { GameContext } from "../src/engine/context";
import { newGame, turnIndex } from "../src/engine/game";
import { setupStatus } from "../src/engine/requirements";
import type { GameState, Scenario } from "../src/engine/types";

/** Real positions at step 6f, taken from computer-against-computer games (all four scenarios, several seeds), for tests of the Move card model. */

export interface Position {
  ctx: GameContext;
  state: GameState;
  label: string;
}

const SCENARIOS: Scenario[] = [SCENARIO_1939, SCENARIO_CAMPAIGN, SCENARIO_1942, SCENARIO_1944];
const MAX_ACTIONS = 3000;

function setUp(ctx: GameContext, seed: number): GameState {
  let state = newGame(ctx.scenario, seed);
  for (const a of autoSetup(ctx, state)) {
    const r = applyAction(ctx, state, a);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
  }
  return state;
}

/**
 * Plays `turns` Game Turns with the computer on both sides and keeps the states that wait at step 6f of a Player Turn (the entry and
 * after each move), at most `perGame` of them, spread evenly over the game.
 */
export function positionsAt6f(scenario: Scenario, seed: number, turns = 2, perGame = 10): Position[] {
  if (!setupStatus({ map: MAP, scenario }).startable) return [];
  const ctx: GameContext = { map: MAP, scenario };
  let state = setUp(ctx, seed);
  const stop = turnIndex(newGame(scenario, seed)) + turns;
  const seen: GameState[] = [];
  for (let n = 0; state.phase === "player-turn" && turnIndex(state) < stop && n < MAX_ACTIONS; n++) {
    if (state.position?.part === "player-turn" && state.position.step === "6f") seen.push(state);
    const d = chooseAction(ctx, state, { seed });
    if (!d) break;
    const r = applyAction(ctx, state, d.action);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
  }
  const stride = Math.max(1, Math.floor(seen.length / perGame));
  return seen.filter((_, i) => i % stride === 0).slice(0, perGame).map((s, i) => ({ ctx, state: s, label: `${scenario.name} seed ${seed} #${i}` }));
}

/** Positions from all four scenarios and the given seeds. */
export const realPositions = (seeds: readonly number[], turns = 2, perGame = 10): Position[] =>
  SCENARIOS.flatMap((sc) => seeds.flatMap((seed) => positionsAt6f(sc, seed, turns, perGame)));
