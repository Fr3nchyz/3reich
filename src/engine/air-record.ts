import { turnKey } from "./combat-record";
import { AIRBASES_PER_MAJOR_POWER } from "./air-rules";
import type { HexId } from "./hex";
import type { ForceOwner, GameState, PowerId } from "./types";

/**
 * What the air rules have recorded in one Player Turn (spec 09 part C1). It lives in `GameState.air` and is replaced by a fresh record when
 * a different Player Turn asks for it, exactly as `combatOf` does for ground combat. Later tickets add the mission and drop lists.
 */
export interface AirState {
  /** "year-season-side" of the Player Turn the record belongs to. */
  turn: string;
  /** Airbases placed in this Player Turn: only air and airborne units of their own nationality may use them until it ends (Ref 20.1). */
  placed: string[];
  /** Air units that have staged (changed base) this Player Turn (Ref 20.2, `ONE_STAGE_PER_TURN`). */
  staged: string[];
  /** A copy of `GameState.control` taken when the Player Turn began: staging may use only a base the side held then (Ref 20.2). */
  controlAtStart: Record<HexId, ForceOwner>;
}

/** A record for the Player Turn that begins now, with control as it stands. */
export const newAirTurn = (state: GameState): AirState => ({ turn: turnKey(state), placed: [], staged: [], controlAtStart: { ...state.control } });

/** The record for the Player Turn now being played: the stored one, or a new one with control as it stands (a state built by hand, or one that began before the record existed). */
export function airOf(state: GameState): AirState {
  const rec = state.air;
  return rec && rec.turn === turnKey(state) && Array.isArray(rec.placed) && Array.isArray(rec.staged) && rec.controlAtStart ? rec : newAirTurn(state);
}

/**
 * Airbases a Major Power has not set down yet (Ref 20.1: three each): three minus the number it has ever placed (`GameState.airbasesPlaced`).
 * An airbase destroyed in play does not come back. TODO(verify): the rule text read so far does not say whether a destroyed airbase is replaced.
 */
export const airbasesInReserve = (state: GameState, owner: PowerId): number => Math.max(0, AIRBASES_PER_MAJOR_POWER - (state.airbasesPlaced?.[owner] ?? 0));
