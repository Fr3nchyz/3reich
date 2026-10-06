/**
 * Opening setup (Ops 4.0, 4.1, 7.0): each owner, in the scenario's order of deployment, places
 * its Force Pool on the map, then the first Player Turn begins. A placement is legal if it is in
 * the owner's territory, suits the counter (ground units on land, air units on air bases, fleets
 * in ports), respects stacking (Ref 5.0) and the scenario's setup requirements. Pressing "Done"
 * is legal once every counter is placed and every requirement is met.
 *
 * TODO(verify): the manual does not say whether a nation may leave Force Pool counters off the
 * map at setup; the engine requires all of them to be placed.
 * TODO(verify): Ref 29.0 forbids Germany to set up in Bessarabia in Fall 1939; its hexes are
 * not marked on the map, so German setup in Rumania is not yet limited.
 */
import type { Action, ActionResult, GameEvent } from "./actions";
import type { GameContext } from "./context";
import { setupOf } from "./game";
import { hex, hexId, neighbors, type HexId } from "./hex";
import type { MapHex } from "./map";
import { AIR_FACTOR_STACKING_LIMIT, NAVAL_FACTOR_STACKING_LIMIT, STACKING_LIMIT, STACKING_LIMIT_LONDON_BRITISH } from "./tables";
import { AIR_BASE_FEATURES, NAVAL_BASE_FEATURES } from "./terrain";
import type {
  Area,
  ForceEntry,
  ForceOwner,
  GameState,
  OffMapBox,
  SetupRequirement,
  Side,
  Unit,
  UnitType,
} from "./types";

export type Place = HexId | OffMapBox;
const BOXES: readonly OffMapBox[] = ["us-box", "murmansk-box"];
const isBox = (p: string): p is OffMapBox => (BOXES as readonly string[]).includes(p);

/** A counter as the Forces Box shows it: what a placement names. */
export interface UnitSpec {
  type: UnitType;
  strength: number;
  nationality?: ForceOwner;
}

/** Places plus the zones whose hexes are still unknown (so the places are incomplete). */
export interface Resolved {
  places: Set<Place>;
  unresolved: string[];
}

const AXIS_OWNERS: readonly ForceOwner[] = ["germany", "italy", "finland", "rumania", "hungary", "bulgaria", "vichy-france"];

/**
 * The side whose player sets an owner up. Italy is the Axis player's even while neutral;
 * Poland, the USSR and the USA are the Allied player's.
 */
export function sideOfOwner(owner: ForceOwner): Side {
  return AXIS_OWNERS.includes(owner) ? "axis" : "allies";
}

/** The owner now setting up, or null outside the setup phase. */
export function currentSetupOwner(state: GameState): ForceOwner | null {
  if (state.phase !== "setup" || !state.setup) return null;
  return state.setup.order[state.setup.index] ?? null;
}

// --- areas ----------------------------------------------------------------------------

export const union = (a: Resolved, b: Resolved): Resolved => ({
  places: new Set([...a.places, ...b.places]),
  unresolved: [...new Set([...a.unresolved, ...b.unresolved])],
});
export const EMPTY: Resolved = { places: new Set(), unresolved: [] };

// Territory, areas and allowed places depend only on the context, which never changes, so they
// are worked out once per context.
const caches = new WeakMap<GameContext, { hexes: MapHex[]; areas: Map<string, Resolved>; territory: Map<string, Resolved>; allowed: Map<string, Resolved> }>();
function cacheOf(ctx: GameContext) {
  let c = caches.get(ctx);
  if (!c) caches.set(ctx, (c = { hexes: Object.values(ctx.map.hexes), areas: new Map(), territory: new Map(), allowed: new Map() }));
  return c;
}

export function resolveArea(ctx: GameContext, area: Area, seen: ForceOwner[] = []): Resolved {
  const cache = cacheOf(ctx).areas;
  const key = JSON.stringify(area);
  const hit = cache.get(key);
  if (hit) return hit;
  const resolved = resolveAreaUncached(ctx, area, seen);
  cache.set(key, resolved);
  return resolved;
}

function resolveAreaUncached(ctx: GameContext, area: Area, seen: ForceOwner[]): Resolved {
  const hexes = cacheOf(ctx).hexes;
  const of = (pred: (h: MapHex) => boolean): Resolved => ({
    places: new Set(hexes.filter(pred).map((h) => h.id)),
    unresolved: [],
  });
  if ("country" in area) return of((h) => !!h.land && h.country === area.country);
  if ("hex" in area) return of((h) => !!h.land && h.id === area.hex);
  if ("ports" in area) return of((h) => !!h.land && h.front === area.ports && h.features.some((f) => NAVAL_BASE_FEATURES.includes(f)));
  if ("front" in area) return of((h) => !!h.land && h.front === area.front);
  if ("box" in area) return { places: new Set([area.box]), unresolved: [] };
  if ("zone" in area) {
    const zone = ctx.scenario.zones[area.zone];
    if (!zone?.hexes) return { places: new Set(), unresolved: [area.zone] };
    return { places: new Set(zone.hexes), unresolved: [] };
  }
  if (seen.includes(area.controlledBy)) return EMPTY;
  return territoryOf(ctx, area.controlledBy, [...seen, area.controlledBy]);
}

/** Hexes an owner controls at the start: whole countries plus zones. */
export function territoryOf(ctx: GameContext, owner: ForceOwner, seen: ForceOwner[] = [owner]): Resolved {
  const cache = cacheOf(ctx).territory;
  const hit = cache.get(owner);
  if (hit) return hit;
  const f = setupOf(ctx.scenario, owner);
  let out = EMPTY;
  for (const c of f.controlledAtStart) out = union(out, resolveArea(ctx, { country: c }, seen));
  for (const z of f.controlledZones) out = union(out, resolveArea(ctx, { zone: z }, seen));
  cache.set(owner, out);
  return out;
}

const matchesSpec = (type: UnitType | UnitType[] | "all", nationality: ForceOwner | "own" | undefined, spec: UnitSpec) => {
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
    for (const a of r.in) if ("box" in a) allowed = union(allowed, resolveArea(ctx, a));
  }
  let places = allowed.places;
  let unresolved = allowed.unresolved;
  const restrict = (r: Resolved) => {
    places = new Set([...places].filter((p) => r.places.has(p)));
    unresolved = [...new Set([...unresolved, ...r.unresolved])];
  };
  for (const r of f.setup) {
    if (r.kind === "all-in" && matchesSpec(r.types, r.nationality, spec)) restrict(r.in.reduce((acc, a) => union(acc, resolveArea(ctx, a)), EMPTY));
  }
  const rest = f.setup.find((r) => r.kind === "rest-in");
  if (rest && rest.kind === "rest-in") {
    // The rest go in these areas; counters that a "place" requirement asks for may also go in its areas.
    let ok = rest.in.reduce((acc, a) => union(acc, resolveArea(ctx, a)), EMPTY);
    for (const r of f.setup) {
      if (r.kind === "place" && r.type === spec.type && (r.strength === undefined || r.strength === spec.strength)) {
        ok = r.in.reduce((acc, a) => union(acc, resolveArea(ctx, a)), ok);
      }
    }
    restrict(ok);
  }
  return { places: new Set([...places].filter((p) => suitsBase(ctx, spec.type, p))), unresolved };
}

// --- units on the map -------------------------------------------------------------------

const GROUND_FOR_STACKING: readonly UnitType[] = ["infantry", "armor", "replacement"];
export const FACTOR_TYPES: readonly UnitType[] = ["infantry", "armor", "airborne", "replacement", "air"];

const unitsAt = (state: GameState, place: Place): Unit[] => Object.values(state.units).filter((u) => u.at === place);
export const unitsOf = (state: GameState, owner: ForceOwner): Unit[] => Object.values(state.units).filter((u) => u.owner === owner);
export const factorsOf = (u: Pick<Unit, "type" | "strength">): number => (FACTOR_TYPES.includes(u.type) ? u.strength : 0);

/** Why a counter cannot be placed in a place right now, or null if it can. */
export function placementProblem(ctx: GameContext, state: GameState, owner: ForceOwner, spec: UnitSpec, place: Place): string | null {
  const allowed = allowedPlaces(ctx, owner, spec);
  if (!allowed.places.has(place)) return `${place} is not a place where ${owner} may set up a ${spec.type}.`;
  if (!isBox(place)) {
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
      if (air + spec.strength > AIR_FACTOR_STACKING_LIMIT) return `${place} would hold ${air + spec.strength} air factors (limit ${AIR_FACTOR_STACKING_LIMIT}).`;
    }
    if (spec.type === "fleet") {
      const naval = here.filter((u) => u.type === "fleet").reduce((n, u) => n + u.strength, 0);
      if (naval + spec.strength > NAVAL_FACTOR_STACKING_LIMIT) return `${place} would hold ${naval + spec.strength} naval factors (limit ${NAVAL_FACTOR_STACKING_LIMIT}).`;
    }
    // Ref 26.0: before 1942 British and French units may not stack together.
    if (state.year < 1942 && (owner === "britain" || owner === "france")) {
      const other = owner === "britain" ? "france" : "britain";
      if (here.some((u) => u.owner === other)) return `British and French units may not stack together before 1942.`;
    }
  }
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

// --- requirements ---------------------------------------------------------------------

const unitMatches = (u: Unit, r: { type: UnitType; strength?: number }) => u.type === r.type && (r.strength === undefined || u.strength === r.strength) && u.nationality === undefined;

export function countsForMinFactors(ctx: GameContext, r: Extract<SetupRequirement, { kind: "min-factors" }>, u: Unit): boolean {
  if (isBox(u.at)) return false;
  const h = ctx.map.hexes[u.at];
  if (!h || !h.land) return false;
  if (h.front === r.front && !(r.excludeCountries ?? []).includes(h.country ?? "")) return true;
  if (r.alsoCountsAdjacentTo && h.front === "western") {
    return neighbors(hex(u.at)).some((n) => {
      const nh = ctx.map.hexes[hexId(n)];
      return !!nh && !!nh.land && nh.country === r.alsoCountsAdjacentTo;
    });
  }
  return false;
}

/** Everything that stops this owner from pressing Done, in plain words. Empty when it may. */
export function setupProblems(ctx: GameContext, state: GameState, owner: ForceOwner): string[] {
  const problems: string[] = [];
  const f = setupOf(ctx.scenario, owner);
  const pool = state.pools[owner]?.forcePool ?? [];
  const left = pool.reduce((n, e) => n + e.count, 0);
  if (left > 0) problems.push(`${left} counter${left === 1 ? "" : "s"} still to place.`);

  const mine = unitsOf(state, owner);
  const unresolved: string[] = [];
  const placesOf = (areas: Area[]) => {
    const r = areas.reduce((acc, a) => union(acc, resolveArea(ctx, a)), EMPTY);
    unresolved.push(...r.unresolved);
    return r.places;
  };
  const used = new Set<string>();
  for (const r of f.setup) {
    if (r.kind === "place") {
      const places = placesOf(r.in);
      const have = mine.filter((u) => unitMatches(u, r) && places.has(u.at));
      have.slice(0, r.count).forEach((u) => used.add(u.id));
      if (have.length < r.count) problems.push(`Needs ${r.count} ${r.strength ?? "any"}-factor ${r.type} in ${describeAreas(r.in)}; has ${have.length}.`);
    } else if (r.kind === "all-in") {
      const places = placesOf(r.in);
      const outside = mine.filter((u) => matchesSpec(r.types, r.nationality, u) && !places.has(u.at));
      if (outside.length) problems.push(`${outside.length} ${r.types === "all" ? "counters" : r.types.join("/")} must be in ${describeAreas(r.in)}.`);
    } else if (r.kind === "min-factors") {
      const n = mine.filter((u) => countsForMinFactors(ctx, r, u)).reduce((sum, u) => sum + factorsOf(u), 0);
      if (n < r.min) problems.push(`Needs at least ${r.min} factors on the ${r.front} front; has ${n}.`);
    } else if (r.kind === "max-factors") {
      const places = placesOf([r.area]);
      const n = mine.filter((u) => places.has(u.at)).reduce((sum, u) => sum + factorsOf(u), 0);
      if (n > r.max) problems.push(`At most ${r.max} factors in ${describeAreas([r.area])}; has ${n}.`);
    } else if (r.kind === "min-ground-factors-near") {
      const near = new Set<string>(r.hexes);
      for (const h of r.hexes) for (const n of neighbors(hex(h))) near.add(hexId(n));
      const n = mine.filter((u) => near.has(u.at) && GROUND_FOR_STACKING.concat("airborne").includes(u.type)).reduce((sum, u) => sum + u.strength, 0);
      if (n < r.min) problems.push(`Needs at least ${r.min} ground factors in or next to ${r.hexes.join(" and ")}; has ${n}.`);
    }
  }
  // "The rest of its forces" go in the rest-in areas, once the named placements are accounted for.
  for (const r of f.setup) {
    if (r.kind !== "rest-in") continue;
    const places = placesOf(r.in);
    const outside = mine.filter((u) => !used.has(u.id) && !places.has(u.at));
    if (outside.length) problems.push(`${outside.length} counters must be in ${describeAreas(r.in)}.`);
  }
  if (unresolved.length) problems.push(`Needs territory that is not yet known: ${[...new Set(unresolved)].join(", ")}.`);
  return problems;
}

function describeAreas(areas: Area[]): string {
  return areas
    .map((a) => ("country" in a ? a.country : "hex" in a ? a.hex : "ports" in a ? `${a.ports} ports` : "front" in a ? `the ${a.front} front` : "box" in a ? a.box : "zone" in a ? a.zone : `${a.controlledBy}-controlled territory`))
    .join(" or ");
}

/**
 * Whether the scenario can be set up yet: the zones its setup rules rely on must have known
 * hexes (see Scenario.zones). 1939 and Campaign can; 1942 and 1944 cannot until the start lines
 * are known.
 */
export function setupStatus(ctx: GameContext): { startable: boolean; unresolved: string[] } {
  const unresolved = new Set<string>();
  const note = (r: Resolved) => r.unresolved.forEach((z) => unresolved.add(z));
  for (const owner of ctx.scenario.deploymentOrder) {
    note(territoryOf(ctx, owner));
    const f = setupOf(ctx.scenario, owner);
    for (const p of f.mayAlsoSetUpIn) for (const a of p.areas) note(resolveArea(ctx, a));
    for (const r of f.setup) {
      if (r.kind === "min-factors" || r.kind === "min-ground-factors-near") continue;
      for (const a of r.kind === "max-factors" ? [r.area] : r.in) note(resolveArea(ctx, a));
    }
  }
  return { startable: unresolved.size === 0, unresolved: [...unresolved].sort() };
}

// --- actions --------------------------------------------------------------------------

const poolKey = (e: Pick<ForceEntry, "type" | "strength" | "nationality">) => `${e.type}:${e.strength}:${e.nationality ?? ""}`;

/** The distinct counters in an owner's pool, in pool order. */
export function poolSpecs(state: GameState, owner: ForceOwner): (UnitSpec & { movement?: number; count: number })[] {
  const out = new Map<string, UnitSpec & { movement?: number; count: number }>();
  for (const e of state.pools[owner]?.forcePool ?? []) {
    if (e.count <= 0) continue;
    const k = poolKey(e);
    const have = out.get(k);
    if (have) have.count += e.count;
    else out.set(k, { type: e.type, strength: e.strength, ...(e.nationality ? { nationality: e.nationality } : {}), ...(e.movement !== undefined ? { movement: e.movement } : {}), count: e.count });
  }
  return [...out.values()];
}

/** Setup actions the current owner may take now. */
export function legalSetupActions(ctx: GameContext, state: GameState): Action[] {
  const owner = currentSetupOwner(state);
  if (!owner) return [];
  const actions: Action[] = [];
  for (const s of poolSpecs(state, owner)) {
    const unit = { type: s.type, strength: s.strength, ...(s.nationality ? { nationality: s.nationality } : {}) };
    for (const at of placementPlaces(ctx, state, owner, unit)) actions.push({ type: "SETUP_PLACE", owner, unit, at });
  }
  for (const u of unitsOf(state, owner)) actions.push({ type: "SETUP_REMOVE", owner, unitId: u.id });
  if (setupProblems(ctx, state, owner).length === 0) actions.push({ type: "SETUP_DONE", owner });
  return actions;
}

type SetupAction = Extract<Action, { type: "SETUP_PLACE" | "SETUP_REMOVE" | "SETUP_DONE" }>;

export function applySetupAction(ctx: GameContext, state: GameState, action: SetupAction): ActionResult {
  const owner = currentSetupOwner(state);
  if (!owner) return { ok: false, error: "The game is not in the setup phase." };
  if (action.owner !== owner) return { ok: false, error: `${owner} is setting up now, not ${action.owner}.` };

  if (action.type === "SETUP_PLACE") {
    const spec: UnitSpec = { type: action.unit.type, strength: action.unit.strength, ...(action.unit.nationality ? { nationality: action.unit.nationality } : {}) };
    const entry = (state.pools[owner]?.forcePool ?? []).find((e) => e.count > 0 && poolKey(e) === poolKey(spec));
    if (!entry) return { ok: false, error: `${owner} has no ${spec.strength}-factor ${spec.type} left to place.` };
    const problem = placementProblem(ctx, state, owner, spec, action.at);
    if (problem) return { ok: false, error: problem };
    const id = `u${state.nextUnitId}`;
    const unit: Unit = {
      id,
      owner,
      ...(spec.nationality ? { nationality: spec.nationality } : {}),
      type: spec.type,
      strength: spec.strength,
      ...(entry.movement !== undefined ? { movement: entry.movement } : {}),
      at: action.at,
    };
    const pool = state.pools[owner]!;
    const forcePool = pool.forcePool.map((e) => (e === entry ? { ...e, count: e.count - 1 } : e)).filter((e) => e.count > 0);
    return {
      ok: true,
      state: { ...state, nextUnitId: state.nextUnitId + 1, units: { ...state.units, [id]: unit }, pools: { ...state.pools, [owner]: { ...pool, forcePool } } },
      events: [{ type: "UNIT_PLACED", unitId: id, owner, at: action.at }],
    };
  }

  if (action.type === "SETUP_REMOVE") {
    const unit = state.units[action.unitId];
    if (!unit || unit.owner !== owner) return { ok: false, error: `${owner} has no unit ${action.unitId} on the map.` };
    const { [action.unitId]: _removed, ...units } = state.units;
    const pool = state.pools[owner]!;
    const back: ForceEntry = { type: unit.type, strength: unit.strength, ...(unit.movement !== undefined ? { movement: unit.movement } : {}), count: 1, ...(unit.nationality ? { nationality: unit.nationality } : {}) };
    const same = pool.forcePool.find((e) => poolKey(e) === poolKey(back) && e.movement === back.movement);
    const forcePool = same ? pool.forcePool.map((e) => (e === same ? { ...e, count: e.count + 1 } : e)) : [...pool.forcePool, back];
    return {
      ok: true,
      state: { ...state, units, pools: { ...state.pools, [owner]: { ...pool, forcePool } } },
      events: [{ type: "UNIT_REMOVED", unitId: action.unitId, owner }],
    };
  }

  // SETUP_DONE
  const problems = setupProblems(ctx, state, owner);
  if (problems.length) return { ok: false, error: `${owner} cannot finish setup: ${problems.join(" ")}` };
  const events: GameEvent[] = [{ type: "SETUP_OWNER_DONE", owner }];
  const index = state.setup!.index + 1;
  if (index < state.setup!.order.length) return { ok: true, state: { ...state, setup: { ...state.setup!, index } }, events };
  events.push({ type: "SETUP_COMPLETE" }, { type: "PLAYER_TURN_STARTED", year: state.year, season: state.season, side: state.firstSide });
  return { ok: true, state: { ...state, phase: "player-turn", setup: null, activeSide: state.firstSide }, events };
}
