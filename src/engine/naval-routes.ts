import type { GameContext } from "./context";
import { DIRECTIONS, ROW_COUNT, hexId, hexsideId, neighbor, parseHexId, type Direction, type HexId } from "./hex";

/**
 * Sea routes (spec 12 R9 "nearest", R10 course, R11 interception distance; Ref 4.3, 21.2): the shortest way between two water hexes, found
 * breadth-first with a fixed neighbour order, so the same question always has the same answer. Pure queries on the map; no state.
 *
 * A step crosses a hexside the map marks as sea (blue on both sides, Ref 4.3). Two kinds of sea hexside are left out because whether a fleet
 * may use them depends on who holds the land beside them, which a map-only query cannot know: the crossing-arrow straits (Ref 4.6, R10) and
 * the Suez Canal (Ref 4.3, N22). Ticket 12-10 adds them with the state. The Black Sea is then a body of water of its own, as it is in the
 * data, so no route joins it to the Mediterranean or the Baltic. Range is unlimited and enemy units block nothing (Ref 21.2).
 */

const ORDER = Object.keys(DIRECTIONS) as Direction[]; // E, W, NE, NW, SE, SW: the fixed neighbour order

/** The hexes a fleet can sail to in one step from `hex`, in the fixed order E, W, NE, NW, SE, SW (none for a hex with no water: the map has no sea hexside there). */
export function seaNeighbors(ctx: GameContext, hex: HexId): HexId[] {
  const at = parseHexId(hex);
  if (!at) return [];
  const out: HexId[] = [];
  for (const d of ORDER) {
    const to = neighbor(at, d);
    if (to.r < 0 || to.r >= ROW_COUNT || to.q < 0) continue; // off the grid
    const id = hexId(to);
    const side = ctx.map.hexsides[hexsideId(at, to)];
    if (side?.sea && !side.crossingArrow && !side.suezCanal) out.push(id);
  }
  return out;
}

/** Breadth-first from one water hex, over `seaNeighbors`: each hex reached, with the hex it was reached from and its distance. Stops early once `stopAt` is reached. */
function search(ctx: GameContext, from: HexId, stopAt?: HexId): { parent: Map<HexId, HexId | null>; dist: Map<HexId, number> } {
  const parent = new Map<HexId, HexId | null>([[from, null]]);
  const dist = new Map<HexId, number>([[from, 0]]);
  const queue: HexId[] = [from];
  for (let i = 0; i < queue.length && !(stopAt !== undefined && parent.has(stopAt)); i++) {
    const here = queue[i]!;
    for (const next of seaNeighbors(ctx, here)) {
      if (parent.has(next)) continue;
      parent.set(next, here);
      dist.set(next, dist.get(here)! + 1);
      queue.push(next);
    }
  }
  return { parent, dist };
}

/**
 * The shortest sea route from one water hex to another, both ends included (`[from]` when they are the same hex), or null when there is
 * none: an end that is not a water hex, or no sea hexside chain between them (Stettin, La Coruna and Haifa touch no sea hexside in the
 * data; the Black Sea has no link to the other seas). Among routes of equal length the one found first in the fixed neighbour order is
 * returned.
 */
export function seaRoute(ctx: GameContext, from: HexId, to: HexId): HexId[] | null {
  if (!ctx.map.hexes[from]?.sea || !ctx.map.hexes[to]?.sea) return null;
  const { parent } = search(ctx, from, to);
  if (!parent.has(to)) return null;
  const route: HexId[] = [];
  for (let at: HexId | null | undefined = to; at != null; at = parent.get(at)) route.push(at);
  return route.reverse();
}

/** The length of the shortest sea route in hexes sailed (0 for the same hex), or null when there is none. */
export function seaDistance(ctx: GameContext, from: HexId, to: HexId): number | null {
  if (!ctx.map.hexes[from]?.sea || !ctx.map.hexes[to]?.sea) return null;
  return search(ctx, from, to).dist.get(to) ?? null;
}

/** The sea distance from one water hex to every water hex it can reach, itself at 0 (empty when it is not a water hex): one search for "the nearest port" questions. */
export function seaDistances(ctx: GameContext, from: HexId): Map<HexId, number> {
  return ctx.map.hexes[from]?.sea ? search(ctx, from).dist : new Map<HexId, number>();
}
