import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import type { GameContext } from "../src/engine/context";
import { newGame } from "../src/engine/game";
import { applyAction, legalActions, type ActionResult } from "../src/engine/actions";
import { surrenderAsking } from "../src/engine/soviet-record";
import { beginPlay } from "../src/engine/turn";
import type { GameState, Scenario } from "../src/engine/types";

/** The map and a scenario, as every game is played on. */
export const ctxFor = (scenario: Scenario = SCENARIO_1939): GameContext => ({ map: MAP, scenario });
export const CTX = ctxFor();

/** Every Major Power has placed its three airbases: a position with no unit on the map then has no air work at step 6f either (spec 09 C5, ticket 09-13), so the step is passed as it was with only ground rules. */
export const NO_AIRBASES_LEFT = { germany: 3, italy: 3, ussr: 3, britain: 3, france: 3, usa: 3 };

/**
 * A game with the opening setup skipped, for tests of the turn sequence that do not care where
 * the counters are, standing where play begins (step 1, declarations of war, if the first side
 * has any to make). (Setup itself is tested in setup.test.ts.)
 */
export function atStart(scenario: Scenario, seed: number): GameState {
  return beginPlay(ctxFor(scenario), { ...newGame(scenario, seed), phase: "player-turn", setup: null }).state;
}

/** Moves on from every step the game waits at until it waits at 10b, where a turn is ended; nothing is declared, built or granted. */
export function toEndOfTurn(ctx: GameContext, s: GameState): GameState {
  let state = s;
  for (let guard = 0; guard < 60 && state.phase === "player-turn" && state.position?.part === "player-turn" && state.position.step !== "10b"; guard++) {
    // An empty board in a scenario with Russia at war (1942, 1944) meets Russia's offer to surrender at 10a (0 Russian factors, 0 Axis: the test is met, spec 14 R7b); the neutral answer is to refuse.
    // Step 2 holds the game until an attacked minor's army is set up (spec 15 C5): the suggested placement is played for whoever sets it up.
    const army = legalActions(ctx, state).find((a) => a.type === "PLACE_MINOR_FORCES");
    const r = army ? applyAction(ctx, state, army) : surrenderAsking(state) ? applyAction(ctx, state, { type: "SURRENDER_ANSWER", side: "axis", accept: false }) : applyAction(ctx, state, { type: "END_STEP", side: state.activeSide, step: state.position.step });
    if (!r.ok) throw new Error(r.error);
    state = r.state;
  }
  return state;
}

/** Like atStart, but with every earlier step left behind: the game waits at 10b. */
export function started(scenario: Scenario, seed: number): GameState {
  return toEndOfTurn(ctxFor(scenario), atStart(scenario, seed));
}

/** Ends the Player Turn of whoever is up, leaving step 1 first if the game waits there. */
export function endTurn(ctx: GameContext, s: GameState): ActionResult {
  const here = toEndOfTurn(ctx, s);
  return applyAction(ctx, here, { type: "END_PLAYER_TURN", side: here.activeSide });
}
