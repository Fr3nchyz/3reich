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
  /** Hex to be attacked -> the air units committed to Ground Support there, in the order they were designated (Ref 20.41, `air-missions.ts`). */
  groundSupport: Record<HexId, string[]>;
}

/** A record for the Player Turn that begins now, with control as it stands. */
export const newAirTurn = (state: GameState): AirState => ({ turn: turnKey(state), placed: [], staged: [], controlAtStart: { ...state.control }, groundSupport: {} });

/** The record for the Player Turn now being played: the stored one, or a new one with control as it stands (a state built by hand, or one that began before the record existed). */
export function airOf(state: GameState): AirState {
  const rec = state.air;
  return rec && rec.turn === turnKey(state) && Array.isArray(rec.placed) && Array.isArray(rec.staged) && rec.controlAtStart && rec.groundSupport ? rec : newAirTurn(state);
}

/**
 * Airbases a Major Power has not set down yet (Ref 20.1: three each): three minus the number it has ever placed (`GameState.airbasesPlaced`).
 * An airbase destroyed in play does not come back. TODO(verify): the rule text read so far does not say whether a destroyed airbase is replaced.
 */
export const airbasesInReserve = (state: GameState, owner: PowerId): number => Math.max(0, AIRBASES_PER_MAJOR_POWER - (state.airbasesPlaced?.[owner] ?? 0));

/** The missions an air unit has flown in a Game Turn: "new" is a unit built in it, which may not fly one (Ref 20.3). More kinds come with later missions. */
export type FlownKind = "ground-support" | "new";

/**
 * Air units that have used their mission in one Game Turn (both Player Turns share it, spec 09 R5 option a, `TODO(verify)`). It lives in
 * `GameState.airFlown` and is replaced by a fresh record when a different Game Turn asks for it.
 */
export interface AirFlown {
  /** "year-season". */
  turn: string;
  units: Record<string, FlownKind>;
}

export const gameTurnKey = (s: Pick<GameState, "year" | "season">): string => `${s.year}-${s.season}`;

/** The record for the Game Turn now being played: the stored one, or an empty one. */
export function flownOf(state: GameState): AirFlown {
  const rec = state.airFlown;
  return rec && rec.turn === gameTurnKey(state) && rec.units ? rec : { turn: gameTurnKey(state), units: {} };
}

/** Whether the air unit has used its mission (or may not fly one) this Game Turn. */
export const hasFlown = (state: GameState, id: string): boolean => Object.hasOwn(flownOf(state).units, id);

/** The state with these air units marked as having flown `kind` this Game Turn. */
export function markFlown(state: GameState, ids: readonly string[], kind: FlownKind): GameState {
  const rec = flownOf(state);
  return { ...state, airFlown: { ...rec, units: { ...rec.units, ...Object.fromEntries(ids.map((id) => [id, kind])) } } };
}
