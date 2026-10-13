import type { GameContext } from "./context";
import { determineInitiative, initiativeTotals, nextTurn, otherSide, runYearStartSequence, turnIndex } from "./game";
import { applySetupAction, legalSetupActions } from "./setup";
import type { Action, ActionResult, GameEvent } from "./action-types";
import type { GameState } from "./types";

export type { Action, ActionResult, GameEvent } from "./action-types";

/** All actions the active player may take now. Empty when the game is over. */
export function legalActions(ctx: GameContext, state: GameState): Action[] {
  if (state.phase === "game-over") return [];
  if (state.phase === "setup") return legalSetupActions(ctx, state);
  return [{ type: "END_PLAYER_TURN", side: state.activeSide }];
}

/** Apply one action. Pure: returns a new state, or an error if the action is illegal. */
export function applyAction(ctx: GameContext, state: GameState, action: Action): ActionResult {
  if (state.phase === "game-over") return { ok: false, error: "The game is over." };
  switch (action.type) {
    case "SETUP_PLACE":
    case "SETUP_REMOVE":
    case "SETUP_DONE":
      return applySetupAction(ctx, state, action);
    case "END_PLAYER_TURN":
      if (state.phase !== "player-turn") return { ok: false, error: "Setup is not finished yet." };
      if (action.side !== state.activeSide) {
        return { ok: false, error: `It is the ${state.activeSide} player turn, not ${action.side}.` };
      }
      return { ok: true, ...endPlayerTurn(state) };
    default:
      return { ok: false, error: `Unknown action: ${JSON.stringify(action)}` };
  }
}

/** Re-apply a recorded list of actions. Throws if any action is illegal. */
export function replay(ctx: GameContext, initial: GameState, actions: readonly Action[]): { state: GameState; events: GameEvent[] } {
  let state = initial;
  const events: GameEvent[] = [];
  for (const [i, action] of actions.entries()) {
    const result = applyAction(ctx, state, action);
    if (!result.ok) throw new Error(`Action ${i} is illegal: ${result.error}`);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

function endPlayerTurn(state: GameState): { state: GameState; events: GameEvent[] } {
  // First player done: the second side takes its Player Turn.
  if (state.activeSide === state.firstSide) {
    const side = otherSide(state.firstSide);
    return {
      state: { ...state, activeSide: side },
      events: [{ type: "PLAYER_TURN_STARTED", year: state.year, season: state.season, side }],
    };
  }

  // Both sides done: the Game Turn ends.
  if (turnIndex(state) >= turnIndex(state.lastTurn)) {
    return {
      state: { ...state, phase: "game-over" },
      events: [{ type: "GAME_OVER", year: state.year, season: state.season }],
    };
  }

  const turn = nextTurn(state);
  let next: GameState = { ...state, ...turn };
  if (turn.season === "spring") next = runYearStartSequence(next);
  const firstSide = determineInitiative(next);
  const totals = initiativeTotals(next);
  next = { ...next, firstSide, activeSide: firstSide };
  return {
    state: next,
    events: [
      { type: "INITIATIVE_DETERMINED", ...turn, firstSide, ...totals },
      { type: "PLAYER_TURN_STARTED", ...turn, side: firstSide },
    ],
  };
}
