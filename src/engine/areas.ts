import type { GameContext } from "./context";
import { setupOf } from "./game";
import type { HexId } from "./hex";
import type { MapHex } from "./map";
import { NAVAL_BASE_FEATURES } from "./terrain";
import type { Area, ForceOwner, OffMapBox } from "./types";

/**
 * Where things can go at setup: the places a nation controls at the start, named areas of the
 * map, and the zones a scenario defines. A place is a hex or an off-map box.
 */

export type Place = HexId | OffMapBox;
const BOXES: readonly OffMapBox[] = ["us-box", "murmansk-box"];
export const isBox = (p: string): p is OffMapBox => (BOXES as readonly string[]).includes(p);

/** Places plus the zones whose hexes are still unknown (so the places are incomplete). */
export interface Resolved {
  places: ReadonlySet<Place>;
  unresolved: string[];
}

// --- areas ----------------------------------------------------------------------------

export const union = (a: Resolved, b: Resolved): Resolved => ({
  places: new Set([...a.places, ...b.places]),
  unresolved: [...new Set([...a.unresolved, ...b.unresolved])],
});
export const EMPTY: Resolved = { places: new Set(), unresolved: [] };

// Territory and areas depend only on the context, which never changes, so they are worked out
// once per context. A territory is whole countries plus zones, never another owner's territory, so
// resolving an area cannot loop.
const caches = new WeakMap<GameContext, { hexes: MapHex[]; areas: Map<string, Resolved>; territory: Map<string, Resolved>; allowed: Map<string, Resolved> }>();
export function cacheOf(ctx: GameContext) {
  let c = caches.get(ctx);
  if (!c) caches.set(ctx, (c = { hexes: Object.values(ctx.map.hexes), areas: new Map(), territory: new Map(), allowed: new Map() }));
  return c;
}

export function resolveArea(ctx: GameContext, area: Area): Resolved {
  const cache = cacheOf(ctx).areas;
  const key = JSON.stringify(area);
  const hit = cache.get(key);
  if (hit) return hit;
  const resolved = resolveAreaUncached(ctx, area);
  cache.set(key, resolved);
  return resolved;
}

function resolveAreaUncached(ctx: GameContext, area: Area): Resolved {
  const hexes = cacheOf(ctx).hexes;
  const of = (pred: (h: MapHex) => boolean): Resolved => ({
    places: new Set(hexes.filter(pred).map((h) => h.id)),
    unresolved: [],
  });
  switch (area.kind) {
    case "country":
      return of((h) => !!h.land && h.country === area.id);
    case "hex":
      return of((h) => !!h.land && h.id === area.id);
    case "ports":
      return of((h) => !!h.land && h.front === area.front && h.features.some((f) => NAVAL_BASE_FEATURES.includes(f)));
    case "front":
      return of((h) => !!h.land && h.front === area.front);
    case "box":
      return { places: new Set([area.box]), unresolved: [] };
    case "zone": {
      const zone = ctx.scenario.zones[area.id];
      if (!zone?.hexes) return { places: new Set(), unresolved: [area.id] };
      return { places: new Set(zone.hexes), unresolved: [] };
    }
    case "controlled-by":
      return territoryOf(ctx, area.owner);
  }
}

/** Hexes an owner controls at the start: whole countries plus zones. */
export function territoryOf(ctx: GameContext, owner: ForceOwner): Resolved {
  const cache = cacheOf(ctx).territory;
  const hit = cache.get(owner);
  if (hit) return hit;
  const f = setupOf(ctx.scenario, owner);
  let out = EMPTY;
  for (const c of f.controlledAtStart) out = union(out, resolveArea(ctx, { kind: "country", id: c }));
  for (const z of f.controlledZones) out = union(out, resolveArea(ctx, { kind: "zone", id: z }));
  cache.set(owner, out);
  return out;
}

/** The places of several areas together, with the zones among them whose hexes are not known yet. */
export const resolveAreas = (ctx: GameContext, areas: readonly Area[], from: Resolved = EMPTY): Resolved =>
  areas.reduce((acc, a) => union(acc, resolveArea(ctx, a)), from);

function describeArea(a: Area): string {
  switch (a.kind) {
    case "country":
    case "hex":
    case "zone":
      return a.id;
    case "ports":
      return `${a.front} ports`;
    case "front":
      return `the ${a.front} front`;
    case "box":
      return a.box;
    case "controlled-by":
      return `${a.owner}-controlled territory`;
  }
}

export function describeAreas(areas: readonly Area[]): string {
  return areas.map(describeArea).join(" or ");
}
