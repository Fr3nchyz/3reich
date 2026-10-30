import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { eliminateUnits } from "./losses";
import type { CountryId } from "./minors-record";
import { sideOfOwner } from "./setup";
import { BRP_COSTS } from "./tables";
import type { ForceOwner, GameState } from "./types";

/**
 * Spec 15 R4 (Ref 13.0): a move into the minor or an attack on one of its hexes by units of the declaring nation meets the duty.
 * A pass-through counts, so the caller gives every hex entered. Only the declarer's own units count (MC3, `MC3_ONLY_DECLARERS_UNITS`).
 * The met duty is cleared, with no event (R4).
 */
export function noteMinorEntry(ctx: GameContext, state: GameState, units: readonly { owner: ForceOwner }[], hexes: readonly string[]): GameState {
  if (!state.countries) return state;
  let countries = state.countries;
  for (const [id, record] of Object.entries(state.countries) as [CountryId, NonNullable<GameState["countries"]>[CountryId]][]) {
    const duty = record?.duty;
    if (!record || !duty) continue;
    const counts = (u: { owner: ForceOwner }) => u.owner === duty.by || (!MC3_ONLY_DECLARERS_UNITS && sideOfOwner(u.owner) === sideOfOwner(duty.by));
    if (!units.some(counts) || !hexes.some((h) => ctx.map.hexes[h]?.country === id)) continue;
    const { duty: _met, ...rest } = record;
    countries = { ...countries, [id]: rest };
  }
  return countries === state.countries ? state : { ...state, countries };
}

/**
 * TODO(verify) MC3, spec 15 R4: only units of the declaring nation meet the duty (not an ally's; no air or naval mission; Attrition attacks are not built).
 * Off: any unit of the declarer's side meets it.
 */
export const MC3_ONLY_DECLARERS_UNITS = true;

/**
 * TODO(verify) MC24, spec 15 R4: the BRPs lost when a declaration is revoked, reported in the event. The 10 BRPs were spent at step 1 and are not refunded;
 * the duty record keeps no price, and no Beta declaration costs 35 (MC4).
 */
export const MC24_REVOKED_BRPS_LOST = BRP_COSTS.declareWarOnMinorCountry;

/**
 * Spec 15 R4: leaving 7p of the declarer's Player Turn, a duty still open revokes the declaration. The minor goes back to Neutral at peace with the declarer,
 * its army is removed, other nations' units inside are eliminated to their pools (the allies' units that went in), the BRPs stay spent, and an event says so.
 * Runs before spec 14's settle hook (R7, "Order at the end of the Combat Phase").
 */
export function checkMinorDuties(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  for (const id of Object.keys(state.countries ?? {}) as CountryId[]) {
    const record = next.countries?.[id];
    const duty = record?.duty;
    if (!record || !duty || !next.nations[duty.by] || sideOfOwner(duty.by) !== next.activeSide) continue;
    const inside = Object.values(next.units).filter((u) => ctx.map.hexes[u.at]?.country === id || u.owner === id).map((u) => u.id);
    const gone = eliminateUnits(next, inside);
    const { duty: _owed, attacker: _by, toPlace: _place, helpers: _helpers, ...kept } = record;
    next = {
      ...gone.state,
      wars: gone.state.wars.filter(([a, b]) => !((a === duty.by && b === id) || (b === duty.by && a === id))),
      countries: { ...gone.state.countries, [id]: { ...kept, status: "neutral" as const } },
    };
    events.push(...gone.events, { type: "MINOR_DECLARATION_REVOKED", by: duty.by, minor: id, brpsLost: MC24_REVOKED_BRPS_LOST, removed: gone.removed.map((u) => u.id) });
  }
  return { state: next, events };
}
