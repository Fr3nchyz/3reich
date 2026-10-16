import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
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
 * OFF until the supply sources are complete. Today only capitals supply, so units in Gibraltar, Malta, Egypt, Palestine, Syria, Algeria, Tunisia,
 * Libya, Sardinia and East Prussia-like pockets count as cut off at the start of every scenario (3 Axis and 12 Allied units in 1939; 26 Allied in 1944),
 * and punishing them would be wrong. Missing: Fortress, Libyan, Egyptian, Tunis, Beirut, Moscow and east-edge sources, Malta, the U.S.A. fallback,
 * Konigsberg and Durazzo (Ref 19.2) and sea supply (Ref 19.31, needs fleets). Switch on when `docs/PC-MANUAL-AUDIT.md` shows the false positives gone.
 */
export const SUPPLY_EFFECTS_ENABLED = false;
export const UNSUPPLIED_CANNOT_MOVE = true;
export const UNSUPPLIED_CANNOT_ADVANCE = true;
export const ELIMINATE_ONLY_IF_CUT_OFF_AT_START = true;

/** The ground units of the side to move that are out of supply now (airbases are not ground units). */
const cutOff = (ctx: GameContext, state: GameState): string[] =>
  unsuppliedUnits(ctx, state, state.activeSide).filter((id) => state.units[id] && ZOC_UNIT_TYPES.includes(state.units[id].type));

/** A Player Turn begins: remember which of the side's ground units are cut off. */
export function recordUnsupplied(ctx: GameContext, state: GameState, enabled: boolean = SUPPLY_EFFECTS_ENABLED): GameState {
  if (!enabled) return state;
  const ids = cutOff(ctx, state);
  if (ids.length === 0 && state.unsuppliedAtStart === undefined) return state;
  return { ...state, unsuppliedAtStart: ids };
}

/** Whether this unit was cut off when its Player Turn began. */
export const wasCutOff = (state: GameState, unitId: string): boolean => state.unsuppliedAtStart?.includes(unitId) === true;

/** The Player Turn ends: eliminate the ground units that are cut off (see the header for which), and forget the record. */
export function eliminateUnsupplied(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  const start = state.unsuppliedAtStart ?? [];
  const doomed = cutOff(ctx, state).filter((id) => !ELIMINATE_ONLY_IF_CUT_OFF_AT_START || start.includes(id));
  const units = { ...state.units };
  const events: GameEvent[] = [];
  for (const id of doomed) {
    const u = units[id]!;
    delete units[id];
    events.push({ type: "UNIT_ELIMINATED", unitId: id, owner: u.owner, at: u.at, reason: "unsupplied" });
  }
  const { unsuppliedAtStart: _gone, ...rest } = state;
  return { state: { ...rest, units }, events };
}
