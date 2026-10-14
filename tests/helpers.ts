import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import type { GameContext } from "../src/engine/context";
import { newGame } from "../src/engine/game";
import { applyAction, type ActionResult } from "../src/engine/actions";
import { beginPlay } from "../src/engine/turn";
import type { GameState, Scenario } from "../src/engine/types";

/** The map and a scenario, as every game is played on. */
export const ctxFor = (scenario: Scenario = SCENARIO_1939): GameContext => ({ map: MAP, scenario });
export const CTX = ctxFor();

/**
 * A game with the opening setup skipped, for tests of the turn sequence that do not care where
 * the counters are, standing where play begins (step 1, declarations of war, if the first side
 * has any to make). (Setup itself is tested in setup.test.ts.)
 */
export function atStart(scenario: Scenario, seed: number): GameState {
  return beginPlay(ctxFor(scenario), { ...newGame(scenario, seed), phase: "player-turn", setup: null }).state;
}

/** Leaves step 1 without declaring anything, if the game waits there. */
export function pastDeclarations(ctx: GameContext, s: GameState): GameState {
  if (s.position?.part !== "player-turn" || s.position.step !== "1") return s;
  const r = applyAction(ctx, s, { type: "END_STEP", side: s.activeSide, step: "1" });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** Like atStart, but with step 1 left behind: the game waits at 10b, where a turn is ended. */
export function started(scenario: Scenario, seed: number): GameState {
  return pastDeclarations(ctxFor(scenario), atStart(scenario, seed));
}

/** Ends the Player Turn of whoever is up, leaving step 1 first if the game waits there. */
export function endTurn(ctx: GameContext, s: GameState): ActionResult {
  const here = pastDeclarations(ctx, s);
  return applyAction(ctx, here, { type: "END_PLAYER_TURN", side: here.activeSide });
}
