import type { GameContext } from "./context";
import { determineInitiative, initiativeTotals, nextTurn, otherSide, runYearStartSequence, turnIndex } from "./game";
import type { HexId } from "./hex";
import { applySetupAction, legalSetupActions } from "./setup";
import type { ForceOwner, GameState, OffMapBox, Season, Side, UnitType } from "./types";

/**
 * Everything a player (human or computer) can do is an Action. Actions are plain,
 * JSON-serializable objects; a game is fully described by its starting state, its context
 * (map and scenario) and the list of actions applied to it.
 */
export type Action =
  | { type: "END_PLAYER_TURN"; side: Side }
  /** Opening setup: set up one counter from the owner's Force Pool (Ops 4.1). */
  | { type: "SETUP_PLACE"; owner: ForceOwner; unit: { type: UnitType; strength: number; nationality?: ForceOwner }; at: HexId | OffMapBox }
  /** Opening setup: take a counter back off the map into the Force Pool. */
  | { type: "SETUP_REMOVE"; owner: ForceOwner; unitId: string }
  /** Opening setup: this owner has finished placing its forces ("Done"). */
  | { type: "SETUP_DONE"; owner: ForceOwner };

/** What happened as a result of an action, for the UI and the log. */
export type GameEvent =
  | { type: "UNIT_PLACED"; unitId: string; owner: ForceOwner; at: HexId | OffMapBox }
  | { type: "UNIT_REMOVED"; unitId: string; owner: ForceOwner }
  | { type: "SETUP_OWNER_DONE"; owner: ForceOwner }
  | { type: "SETUP_COMPLETE" }
  | { type: "INITIATIVE_DETERMINED"; year: number; season: Season; firstSide: Side; axis: number; allies: number }
  | { type: "PLAYER_TURN_STARTED"; year: number; season: Season; side: Side }
  | { type: "GAME_OVER"; year: number; season: Season };

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };

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
