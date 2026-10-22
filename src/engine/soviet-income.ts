import { controllingSide } from "./control";
import type { GameContext } from "./context";
import { SOVIET_CITY_BRPS, sovietCityHexes, sovietCityOpen } from "./soviet";
import type { GameState, PowerId } from "./types";

/**
 * The 15s of the Year Start Sequence (spec 14 R7a; Ref 18.4, 9.2): in every sequence in which the Axis holds Moscow or Leningrad, Germany gets another 15 BRPs
 * for each and the U.S.S.R. loses 15 for each. Held means controlled by a hex's Axis side when the sequence runs, whether or not the immediate 15 was ever
 * paid (the scenario cards put neither city in Axis hands). They stop with the U.S.S.R. (`sovietCityOpen`).
 */

/** How many of the two cities the Axis holds now. */
export function citiesHeldByAxis(ctx: GameContext, state: GameState): number {
  return sovietCityHexes(ctx).filter((hex) => controllingSide(ctx, state, hex) === "axis").length;
}

/** What the Year Start Sequence adds to this Power's total for the two cities: +15 each for Germany, -15 each for the U.S.S.R., 0 for anyone else. */
export function sovietCityIncome(ctx: GameContext, state: GameState, id: PowerId): number {
  if ((id !== "germany" && id !== "ussr") || !sovietCityOpen(state)) return 0;
  const held = citiesHeldByAxis(ctx, state);
  // TODO(verify) V22: the text says "the Axis" holds the cities, Germany is the recipient (and the U.S.S.R. the payer); V46: see recalculated in yearstart.ts for where the sum goes.
  return id === "germany" ? held * SOVIET_CITY_BRPS : -held * SOVIET_CITY_BRPS;
}
