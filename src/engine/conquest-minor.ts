import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { areEnemies, controllerOf, sideInWar, startingControl } from "./control";
import { conquer } from "./conquest-stages";
import { isConquered, type Conquest, type FallenCountry } from "./conquest-record";
import { otherSide } from "./game";
import type { HexId } from "./hex";
import { sideOfOwner } from "./setup";
import type { ForceOwner, GameState, MinorCountry } from "./types";

/**
 * Every country that is not a Major Power falls the same way (spec 14 R9, C8; Ref 14.0, 16.0, 17.1, 29.0; PC README 24.23): Poland first, in every
 * 1939 game, then the minor countries, the Axis Minor-Allies, and the colonies and Eastern Europe that spec 15 conquers by holding all their cities.
 *
 * A MINOR COUNTRY falls the moment a hostile unit holds its capital, with no turn to retake it: at the end of the ATTACKER's Combat Phase (leaving step
 * 7p of the side that holds the capital) its units and pool leave the game for good and every hex of the country passes to the conqueror, except the hexes
 * under hostile ground units (`TRAPPED_UNITS_KEEP_ONLY_THEIR_HEX`, V12; the supply line they trace is ticket 14-23). An inactive Minor-Ally falls the same
 * way and can then never be activated: the Conquest record is the flag (`isConquered`, which spec 15's wake-up reads).
 *
 * THE CONTRACT FOR SPEC 15 (colonies, Eastern Europe): when its all-cities test is met, call
 * `fallCountry(ctx, state, { country, conqueror, how: "all-cities" })` once. It records the Conquest, removes the units and pool of an owner named like
 * the country (if the minor-country spec gives its counters that owner), passes the land (every land hex whose map country is `country`, or the `hexes`
 * you pass: Eastern Europe is a group of hexes, not a map country), writes COUNTRY_CONQUERED, UNITS_REMOVED_BY_CONQUEST and CONTROL_PASSED, sweeps the
 * conqueror's enemies' lone counters out of the land that passed, and ends the game if the conquest decides it. It does not pay BRPs (spec 15's income reads
 * the record), it does not decide whether the country is conquered (the caller does), and it changes nothing if the country is already conquered.
 * A Major Power falls through `fall()` (conquest.ts) instead.
 */

/** The minor countries and Minor-Allies that have a capital hex on the map (Ref 16.0). Persia and Arabia have none and are never conquered (nothing is lost). */
export const CONQUERED_BY_CAPITAL_MINORS: readonly MinorCountry[] = [
  "belgium", "bulgaria", "denmark", "finland", "greece", "hungary", "ireland", "luxembourg", "netherlands", "norway", "poland", "portugal", "rumania", "spain", "sweden", "turkey", "yugoslavia",
];

const capitals = new WeakMap<GameContext, ReadonlyMap<string, HexId>>();

/**
 * The capital hex of a minor country: the map's `capital` hex of that country. TODO(verify) V36 (MC7): Luxembourg has one hex and no capital on the map; that
 * hex is its capital, so that it can be conquered. Null for a country with none.
 */
export function minorCapital(ctx: GameContext, country: string): HexId | null {
  let hit = capitals.get(ctx);
  if (!hit) {
    const out = new Map<string, HexId>();
    for (const h of Object.values(ctx.map.hexes)) {
      if (h.land && h.country !== undefined && h.features.some((f) => f === "capital" || f === "capital-port")) out.set(h.country, h.id);
    }
    const luxembourg = Object.values(ctx.map.hexes).filter((h) => h.land && h.country === "luxembourg");
    if (luxembourg.length === 1) out.set("luxembourg", luxembourg[0]!.id);
    capitals.set(ctx, (hit = out));
  }
  return hit.get(country) ?? null;
}

/** The owners that fight with `owner`: itself and, for an Axis Minor-Ally, its Major Power (a Hungarian unit in Belgrade is at war with Yugoslavia when Germany is). */
const fightsAs = (state: GameState, owner: ForceOwner): ForceOwner[] => [owner, ...state.minorAllies.filter((m) => m.owner === owner).map((m) => m.of)];

export interface FallingMinor {
  country: MinorCountry;
  conqueror: ForceOwner;
}

/**
 * The minor countries that fall at the end of this side's Combat Phase (ticket 14-6): not conquered yet, with the capital held now by an enemy of the
 * country on `side`, who did not hold it when the scenario began (a country that was taken before the scenario started, such as Norway in 1942 or Poland in
 * 1942 and 1944, is not conquered again by standing there). Control is read as in 14-5: the unit need not still be in the capital. In the order of
 * `CONQUERED_BY_CAPITAL_MINORS`. TODO(verify) V36.
 */
export function minorsFalling(ctx: GameContext, state: GameState, side: GameState["activeSide"]): FallingMinor[] {
  const out: FallingMinor[] = [];
  for (const country of CONQUERED_BY_CAPITAL_MINORS) {
    const capital = minorCapital(ctx, country);
    if (capital === null || isConquered(state, country)) continue;
    const holder = controllerOf(ctx, state, capital);
    if (holder === null || holder === (country as ForceOwner) || holder === startingControl(ctx).get(capital) || sideInWar(state, holder) !== side) continue;
    if (fightsAs(state, holder).some((o) => areEnemies(state, o, country as ForceOwner))) out.push({ country, conqueror: holder });
  }
  return out;
}

/** A country that falls through `fallCountry`. */
export interface CountryFall {
  /** Not a Major Power. */
  country: FallenCountry;
  /** The owner that conquers it: the owner of the unit in its capital, or that holds all its cities. */
  conqueror: ForceOwner;
  how?: Conquest["how"];
  /** The country's land, when it is not every land hex whose map country is `country` (Eastern Europe: the hexes it is made of). */
  hexes?: readonly HexId[];
}

/** The land of a country: the `hexes` given, else the scenario's zone of that name (Eastern Europe), else every land hex of the map country. */
export function countryLand(ctx: GameContext, country: FallenCountry, hexes?: readonly HexId[]): Set<HexId> {
  if (hexes) return new Set(hexes);
  const zone = country === "eastern-europe" ? ctx.scenario.zones["eastern-europe"]?.hexes : undefined;
  if (zone) return new Set(zone);
  return new Set(Object.values(ctx.map.hexes).filter((h) => h.land && h.country === country).map((h) => h.id));
}

/**
 * A minor country, a colony or Eastern Europe falls to its conqueror: the stages of `conquer` (conquest-stages.ts) with the country's own particulars. Its
 * units and pool leave (those of the owner named like it; its own Minor-Ally record, if any, becomes inactive for good); every hex of its land passes to the
 * conqueror (see `PassRule.land`); the land it held anywhere else becomes nobody's (V11). No BRPs change (spec 15 pays the country's value). The side the
 * country fought on is the one it fights for, or else the opposite of the conqueror's. Idempotent: a country already conquered is left alone.
 */
export function fallCountry(ctx: GameContext, state: GameState, req: CountryFall): { state: GameState; events: GameEvent[] } {
  const { country, conqueror } = req;
  if (isConquered(state, country)) return { state, events: [] };
  const land = countryLand(ctx, country, req.hexes);
  const owner = country as ForceOwner; // a minor's counters, if any, are owned by the minor's own id (spec 15); a name no unit has changes nothing
  return conquer(ctx, state, {
    country,
    who: country,
    owners: [owner],
    conqueror,
    side: sideInWar(state, owner) ?? otherSide(sideOfOwner(conqueror)),
    how: req.how ?? "capital",
    isHome: (hex) => land.has(hex.id),
    land,
    mark: (s) => ({ ...s, minorAllies: s.minorAllies.map((m) => (m.owner === owner && m.active ? { ...m, active: false } : m)) }),
  });
}

/**
 * Leaving step 7p of the active side's Player Turn (called by `settleConquests` after the Major Powers): each minor country whose capital this side holds
 * falls to the holder. Stops as soon as one of the falls ends the game.
 */
export function settleMinorConquests(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  for (let n = 0; n < CONQUERED_BY_CAPITAL_MINORS.length && next.phase === "player-turn"; n++) { // each fall takes a country out of `minorsFalling`
    const falling = minorsFalling(ctx, next, next.activeSide)[0];
    if (falling === undefined) break;
    const done = fallCountry(ctx, next, { country: falling.country, conqueror: falling.conqueror });
    next = done.state;
    events.push(...done.events);
  }
  return { state: next, events };
}
