import { airOf, gameTurnKey } from "./air-record";
import { turnKey } from "./combat-record";
import type { GameContext } from "./context";
import { controllingSide } from "./control";
import type { HexId } from "./hex";
import type { GameState, Side } from "./types";

/**
 * What the fleet rules have recorded (spec 12 part C1, R1 and R5). It lives in `GameState.naval`, in the pattern of `AirState` and
 * `airOf`: a stored record is used only for the turn it belongs to, otherwise a fresh one is built. No rule is applied here; actions and
 * queries of the later tickets read and write it. The record of base changes, interceptions and pending choices is added by the tickets
 * that define their shape (12-11 and 12-12).
 */

/**
 * What a fleet has been used for in a Game Turn (R5, Ref 21.3, 11.62): carry supply, intercept, an offensive Mission, a sea escort, or
 * "new", built in this Game Turn and so not usable until the next (Ref 21.3). A change of base uses up nothing.
 */
export type NavalUse = "supply" | "intercept" | "mission" | "escort" | "new";

/** Fleets named to carry supply from one port to a receiving place for these units (R6, R7). Written by ticket 12-3. */
export interface SeaSupplyDesignation {
  fleets: string[];
  from: HexId;
  to: HexId;
  units: string[];
}

/** The fleet record. Two lifetimes: `gameTurn` and `used` carry over inside a Game Turn (both Player Turns share it); the lists restart each Player Turn. */
export interface NavalState {
  /** "year-season": the Game Turn the `used` record belongs to. */
  gameTurn: string;
  /** What each fleet has been used for in this Game Turn (R5), fleets built in it included. */
  used: Record<string, NavalUse>;
  /** "year-season-side" of the Player Turn the lists below belong to. */
  turn: string;
  /** Fleets whose attempt to intercept failed this Player Turn: they may not try again in it (R5, R11). */
  triedIntercept: string[];
  /** Fleets that changed base this Player Turn (R10). */
  moved: string[];
  /** Sea supply named this Player Turn (R6, R7). */
  supply: SeaSupplyDesignation[];
}

/**
 * The naval factors of the partial fleet counters (R1, Ref 21.7): the manual's example breaks two 6-factor fleets into a 9, a 2 and a 1,
 * so 9, 6, 2 and 1 exist. TODO(verify): whether 3, 4, 5, 7 or 8 exist is not stated (N1); check against the counter sheet and the
 * Operations Manual dialog. Used by the loss break-down of ticket 12-9.
 */
export const FLEET_COUNTER_SIZES: readonly number[] = [1, 2, 6, 9];

const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((e) => typeof e === "string");

/** A record for the Player Turn that begins now, carrying over what the Game Turn has already used. */
const freshTurn = (state: GameState, used: Record<string, NavalUse>): NavalState => ({ gameTurn: gameTurnKey(state), used, turn: turnKey(state), triedIntercept: [], moved: [], supply: [] });

/**
 * The record for the Player Turn now being played: the stored one, or a new one. A stored record from an earlier Player Turn of the
 * same Game Turn keeps its `used` and loses its lists; one from another Game Turn, or one that is malformed, starts empty.
 */
export function navalOf(state: GameState): NavalState {
  const rec = state.naval;
  const sameGame = !!rec && rec.gameTurn === gameTurnKey(state) && !!rec.used && typeof rec.used === "object";
  if (sameGame && rec.turn === turnKey(state) && isStrings(rec.triedIntercept) && isStrings(rec.moved) && Array.isArray(rec.supply)) return rec;
  return freshTurn(state, sameGame ? rec.used : {});
}

/** What the fleet has been used for in this Game Turn, or undefined if nothing yet. */
export function useOf(state: GameState, id: string): NavalUse | undefined {
  const { used } = navalOf(state);
  return Object.hasOwn(used, id) ? used[id] : undefined;
}

/** Whether the fleet has used up its Game Turn (R5), or may not act in it because it was built in it. */
export const hasUsed = (state: GameState, id: string): boolean => useOf(state, id) !== undefined;

/** The state with these fleets marked as used for `kind` in this Game Turn. */
export function markUsed(state: GameState, ids: readonly string[], kind: NavalUse): GameState {
  const rec = navalOf(state);
  return { ...state, naval: { ...rec, used: { ...rec.used, ...Object.fromEntries(ids.map((id) => [id, kind])) } } };
}

/**
 * Whether the side held the hex when its Player Turn began (Ref 20.2, 21.2): the air record keeps a copy of control taken then, and
 * the naval rules read it through this one function, as the air rules do.
 */
export function heldAtStart(ctx: GameContext, state: GameState, side: Side, hex: HexId): boolean {
  return controllingSide(ctx, { ...state, control: airOf(state).controlAtStart }, hex) === side;
}
