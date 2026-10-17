import { airCapacity } from "./air-bases";
import { cacheOf, isBox, resolveArea, resolveAreas, territoryOf, union, type Place, type Resolved } from "./areas";
import type { GameContext } from "./context";
import { setupOf } from "./game";
import { portCapacity } from "./naval-ports";
import { AIR_FACTOR_STACKING_LIMIT, NAVAL_FACTOR_STACKING_LIMIT, STACKING_LIMIT, STACKING_LIMIT_LONDON_BRITISH } from "./tables";
import { AIR_BASE_FEATURES, NAVAL_BASE_FEATURES } from "./terrain";
import type { ForceOwner, GameState, Unit, UnitType } from "./types";

/**
 * Where a counter may be placed at setup: the owner's territory and permissions, the kind of base
 * it needs, stacking (Ref 5.0) and the scenario's factor maxima.
 */

/** A counter as the Forces Box shows it: what a placement names. */
export interface UnitSpec {
  type: UnitType;
  strength: number;
  nationality?: ForceOwner;
}

export const matchesSpec = (type: UnitType | UnitType[] | "all", nationality: ForceOwner | "own" | undefined, spec: UnitSpec) => {
  if (type !== "all" && !(Array.isArray(type) ? type.includes(spec.type) : type === spec.type)) return false;
  if (nationality === undefined) return true;
  return nationality === "own" ? spec.nationality === undefined : spec.nationality === nationality;
};

const suitsBase = (ctx: GameContext, type: UnitType, place: Place): boolean => {
  if (isBox(place)) return true;
  const h = ctx.map.hexes[place];
  if (!h || !h.land) return false;
  if (type === "air") return h.features.some((f) => AIR_BASE_FEATURES.includes(f));
  if (type === "fleet") return h.features.some((f) => NAVAL_BASE_FEATURES.includes(f));
  return type === "infantry" || type === "armor" || type === "airborne" || type === "replacement";
};

/** Places where this owner may set up this counter, before stacking and requirement limits. */
export function allowedPlaces(ctx: GameContext, owner: ForceOwner, spec: UnitSpec): Resolved {
  const cache = cacheOf(ctx).allowed;
  const key = `${owner}|${spec.type}|${spec.strength}|${spec.nationality ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const resolved = allowedPlacesUncached(ctx, owner, spec);
  cache.set(key, resolved);
  return resolved;
}

function allowedPlacesUncached(ctx: GameContext, owner: ForceOwner, spec: UnitSpec): Resolved {
  const f = setupOf(ctx.scenario, owner);
  let allowed = territoryOf(ctx, owner);
  for (const p of f.mayAlsoSetUpIn) {
    if (p.types && !p.types.includes(spec.type)) continue;
    for (const a of p.areas) allowed = union(allowed, resolveArea(ctx, a));
  }
  // A requirement may name an off-map box (the U.S. Box), which no territory covers.
  for (const r of f.setup) {
    if (r.kind === "min-factors" || r.kind === "max-factors" || r.kind === "min-ground-factors-near") continue;
    for (const a of r.in) if (a.kind === "box") allowed = union(allowed, resolveArea(ctx, a));
  }
  let places = allowed.places;
  let unresolved = allowed.unresolved;
  const restrict = (r: Resolved) => {
    places = new Set([...places].filter((p) => r.places.has(p)));
    unresolved = [...new Set([...unresolved, ...r.unresolved])];
  };
  for (const r of f.setup) {
    if (r.kind === "all-in" && matchesSpec(r.types, r.nationality, spec)) restrict(resolveAreas(ctx, r.in));
  }
  const rest = f.setup.find((r) => r.kind === "rest-in");
  if (rest && rest.kind === "rest-in") {
    // The rest go in these areas; counters that a "place" requirement asks for may also go in its areas.
    let ok = resolveAreas(ctx, rest.in);
    for (const r of f.setup) {
      if (r.kind === "place" && r.type === spec.type && (r.strength === undefined || r.strength === spec.strength)) {
        ok = resolveAreas(ctx, r.in, ok);
      }
    }
    restrict(ok);
  }
  return { places: new Set([...places].filter((p) => suitsBase(ctx, spec.type, p))), unresolved };
}

// --- units on the map -------------------------------------------------------------------

export const GROUND_FOR_STACKING: readonly UnitType[] = ["infantry", "armor", "replacement"];
export const FACTOR_TYPES: readonly UnitType[] = ["infantry", "armor", "airborne", "replacement", "air"];

const unitsAt = (state: GameState, place: Place): Unit[] => Object.values(state.units).filter((u) => u.at === place);
export const unitsOf = (state: GameState, owner: ForceOwner): Unit[] => Object.values(state.units).filter((u) => u.owner === owner);
export const factorsOf = (u: Pick<Unit, "type" | "strength">): number => (FACTOR_TYPES.includes(u.type) ? u.strength : 0);

/** Why stacking forbids this counter in this hex (Ref 5.0, 26.0), or null if it fits. Boxes have no stacking limit. */
export function stackingProblem(ctx: GameContext, state: GameState, owner: ForceOwner, spec: UnitSpec, place: Place): string | null {
  if (isBox(place)) return null;
  const here = unitsAt(state, place);
  if (GROUND_FOR_STACKING.includes(spec.type)) {
    const ground = here.filter((u) => GROUND_FOR_STACKING.includes(u.type));
    // Ref 5.0: two ground units per hex; three in London if all three are British. Airborne never count.
    const allBritish = owner === "britain" && ground.every((u) => u.owner === "britain");
    const limit = ctx.map.hexes[place]?.name === "London" && allBritish ? STACKING_LIMIT_LONDON_BRITISH : STACKING_LIMIT;
    if (ground.length + 1 > limit) return `${place} already holds ${ground.length} ground units (limit ${limit}).`;
  }
  if (spec.type === "air") {
    const air = here.filter((u) => u.type === "air").reduce((n, u) => n + u.strength, 0);
    // Ref 20.1, 5.0: the hex's own capacity (5 per city, 5 per airbase counter). A hex that is no base keeps the old flat limit: whether air may be there at all is suitsBase's question.
    const capacity = airCapacity(ctx, state, place);
    const limit = capacity > 0 ? capacity : AIR_FACTOR_STACKING_LIMIT;
    if (air + spec.strength > limit) return `${place} would hold ${air + spec.strength} air factors (limit ${limit}).`;
  }
  if (spec.type === "fleet") {
    const naval = here.filter((u) => u.type === "fleet").reduce((n, u) => n + u.strength, 0);
    // Ref 21.1, 5.0: the port's own capacity (36; 9 at Malta, Suda Bay and Famagusta). A hex that is no port keeps the old flat limit: whether a fleet may be there at all is suitsBase's question.
    const capacity = portCapacity(ctx, place);
    const limit = capacity > 0 ? capacity : NAVAL_FACTOR_STACKING_LIMIT;
    if (naval + spec.strength > limit) return `${place} would hold ${naval + spec.strength} naval factors (limit ${limit}).`;
  }
  // Ref 26.0: before 1942 British and French units may not stack together.
  if (state.year < 1942 && (owner === "britain" || owner === "france")) {
    const other = owner === "britain" ? "france" : "britain";
    if (here.some((u) => u.owner === other)) return `British and French units may not stack together before 1942.`;
  }
  return null;
}

/** Whether a base suits the counter: ground units on land, air units on air bases, fleets in ports. */
export const baseSuits = suitsBase;

/** Why a counter cannot be placed in a place right now, or null if it can. */
export function placementProblem(ctx: GameContext, state: GameState, owner: ForceOwner, spec: UnitSpec, place: Place): string | null {
  const allowed = allowedPlaces(ctx, owner, spec);
  if (!allowed.places.has(place)) return `${place} is not a place where ${owner} may set up a ${spec.type}.`;
  const stacking = stackingProblem(ctx, state, owner, spec, place);
  if (stacking) return stacking;
  // "At most N factors in an area" (Peele's errata: five in Finland).
  const added = factorsOf(spec);
  for (const r of setupOf(ctx.scenario, owner).setup) {
    if (r.kind !== "max-factors" || added === 0 || isBox(place)) continue;
    const area = resolveArea(ctx, r.area);
    if (!area.places.has(place)) continue;
    const there = unitsOf(state, owner).filter((u) => area.places.has(u.at)).reduce((n, u) => n + factorsOf(u), 0);
    if (there + added > r.max) return `${owner} may set up at most ${r.max} factors there.`;
  }
  return null;
}

/** Every place the counter can be placed now, in a fixed order. */
export function placementPlaces(ctx: GameContext, state: GameState, owner: ForceOwner, spec: UnitSpec): Place[] {
  return [...allowedPlaces(ctx, owner, spec).places].sort(comparePlaces(ctx)).filter((p) => placementProblem(ctx, state, owner, spec, p) === null);
}

/** Boxes last, then hexes with something worth holding (objective, capital, city, port) first, then by id. */
const comparePlaces = (ctx: GameContext) => (a: Place, b: Place) => {
  const rank = (p: Place) => {
    if (isBox(p)) return 9;
    const f = ctx.map.hexes[p]?.features ?? [];
    if (f.includes("capital") || f.includes("capital-port")) return 0;
    if (f.includes("objective")) return 1;
    if (f.includes("city") || f.includes("port")) return 2;
    return 3;
  };
  return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
};
