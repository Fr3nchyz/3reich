import { turnKey } from "./combat-record";
import type { GameState } from "./types";

/**
 * Which units have moved in the Player Turn now being played (step 6f, spec 03). It lives in
 * `GameState.moves` and, like the combat record, is replaced by a fresh one when a different
 * Player Turn asks for it (the key names the Game Turn and the side), so no step has to clear it.
 */
export interface MoveRecord {
  /** "year-season-side" of the Player Turn the record belongs to. */
  turn: string;
  /** Units that have moved this Player Turn: each moves once (Ref 5.45f; TODO(verify) in movement.ts). */
  moved: string[];
}

/** The record for the Player Turn now being played: the stored one, or an empty one. */
export function movesOf(state: GameState): MoveRecord {
  const rec = state.moves;
  return rec && rec.turn === turnKey(state) && Array.isArray(rec.moved) ? rec : { turn: turnKey(state), moved: [] };
}

export const hasMoved = (state: GameState, unitId: string): boolean => movesOf(state).moved.includes(unitId);
