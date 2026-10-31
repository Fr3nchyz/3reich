import type { GameEvent } from "./action-types";
import { conquestRecipient } from "./conquest-income";
import { countryLand, fallCountry } from "./conquest-minor";
import { controllerOf, sideInWar, startingControl } from "./control";
import type { GameContext } from "./context";
import type { CountryId } from "./minors-record";
import { capitalOf, COLONIES, MINOR_COUNTRIES, minorValue } from "./minors-rules";
import { sideOfOwner } from "./setup";
import { AIR_BASE_FEATURES } from "./terrain";
import type { GameState, PowerId, Side } from "./types";

/** TODO(verify) MC12: unread/blank card values add nothing pending verification (spec 15 R13). */
export const UNREAD_CONQUERED_VALUE = 0;
/** TODO(verify) MC13: conservative R7 reading: a single holder must own all cities to complete a fall. */
export const ALL_CITIES_REQUIRE_SINGLE_HOLDER = true;

/** Spec 15 R7/R12/R13, TODO(verify) MC13: all map city features within the country's land. */
const citiesOf = (ctx: GameContext, country: CountryId) => [...countryLand(ctx, country)].filter((id) =>
  ctx.map.hexes[id]?.features.some((f) => AIR_BASE_FEATURES.includes(f)));
const allCitiesCountry = (country: CountryId) => country === "eastern-europe" || COLONIES.some((c) => c === country);

/** Spec 15 R7/R13: empty city lists cannot establish conquest; every city must be held by this side. */
export function holdsAllCities(ctx: GameContext, state: GameState, side: Side, country: CountryId): boolean {
  const cities = citiesOf(ctx, country);
  return cities.length > 0 && cities.every((hex) => {
    const owner = controllerOf(ctx, state, hex);
    return owner !== null && sideInWar(state, owner) === side;
  });
}

export interface ConqueredIncomeLine { country: CountryId; value: number }

/** Spec 15 R7/R13 item 3: completed conquests only, current holder, excluding land held by its side at scenario start. */
export function conqueredIncomeLines(ctx: GameContext, state: GameState, side: PowerId): ConqueredIncomeLine[] {
  const lines: ConqueredIncomeLine[] = [];
  for (const conquest of state.conquests ?? []) {
    if (conquest.at.year >= state.year) continue; // R13: first Year Start after completion.
    if (conquest.country in state.nations) continue; // Spec 15 R13 item 5: Major Power income belongs to spec 14.
    const country = conquest.country as CountryId;
    const capital = capitalOf(ctx, country);
    const cities = allCitiesCountry(country) ? citiesOf(ctx, country) : capital === null ? [] : [capital];
    if (cities.length === 0) continue;
    const sideNow = sideInWar(state, side);
    if (sideNow === null) continue;
    if (allCitiesCountry(country) && !holdsAllCities(ctx, state, sideNow, country)) continue;
    // Spec 15 R13: pay the actual holder, routing a Minor-Ally through its protector as spec 14 does.
    if (!cities.every((hex) => {
      const holder = controllerOf(ctx, state, hex);
      const start = startingControl(ctx).get(hex);
      return holder !== null && conquestRecipient(state, holder) === side && (start === undefined || sideOfOwner(start) !== sideNow);
    })) continue;
    lines.push({ country, value: minorValue(country) ?? UNREAD_CONQUERED_VALUE });
  }
  return lines;
}

/** Spec 15 R13 item 3: table values, without changing the Base or charging for lost unpaid countries. */
export const conqueredIncome = (ctx: GameContext, state: GameState, side: PowerId): number =>
  conqueredIncomeLines(ctx, state, side).reduce((total, line) => total + line.value, 0);

/** Spec 15 R7: called at the existing Combat Phase settlement; spec 14 owns every fall effect. */
export function settleAllCitiesConquests(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  for (const country of [...COLONIES, "eastern-europe"] as const) {
    if (next.phase !== "player-turn") break;
    // R7/R12: Eastern Europe must exist (zone or country record); do not create it here.
    if (country === "eastern-europe" && !next.countries?.[country] && !ctx.scenario.zones[country]) continue;
    if (!holdsAllCities(ctx, next, next.activeSide, country)) continue;
    const cities = citiesOf(ctx, country);
    const conqueror = controllerOf(ctx, next, cities[0]!)!;
    // R13: original holdings do not fall again; R7 requires one holder of all cities.
    if ((ALL_CITIES_REQUIRE_SINGLE_HOLDER && !cities.every((hex) => controllerOf(ctx, next, hex) === conqueror)) || cities.every((hex) => { const start = startingControl(ctx).get(hex); return start !== undefined && sideOfOwner(start) === next.activeSide; })) continue;
    const done = fallCountry(ctx, next, { country, conqueror, how: "all-cities" });
    next = done.state;
    events.push(...done.events);
  }
  return { state: next, events };
}

/** Spec 15 R13: these lines exclude spec 14's Major Power and Soviet-city income. */
export interface TerritoryIncomeLine {
  country: CountryId;
  kind: "minor-ally" | "helped-minor" | "conquered";
  brps: number;
}

/** TODO(verify) MC19, spec 15 R13: only the first intervener receives the value. */
export const MC19_INCOME_HELPER_INDEX = 0;
/** TODO(verify) MC20, spec 15 R13: no helper income after any completed conquest or loss of the capital. */
export const MC20_REQUIRE_FRIENDLY_CAPITAL = true;

/** Spec 15 R13: pure Year Start figures only; no payment, Base change, loss charge or event. */
export function territoryIncome(ctx: GameContext, state: GameState, side: PowerId): { lines: TerritoryIncomeLine[]; total: number } {
  const lines: TerritoryIncomeLine[] = [];
  const conquered = new Set(state.conquests?.map((c) => c.country));
  // R13 item 1: active allies pay individually, including the printed starting-allies exception.
  for (const ally of state.minorAllies) {
    if (!ally.active || ally.of !== side || conquered.has(ally.owner)) continue;
    const country = MINOR_COUNTRIES.find((country) => country === ally.owner);
    if (country === undefined) continue; // R13: only countries with a minor value belong here.
    lines.push({ country, kind: "minor-ally", brps: minorValue(country) ?? UNREAD_CONQUERED_VALUE });
  }
  // R13 item 2 / MC19 / MC20: an unconquered helped minor pays once, to its first helper.
  for (const country of Object.keys(state.countries ?? {}).sort() as CountryId[]) {
    const record = state.countries![country]!;
    if (record.status !== "allied" || record.helpers?.[MC19_INCOME_HELPER_INDEX] !== side || conquered.has(country)) continue;
    if (state.minorAllies.some((a) => a.owner === country && a.active)) continue; // R13: one value per country.
    const capital = capitalOf(ctx, country);
    const recipientSide = sideInWar(state, side);
    if (capital === null || recipientSide === null) continue;
    const start = startingControl(ctx).get(capital);
    if (start !== undefined && sideOfOwner(start) === recipientSide) continue; // R13: starting holdings cannot add income.
    const holder = controllerOf(ctx, state, capital);
    if (MC20_REQUIRE_FRIENDLY_CAPITAL && (holder === null || sideInWar(state, holder) !== recipientSide)) continue;
    lines.push({ country, kind: "helped-minor", brps: minorValue(country) ?? UNREAD_CONQUERED_VALUE });
  }
  // R13 item 3: delegate completion dates, current holders, starting land and all-city tests to 15-5.
  for (const line of conqueredIncomeLines(ctx, state, side)) {
    lines.push({ country: line.country, kind: "conquered", brps: line.value });
  }
  return { lines, total: lines.reduce((total, line) => total + line.brps, 0) };
}
