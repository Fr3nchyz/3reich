import { describeAreas, isBox, resolveArea, resolveAreas, territoryOf, type Resolved } from "./areas";
import type { GameContext } from "./context";
import { setupOf } from "./game";
import { hex, hexId, neighbors } from "./hex";
import { FACTOR_TYPES, GROUND_FOR_STACKING, factorsOf, matchesSpec, unitsOf } from "./placement";
import type { Area, ForceOwner, GameState, SetupRequirement, Unit, UnitType } from "./types";

/** Whether a nation's setup meets what the scenario page requires, in plain words. */

// --- requirements ---------------------------------------------------------------------

export const unitMatches = (u: Pick<Unit, "type" | "strength" | "nationality">, r: { type: UnitType; strength?: number }) => u.type === r.type && (r.strength === undefined || u.strength === r.strength) && u.nationality === undefined;

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
  const placesOf = (areas: readonly Area[]) => {
    const r = resolveAreas(ctx, areas);
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
