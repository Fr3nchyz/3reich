import { controllerOf, sideInWar } from "./control";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { AIR_PER_AIRBASE, AIR_PER_CITY, ANGLO_FRENCH_BASE_BAN_UNTIL, CAPITAL_AIR_MAX, DOUBLE_CITY_HEXES, WESTERN_ALLIED_OWNERS } from "./air-rules";
import { AIR_BASE_FEATURES } from "./terrain";
import type { ForceOwner, GameState, Side, Unit } from "./types";

/**
 * Where air units may sit (spec 09 R1 and R3; Ref 20.1, 5.0, 4.7): how many air factors a hex bases, who may use which base, and
 * the lists of bases. Pure queries on a state; nothing here changes one. Staging, missions and displacement build on them.
 */

/** The nationality a counter flies under: the one printed on it, else its owner. */
export const nationOf = (u: Pick<Unit, "owner" | "nationality">): ForceOwner => u.nationality ?? u.owner;

/** How many cities the hex holds: 0 if it is not a base feature, 1 for a city, port, capital or objective, 2 for a listed double city (Ref 20.1). */
export function citiesAt(ctx: GameContext, hex: HexId): number {
  const h = ctx.map.hexes[hex];
  if (!h || !h.land || !h.features.some((f) => AIR_BASE_FEATURES.includes(f))) return 0;
  return DOUBLE_CITY_HEXES.includes(hex) ? 2 : 1;
}

/** The airbase counters standing in the hex (Ref 20.1). */
export const airbasesAt = (state: GameState, hex: HexId): number => Object.values(state.units).filter((u) => u.type === "airbase" && u.at === hex).length;

/**
 * The air factors the hex can base (Ref 20.1, 5.0): 5 per city plus 5 per airbase counter; a Capital never more than 10.
 * 0 for a hex that is not a base (open ground without an airbase counter, sea). Malta (Ref 33.0) is one city, so 5.
 */
export function airCapacity(ctx: GameContext, state: GameState, hex: HexId): number {
  const raw = citiesAt(ctx, hex) * AIR_PER_CITY + airbasesAt(state, hex) * AIR_PER_AIRBASE;
  const features = ctx.map.hexes[hex]?.features ?? [];
  return features.includes("capital") || features.includes("capital-port") ? Math.min(raw, CAPITAL_AIR_MAX) : raw;
}

/** Whether air units can be based in the hex at all: a city hex or a hex with an airbase counter. */
export const isAirBase = (ctx: GameContext, state: GameState, hex: HexId): boolean => airCapacity(ctx, state, hex) > 0;

/** The air factors standing in the hex now, whoever owns them. */
export const airFactorsAt = (state: GameState, hex: HexId): number =>
  Object.values(state.units).filter((u) => u.type === "air" && u.at === hex).reduce((n, u) => n + u.strength, 0);

/** Free air factors in the hex now: capacity less what stands there, never below 0. */
export const airRoom = (ctx: GameContext, state: GameState, hex: HexId): number => Math.max(0, airCapacity(ctx, state, hex) - airFactorsAt(state, hex));

/**
 * The nation whose base this is: the controller of a city hex; for an airbase counter on open ground, the counter's owner.
 * TODO(verify, Ref 20.1): the manual does not say how the owner of a base is read; this is the nearest reading of "each other's bases".
 */
function baseNation(ctx: GameContext, state: GameState, hex: HexId): ForceOwner | null {
  if (citiesAt(ctx, hex) > 0) return controllerOf(ctx, state, hex);
  return Object.values(state.units).find((u) => u.type === "airbase" && u.at === hex)?.owner ?? null;
}

/** Why air of nation `a` may not use bases of nation `b`, or null (Ref 20.1): British and French before 1942, Russian and Western Allied ever. */
export function baseBan(state: Pick<GameState, "year">, a: ForceOwner, b: ForceOwner): string | null {
  if (state.year < ANGLO_FRENCH_BASE_BAN_UNTIL && ((a === "britain" && b === "france") || (a === "france" && b === "britain"))) {
    return `British and French air may not use each other's bases before ${ANGLO_FRENCH_BASE_BAN_UNTIL}.`;
  }
  if ((a === "ussr" && WESTERN_ALLIED_OWNERS.includes(b)) || (b === "ussr" && WESTERN_ALLIED_OWNERS.includes(a))) return "Russian and Western Allied air may not use each other's bases.";
  return null;
}

/**
 * Why this air unit may not be based in the hex, or null if it may (Ref 20.1): the hex is not a base, is not held by the unit's side,
 * or belongs to a nation whose bases it may not use. Room is not looked at here (`airRoom`, stackingProblem). Italian units lent to
 * Germany (nationality Italy, owner Germany) are free to use German bases: no rule bans an ally of the same side.
 */
export function baseProblem(ctx: GameContext, state: GameState, u: Pick<Unit, "owner" | "nationality">, hex: HexId): string | null {
  if (!isAirBase(ctx, state, hex)) return `${hex} is not an air base: only a city or a hex with an airbase counter bases air units.`;
  const mine = sideInWar(state, u.owner);
  const holder = baseNation(ctx, state, hex);
  if (mine === null || holder === null || sideInWar(state, holder) !== mine) return `${hex} is not held by the ${mine ?? "same"} side.`;
  return baseBan(state, nationOf(u), holder);
}

/** Whether this air unit may be based in the hex (`baseProblem` is null). */
export const mayBaseAt = (ctx: GameContext, state: GameState, u: Pick<Unit, "owner" | "nationality">, hex: HexId): boolean => baseProblem(ctx, state, u, hex) === null;

/** Every air base the side holds now, in hex-id order: city hexes it controls and hexes with an airbase counter of its side. */
export function airBasesOf(ctx: GameContext, state: GameState, side: Side): HexId[] {
  return Object.keys(ctx.map.hexes).sort().filter((hex) => {
    if (!isAirBase(ctx, state, hex)) return false;
    const holder = baseNation(ctx, state, hex);
    return holder !== null && sideInWar(state, holder) === side;
  });
}
