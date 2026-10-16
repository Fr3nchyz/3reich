import { turnKey } from "./combat-record";
import { AIRBASES_PER_MAJOR_POWER } from "./air-rules";
import type { GameState, PowerId } from "./types";

/**
 * What the air rules have recorded in one Player Turn (spec 09 part C1). It lives in `GameState.air` and is replaced by a fresh record when
 * a different Player Turn asks for it, exactly as `combatOf` does for ground combat. Later tickets add the staging, mission and drop lists.
 */
export interface AirState {
  /** "year-season-side" of the Player Turn the record belongs to. */
  turn: string;
  /** Airbases placed in this Player Turn: only air and airborne units of their own nationality may use them until it ends (Ref 20.1). */
  placed: string[];
}

/** The record for the Player Turn now being played: the stored one, or an empty one. */
export function airOf(state: GameState): AirState {
  const rec = state.air;
  return rec && rec.turn === turnKey(state) ? rec : { turn: turnKey(state), placed: [] };
}

/**
 * Airbases a Major Power has not set down yet (Ref 20.1: three each): three minus the number it has ever placed (`GameState.airbasesPlaced`).
 * An airbase destroyed in play does not come back. TODO(verify): the rule text read so far does not say whether a destroyed airbase is replaced.
 */
export const airbasesInReserve = (state: GameState, owner: PowerId): number => Math.max(0, AIRBASES_PER_MAJOR_POWER - (state.airbasesPlaced?.[owner] ?? 0));
