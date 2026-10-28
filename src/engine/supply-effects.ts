import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { eliminateUnits } from "./losses";
import { unsuppliedUnits } from "./supply";
import type { GameState } from "./types";
import { ZOC_UNIT_TYPES } from "./zoc";

/**
 * What being out of supply does to ground units (Ref 19.4, 11.74, 12.21; spec 03, "supply effects"). `supplyStatus` (supply.ts) says who is
 * cut off; this module applies it at the two moments the rules name: when the Player Turn begins (the units cut off then cannot move, Ref 19.4, and cannot advance after
 * combat, Ref 12.21; they may attack at full strength) and when it ends (the ones still cut off are eliminated).
 *
 * TODO(verify): the manual contradicts itself on the elimination. 19.4 eliminates any unit unsupplied at the end of its Player Turn; 11.74
 * eliminates those unsupplied at the start AND still unsupplied at the end. `ELIMINATE_ONLY_IF_CUT_OFF_AT_START` picks the second (the more
 * forgiving, and the one that names both moments). TODO(verify, Ref 19.1): supply is checked in the Movement Phase after naval movement; here
 * once, at the start of the Player Turn. Not built: Strategic Redeployment, Exploitation, airbases relocating (Ref 20.1, 11.75), the Libyan cap.
 */
/**
 * OFF, the shipped setting; switching the effects on is this one line (a game's context can override it, `GameContext.supplyEffects`, which
 * tests and `npm run selfplay -- --supply-effects on` use). The computer plays with its supply rules while they are on (src/ai/lines.ts,
 * doomed.ts); the numbers with and without those rules, and what still stands in the way (Berlin as Germany's only source, sea supply for
 * Sardinia and Norway, Ref 19.31, needs fleets), are in spec 05, "As built: the computer and supply". The sources of Ref 19.2 are built
 * (supply-sources.ts); not built: the U.S.A. fallback, Greek islands, Tangiers.
 */
export const SUPPLY_EFFECTS_ENABLED = false;
/** Whether the supply effects apply in this game: the context's own setting (tests, self-play), otherwise `SUPPLY_EFFECTS_ENABLED`. */
export const supplyEffectsOn = (ctx: GameContext): boolean => ctx.supplyEffects ?? SUPPLY_EFFECTS_ENABLED;
export const UNSUPPLIED_CANNOT_MOVE = true;
export const UNSUPPLIED_CANNOT_ADVANCE = true;
export const ELIMINATE_ONLY_IF_CUT_OFF_AT_START = true;

/** The ground units of the side to move that are out of supply now (airbases are not ground units). */
const cutOff = (ctx: GameContext, state: GameState): string[] =>
  unsuppliedUnits(ctx, state, state.activeSide).filter((id) => state.units[id] && ZOC_UNIT_TYPES.includes(state.units[id].type));

/** A Player Turn begins: remember which of the side's ground units are cut off. */
export function recordUnsupplied(ctx: GameContext, state: GameState, enabled: boolean = supplyEffectsOn(ctx)): GameState {
  if (!enabled) return state;
  const ids = cutOff(ctx, state);
  if (ids.length === 0 && state.unsuppliedAtStart === undefined) return state;
  return { ...state, unsuppliedAtStart: ids };
}

/** Whether this unit was cut off when its Player Turn began. */
export const wasCutOff = (state: GameState, unitId: string): boolean => state.unsuppliedAtStart?.includes(unitId) === true;

const withoutRecord = (state: GameState): GameState => {
  const { unsuppliedAtStart: _gone, ...rest } = state;
  return rest;
};

/** The Player Turn ends: eliminate the ground units that are cut off (see the header for which), and forget the record. */
export function eliminateUnsupplied(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  const start = state.unsuppliedAtStart ?? [];
  if (ELIMINATE_ONLY_IF_CUT_OFF_AT_START && start.length === 0) return { state: state.unsuppliedAtStart === undefined ? state : withoutRecord(state), events: [] }; // nobody was cut off at the start: no supply search needed
  const doomed = cutOff(ctx, state).filter((id) => !ELIMINATE_ONLY_IF_CUT_OFF_AT_START || start.includes(id));
  const gone = eliminateUnits(withoutRecord(state), doomed, "unsupplied"); // back to the pool, or lost for good (spec 17 R1)
  return { state: gone.state, events: gone.events };
}
