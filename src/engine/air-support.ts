import { airOf } from "./air-record";
import { GS_CAP_MULTIPLE } from "./air-rules";
import type { HexId } from "./hex";
import type { GameState, Unit } from "./types";

/**
 * How Ground Support counts in a battle (spec 09 R8, C4): the air committed to the hex, as many units as fit under the cap of three times the
 * ground factors that attack it. Pure arithmetic on the record; `attackNumbers` and the loss rules both read it, so the preview and the battle agree.
 */

/** The air units committed to ground support at the hex that still exist, in designation order. */
export const committedAt = (state: GameState, hex: HexId): Unit[] =>
  (Object.hasOwn(airOf(state).groundSupport, hex) ? airOf(state).groundSupport[hex]! : []).flatMap((id) => (state.units[id] ? [state.units[id]] : []));

/**
 * The committed units that count against `groundFactors` attacking factors: taken in designation order, each one that still fits under
 * GS_CAP_MULTIPLE x groundFactors counts and the rest do not (they stay committed, are neither counted nor lost; `TODO(verify)`, spec 09 R8).
 */
export function countedAir(state: GameState, hex: HexId, groundFactors: number): { units: Unit[]; factors: number } {
  const cap = GS_CAP_MULTIPLE * groundFactors;
  const units: Unit[] = [];
  let factors = 0;
  for (const u of committedAt(state, hex)) {
    if (factors + u.strength > cap) continue;
    units.push(u);
    factors += u.strength;
  }
  return { units, factors };
}

/** The state with the hex's ground-support commitment cleared (the battle there is over, or its air was lost). */
export function clearGroundSupport(state: GameState, hex: HexId): GameState {
  const rec = airOf(state);
  if (!Object.hasOwn(rec.groundSupport, hex)) return state;
  const { [hex]: _gone, ...rest } = rec.groundSupport;
  return { ...state, air: { ...rec, groundSupport: rest } };
}
