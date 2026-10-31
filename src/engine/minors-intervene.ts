import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { sideInWar } from "./control";
import type { HexId } from "./hex";
import { AXIS_MINOR_ALLIES } from "./minors-ids";
import { garrisonMayEnter } from "./minors-axis";
import type { CountryId, CountryRecord } from "./minors-record";
import { MINOR_COUNTRY_FORCES } from "./tables";
import type { ForceOwner, GameState, MinorCountry, PowerId } from "./types";

/**
 * Spec 15 R5, R6, R8 (Ref 13.0, 14.0, 15.0, 17.2; Ops 5.43): who may enter a fighting minor's land, what an entry by the other side means
 * (Intervention), and the limit that a minor's own units stay in their country. Pure functions over the state; movement.ts, move-action.ts,
 * exploit-move.ts and attack.ts call them.
 */

/**
 * TODO(verify) MC5, spec 15 R6: an Intervention is a Major Power's ground unit ENDING OR PASSING a move in a hex of the attacked minor. Here a won attack's advance into such a hex counts too
 * (the unit stands in the hex, as after a move). Off: only a move counts.
 */
export const MC5_ADVANCE_INTERVENES = true;

/**
 * TODO(verify) MC25, spec 15 R8: "a minor's ground units may not leave their country" is applied to the minors that defend (declared on, or helped), and not to the four Axis
 * Minor-Allies (Ref 17.0: their counters are used by Germany; the text of R8 does not say). Off: the four are held to their country too.
 */
export const MC25_HOME_LIMIT_SPARES_MINOR_ALLIES = true;

/**
 * TODO(verify) MC26, spec 15 R8 / R15: Poland (attacked by Germany from the opening setup, no declaration, no step 2) is NOT held to the home limit while minors have no turn of their own
 * (Release 1, 15-18). The Allied side plays the Polish counters as Major Power counters, as the recorded games and the computer do; holding them at home would change those games.
 * Off: Poland's units too stay in Poland and may not advance over its border.
 */
export const MC26_POLAND_MOVES_FREELY = true;

const isMinorOwner = (o: ForceOwner): o is MinorCountry => Object.hasOwn(MINOR_COUNTRY_FORCES, o);

/** The record of a minor that is fighting now (attacked or helped) and not conquered (spec 14's record), else null. */
export function fightingRecord(state: GameState, country: string | undefined): CountryRecord | null {
  if (country === undefined) return null;
  const record = state.countries?.[country as CountryId];
  if (record?.status !== "attacked" && record?.status !== "allied") return null;
  return state.conquests?.some((c) => c.country === country) ? null : record;
}

/**
 * Why units of these owners may not enter (or pass over, or fly over) `hex` because of a minor country's rules, or null (R5, R8):
 * - a minor's own units (a defender) only the hexes of their own country (R8);
 * - the land of an attacked or helped, unconquered minor only for its declarer, for a Major Power of the minor's side (that entry is the Intervention, R6) and the minor's own units.
 * Land of other minors is for movement.ts's general test.
 */
export function minorEntryProblem(ctx: GameContext, state: GameState, owners: readonly ForceOwner[], hex: HexId): string | null {
  const h = ctx.map.hexes[hex];
  if (!h?.land) return null;
  for (const o of owners) {
    if (isMinorOwner(o) && !(MC26_POLAND_MOVES_FREELY && o === "poland") && (MC25_HOME_LIMIT_SPARES_MINOR_ALLIES ? !(AXIS_MINOR_ALLIES as readonly string[]).includes(o) : true) && h.country !== o) {
      return `${hex} is outside ${o}: a minor's units stay in their country (R8).`;
    }
  }
  const record = fightingRecord(state, h.country);
  if (!record) return null;
  const country = h.country as MinorCountry;
  const side = sideInWar(state, country);
  for (const o of owners) {
    if (o === country || o === record.attacker) continue;
    if (garrisonMayEnter(ctx, state, o, hex)) continue; // R10: a German Garrison walks in; the attacker has no unit inside
    if (!isMinorOwner(o) && Object.hasOwn(state.nations, o) && side !== null && sideInWar(state, o) === side) continue; // the Intervention (R6)
    return `${hex} is in ${country}, which ${o} may not enter: only its attacker and a Major Power of the other side may (R5).`;
  }
  return null;
}

/**
 * R6: units of a Major Power of the minor's side that end or pass a move in a hex of an attacked minor Intervene. The power is recorded as a helper
 * (first to Intervene first, MC19), the minor is then `allied`, and MINOR_INTERVENED is logged once for each new helper. A conquered minor cannot be helped; air and naval
 * missions are not moves and never call this.
 */
export function noteIntervention(ctx: GameContext, state: GameState, units: readonly { owner: ForceOwner }[], hexes: readonly HexId[]): { state: GameState; events: GameEvent[] } {
  if (!state.countries) return { state, events: [] };
  let countries = state.countries;
  const events: GameEvent[] = [];
  for (const country of new Set(hexes.map((x) => ctx.map.hexes[x]?.country))) {
    const record = fightingRecord({ ...state, countries }, country);
    if (!record) continue;
    const minor = country as MinorCountry;
    const side = sideInWar({ ...state, countries }, minor);
    for (const u of units) {
      const by = u.owner as PowerId;
      const now = countries[minor]!;
      if (isMinorOwner(by) || !Object.hasOwn(state.nations, by) || by === now.attacker || side === null || sideInWar(state, by) !== side) continue;
      if (now.helpers?.includes(by)) continue;
      countries = { ...countries, [minor]: { ...now, status: "allied", helpers: [...(now.helpers ?? []), by] } };
      events.push({ type: "MINOR_INTERVENED", minor, by: by });
    }
  }
  return events.length ? { state: { ...state, countries }, events } : { state, events };
}

/**
 * Spec 15 R8 (Ref 14.0, 15.0): a defending minor's units are supplied from its own capital or from any supply source of a Major Power of its side, even before that power
 * Intervenes (the side's sources are all at war with the attacker), so they belong to no one source group (e.g. a minor helped only by the Soviets is fed from Soviet sources).
 * The four Axis Minor-Allies are the Axis' own group (Ref 17.0). A power's sea supply of them goes through the same lines (naval-supply.ts names units of the side).
 */
export const minorFedByAnyGroup = (owner: ForceOwner): boolean => Object.hasOwn(MINOR_COUNTRY_FORCES, owner) && !(AXIS_MINOR_ALLIES as readonly string[]).includes(owner);
