import type { GameContext } from "./context";
import { controllingSide } from "./control";
import { DIRECTIONS, ROW_COUNT, adjacent, hexId, hexsideId, neighbor, parseHexId, type Direction, type HexId } from "./hex";
import type { Front } from "./map";
import { hexOf, isPort, portFronts } from "./naval-ports";
import type { GameState, Side } from "./types";

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

/**
 * Ref 4.7, spec 12 R10. TODO(verify): N38, which sides do Brindisi and Plymouth open on?
 * The manager's default is empty (no restriction); entries name the neighbours through which a port may be entered or left.
 */
export const PORT_OPENING_HEXSIDES: Record<HexId, readonly HexId[]> = {};

/**
 * Water Fronts, not land Fronts (spec 12 R3, Ref 4.4, 21.1): ports use their opening Fronts; all-ocean hexes their map Front.
 * A coastal non-port's land Front does not decide the Front of its water (as with Marseilles and Constanta).
 */
function waterOnFront(ctx: GameContext, hex: HexId, front: Front): boolean {
  const h = hexOf(ctx, hex);
  return !!h && (isPort(ctx, hex) ? portFronts(ctx, hex).includes(front) : h.land !== null || h.front === front);
}

/** One course step's refusal, or null (spec 12 R10; Ref 4.3, 4.7, 21.2, 34.0). Units, neutral coast and armor zones do not block it. */
export function baseChangeStepProblem(ctx: GameContext, state: GameState, side: Side, front: Front, from: HexId, to: HexId): string | null {
  const a = parseHexId(from);
  const b = parseHexId(to);
  if (!a || !b || !hexOf(ctx, from)?.sea || !hexOf(ctx, to)?.sea || !adjacent(a, b)) return `${from} to ${to} is not an adjacent water step.`;
  const edge = ctx.map.hexsides[hexsideId(a, b)];
  if (!edge?.sea) return `${from} to ${to} has no ocean hexside (Ref 4.3).`;
  if (!waterOnFront(ctx, from, front) || !waterOnFront(ctx, to, front)) return `${from} to ${to} crosses the fleet's ${front} Front boundary (Ref 21.2).`;
  for (const [port, next] of [[from, to], [to, from]] as const) {
    const openings = Object.hasOwn(PORT_OPENING_HEXSIDES, port) ? PORT_OPENING_HEXSIDES[port] : undefined;
    if (openings?.length && !openings.includes(next)) return `${port} does not open towards ${next} (Ref 4.7).`;
  }
  if (edge.suezCanal) {
    // Spec 12 R10, N22: all four hexes beside the canal, not merely the two ends of this step, must be friendly.
    const banks = new Set(Object.values(ctx.map.hexsides).filter((s) => s.suezCanal).flatMap((s) => s.id.split("-")));
    if ([...banks].some((h) => controllingSide(ctx, state, h) !== side)) return "The Suez Canal requires friendly control of all four adjacent hexes (N22).";
  } else if (edge.river) return `${from} to ${to} crosses a river outside the Suez Canal (Ref 4.3).`;
  if (edge.crossingArrow && [from, to].some((h) => controllingSide(ctx, state, h) !== side)) {
    return `${from} to ${to} is a crossing-arrow strait with enemy or neutral land (Ref 21.2).`;
  }
  return null;
}

/** A supplied base-change course includes both ports; every consecutive pair must be a legal step (spec 12 R10, Ref 21.2). */
export function baseChangeCourseProblem(ctx: GameContext, state: GameState, side: Side, front: Front, from: HexId, to: HexId, path: readonly HexId[]): string | null {
  if (path.length < 2 || path[0] !== from || path[path.length - 1] !== to) return "The course must run from the old port to the new port.";
  for (let i = 1; i < path.length; i++) {
    const problem = baseChangeStepProblem(ctx, state, side, front, path[i - 1]!, path[i]!);
    if (problem) return problem;
  }
  return null;
}

/** Shortest legal course, both ends included, or null. Spec 12 R10: breadth-first, fixed E, W, NE, NW, SE, SW order; no range limit. */
export function baseChangeRoute(ctx: GameContext, state: GameState, side: Side, front: Front, from: HexId, to: HexId): HexId[] | null {
  if (!hexOf(ctx, from)?.sea || !hexOf(ctx, to)?.sea || !waterOnFront(ctx, from, front) || !waterOnFront(ctx, to, front)) return null;
  const parent = new Map<HexId, HexId | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length && !parent.has(to); i++) {
    const here = queue[i]!;
    const at = parseHexId(here)!;
    for (const d of ORDER) {
      const n = neighbor(at, d);
      if (n.r < 0 || n.r >= ROW_COUNT || n.q < 0) continue;
      const next = hexId(n);
      if (parent.has(next) || baseChangeStepProblem(ctx, state, side, front, here, next)) continue;
      parent.set(next, here);
      queue.push(next);
    }
  }
  if (!parent.has(to)) return null;
  const route: HexId[] = [];
  for (let at: HexId | null | undefined = to; at != null; at = parent.get(at)) route.push(at);
  return route.reverse();
}
