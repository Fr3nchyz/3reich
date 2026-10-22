import { controllingSide } from "./control";
import type { GameContext } from "./context";
import { SOVIET_CITY_BRPS, sovietCityAt, sovietCityHexes, sovietCityOpen } from "./soviet";
import type { SovietCity } from "./soviet-record";
import type { GameState, PowerId } from "./types";

/**
 * The 15s of the Year Start Sequence (spec 14 R7a; Ref 18.4, 9.2): in every sequence in which the Axis holds Moscow or Leningrad, Germany gets another 15 BRPs
 * for each and the U.S.S.R. loses 15 for each. Held means controlled by a hex's Axis side when the sequence runs, whether or not the immediate 15 was ever
 * paid (the scenario cards put neither city in Axis hands). They stop with the U.S.S.R. (`sovietCityOpen`).
 */

/** The two cities the Axis holds now, Moscow first. */
export function citiesNamedHeldByAxis(ctx: GameContext, state: GameState): SovietCity[] {
  return sovietCityHexes(ctx).filter((hex) => controllingSide(ctx, state, hex) === "axis").map((hex) => sovietCityAt(ctx, hex)!).sort((a, b) => (a === b ? 0 : a === "moscow" ? -1 : 1));
}

/** How many of the two cities the Axis holds now. */
export const citiesHeldByAxis = (ctx: GameContext, state: GameState): number => citiesNamedHeldByAxis(ctx, state).length;

/** What the Year Start Sequence adds to this Power's total for the two cities: +15 each for Germany, -15 each for the U.S.S.R., 0 for anyone else. */
export function sovietCityIncome(ctx: GameContext, state: GameState, id: PowerId): number {
  if ((id !== "germany" && id !== "ussr") || !sovietCityOpen(state)) return 0;
  const held = citiesHeldByAxis(ctx, state);
  // TODO(verify) V22: the text says "the Axis" holds the cities, Germany is the recipient (and the U.S.S.R. the payer); V46: where the sum goes (into the new total, after the Base has grown) is decided in `recalculated`, yearstart.ts.
  return id === "germany" ? held * SOVIET_CITY_BRPS : -held * SOVIET_CITY_BRPS;
}
