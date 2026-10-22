import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { isGone } from "./nations";
import type { SovietCity } from "./soviet-record";
import type { GameState, Nation } from "./types";

/**
 * Moscow and Leningrad (spec 14 R7a; Ref 18.4, 9.2). The Axis capture of either city is an immediate gain of 15 BRPs for Germany and a loss of 15 for the
 * U.S.S.R., once for each city: if control swings back and forth there is no second gain or loss, and the U.S.S.R. gets no turn to retake the city first.
 * In every Year Start Sequence in which the Axis holds a city there is another 15 and another -15 (soviet-income.ts). Both stop once the U.S.S.R. has left the
 * game (a surrender accepted, ticket 14-15; or the last Russian factor gone after a refusal, V20): `sovietCityOpen`.
 *
 * This module knows the map and the ledger only, and does not import control.ts: `enterHexes` (control.ts) calls it the moment an Axis ground unit takes a city.
 */

/** Ref 18.4, 9.2: what each city is worth, in BRPs, each way. */
export const SOVIET_CITY_BRPS = 15;

const NAMES: Readonly<Record<string, SovietCity>> = { Moscow: "moscow", Leningrad: "leningrad" };

const cities = new WeakMap<GameContext, ReadonlyMap<HexId, SovietCity>>();

/** The two hexes, found by the manual's names on the map (Moscow H47, Leningrad D44), so the data stays the one source. */
function citiesOf(ctx: GameContext): ReadonlyMap<HexId, SovietCity> {
  let hit = cities.get(ctx);
  if (!hit) {
    const out = new Map<HexId, SovietCity>();
    for (const h of Object.values(ctx.map.hexes)) {
      const city = h.name !== undefined && h.country === "ussr" && h.land ? NAMES[h.name] : undefined;
      if (city) out.set(h.id, city);
    }
    cities.set(ctx, (hit = out));
  }
  return hit;
}

/** Which of the two cities this hex is, or null. */
export const sovietCityAt = (ctx: GameContext, hex: HexId): SovietCity | null => citiesOf(ctx).get(hex) ?? null;

/** The hexes of the two cities, for the Year Start Sequence. */
export const sovietCityHexes = (ctx: GameContext): HexId[] => [...citiesOf(ctx).keys()];

/**
 * Whether the 15s are still in play: the U.S.S.R. is in the game and was not conquered or surrendered (a Conquest of "ussr" counts too, so ticket 14-15
 * need not also set the status for this to stop). TODO(verify) V22: after a surrender they stop (Ref 18.41); until the last factor is gone after a refusal they go on (V20).
 */
export function sovietCityOpen(state: GameState): boolean {
  const ussr: Nation | undefined = state.nations.ussr;
  return ussr !== undefined && !isGone(ussr) && !(state.conquests ?? []).some((c) => c.country === "ussr");
}

/** Whether the immediate 15 for this city has been paid. */
export const cityPaid = (state: GameState, city: SovietCity): boolean => state.soviet?.citiesTaken[city] === true;

/**
 * An Axis ground unit has just taken `hex` from the Allies: if it is Moscow or Leningrad for the first time, Germany gains 15 BRPs and the U.S.S.R. loses 15 at once.
 * Returns the new state and its event, or null when nothing moves (not one of the cities, taken before, or the U.S.S.R. is gone).
 *
 * TODO(verify) V45: the loss is what the U.S.S.R. has, at most 15 (its total never goes below 0, as for every charge in brps.ts), the gain is the full 15, and neither
 * touches the spending limit, which is fixed for the year (Ref 10.0).
 * TODO(verify) V47: "capture" is read as an Axis ground unit (Italian and Minor-Ally units too) entering the city, at that moment, in any phase; control that
 * passes by a conquest is no capture. Germany is the recipient in every case (V22); a conquered Germany gets nothing, the U.S.S.R. still loses its 15.
 */
export function sovietCityTaken(ctx: GameContext, state: GameState, hex: HexId): { state: GameState; events: GameEvent[] } | null {
  const city = sovietCityAt(ctx, hex);
  if (city === null || !sovietCityOpen(state) || cityPaid(state, city)) return null;
  const ussr = state.nations.ussr;
  const germany = state.nations.germany;
  const lost = Math.min(SOVIET_CITY_BRPS, ussr.brpTotal);
  const gain = isGone(germany) ? 0 : SOVIET_CITY_BRPS;
  const nations = { ...state.nations, ussr: { ...ussr, brpTotal: ussr.brpTotal - lost }, germany: { ...germany, brpTotal: germany.brpTotal + gain } };
  const soviet = { ...state.soviet, citiesTaken: { ...state.soviet?.citiesTaken, [city]: true } };
  return { state: { ...state, nations, soviet }, events: [{ type: "RUSSIA_BRPS_MOVED", city, amount: gain, lost }] };
}
