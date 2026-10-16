import { airBasesOf, airRoom, baseProblem } from "./air-bases";
import { MISSION_RANGE, STAGING_RANGE } from "./air-rules";
import { sideInWar } from "./control";
import type { GameContext } from "./context";
import { distance, hexId, parseHexId, type HexId } from "./hex";
import { neutralLandProblem } from "./movement";
import { stackingProblem } from "./placement";
import type { ForceOwner, GameState, Unit } from "./types";
import { adjacentHexes } from "./zoc";

/**
 * Where an air unit can go (spec 09 R4; Ref 20.2): hexes within range, flight routes that avoid neutral land, and the bases a unit
 * could stage to. Air may cross all-ocean hexsides and armor ZOC does not touch it (Ref 11.41), so a route is any chain of map hexes.
 * Pure queries; no action yet. Not here (later tickets): the base must have been held at the start of the turn, the Option of the Front
 * entered, one stage per turn, and the Pass Option limit (Ref 11.42).
 */

/** Every map hex within `range` hexes of `center`, the centre included, in id order. A plain distance: neutral land is not looked at. */
export function hexesWithin(ctx: GameContext, center: HexId, range: number): HexId[] {
  const c = parseHexId(center);
  if (!c || !Number.isFinite(range) || range < 0) return [];
  const out: HexId[] = [];
  const n = Math.floor(range);
  for (let dr = -n; dr <= n; dr++) {
    for (let dq = Math.max(-n, -n - dr); dq <= Math.min(n, n - dr); dq++) {
      const q = c.q + dq;
      const r = c.r + dr;
      if (q < 0 || r < 0 || r >= 40) continue;
      const id = hexId({ q, r });
      if (ctx.map.hexes[id]) out.push(id);
    }
  }
  return out.sort();
}

/** Whether a flight of this owner may not pass over the hex: it holds neutral land (Ref 20.2), by the same test as ground movement. */
export const flightBlocked = (ctx: GameContext, state: GameState, owner: ForceOwner, hex: HexId): string | null => neutralLandProblem(ctx, state, [owner], hex);

interface Search {
  dist: Map<HexId, number>;
  from: Map<HexId, HexId>;
}

/** Breadth-first search over map hexes, never entering a hex `blocked` names, up to `range` hexes. Neighbours come in a fixed order, so routes are the same every time. */
function search(ctx: GameContext, start: HexId, range: number, blocked: (hex: HexId) => boolean): Search {
  const dist = new Map<HexId, number>([[start, 0]]);
  const from = new Map<HexId, HexId>();
  const queue: HexId[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]!;
    const d = dist.get(at)!;
    if (d >= range) continue;
    for (const next of adjacentHexes(ctx, at)) {
      if (dist.has(next) || blocked(next)) continue;
      dist.set(next, d + 1);
      from.set(next, at);
      queue.push(next);
    }
  }
  return { dist, from };
}

const routeOf = (s: Search, from: HexId, to: HexId): HexId[] => {
  const route = [to];
  while (route[0] !== from) route.unshift(s.from.get(route[0]!)!);
  return route;
};

const searchFor = (ctx: GameContext, state: GameState, owner: ForceOwner, start: HexId, range: number): Search =>
  search(ctx, start, range, (hex) => flightBlocked(ctx, state, owner, hex) !== null);

/** Every hex a flight from `from` can reach within `range` hexes without passing over neutral land, with its route length. The start is at 0. */
export const flightDistances = (ctx: GameContext, state: GameState, owner: ForceOwner, from: HexId, range: number): Map<HexId, number> =>
  searchFor(ctx, state, owner, from, range).dist;

/** The shortest route from `from` to `to` (both included) within `range` hexes avoiding neutral land, or null. Ties follow the neighbour order. */
export function flightRoute(ctx: GameContext, state: GameState, owner: ForceOwner, from: HexId, to: HexId, range: number): HexId[] | null {
  const found = searchFor(ctx, state, owner, from, range);
  return found.dist.has(to) ? routeOf(found, from, to) : null;
}

/** Hexes a unit of this owner could fly a mission to from `from` (4 hexes out and back, Ref 20.41), start excluded. */
export const missionHexes = (ctx: GameContext, state: GameState, owner: ForceOwner, from: HexId): HexId[] =>
  [...flightDistances(ctx, state, owner, from, MISSION_RANGE).keys()].filter((h) => h !== from).sort();

/**
 * Why a flight of `range` hexes from `from` to `to` is not possible, in one sentence, or null if it is. Distinguishes the destination or
 * a hex on the way being neutral land, and a base simply too far.
 */
export function flightProblem(ctx: GameContext, state: GameState, owner: ForceOwner, from: HexId, to: HexId, range: number): string | null {
  const a = parseHexId(from);
  const b = parseHexId(to);
  if (!a || !b || !ctx.map.hexes[from] || !ctx.map.hexes[to]) return `${to} is not on the map.`;
  if (flightRoute(ctx, state, owner, from, to, range)) return null;
  const free = search(ctx, from, Infinity, () => false); // the way ignoring neutral land
  const straight = free.dist.get(to);
  if (straight === undefined || straight > range) return `${to} is too far: ${straight ?? distance(a, b)} hexes (limit ${range}).`;
  const blocker = flightBlocked(ctx, state, owner, to) ?? routeOf(free, from, to).map((h) => flightBlocked(ctx, state, owner, h)).find((p) => p !== null);
  return `Planes cannot cross neutral land: ${blocker ?? `no route within ${range} hexes`}`;
}

/** One base a unit could stage to (or could not, with the reason). `distance` is the route length, null when no route within the staging range exists. */
export interface StagingChoice {
  hex: HexId;
  distance: number | null;
  /** Free air factors there now. */
  room: number;
  /** Why not, or null when the unit may stage there. */
  problem: string | null;
}

/**
 * Every base of the unit's side within the staging range in a straight line, with the reason it cannot be used, or null (Ref 20.2): not
 * a base the unit may use (Ref 20.1), a route that crosses neutral land, too little room (Ref 5.0, 26.0). The unit's own hex is left out.
 */
export function stagingChoices(ctx: GameContext, state: GameState, u: Unit, range: number = STAGING_RANGE): StagingChoice[] {
  const side = sideInWar(state, u.owner);
  if (side === null || !ctx.map.hexes[u.at]) return [];
  const reach = flightDistances(ctx, state, u.owner, u.at, range);
  const near = new Set(hexesWithin(ctx, u.at, range));
  const spec = { type: u.type, strength: u.strength, ...(u.nationality ? { nationality: u.nationality } : {}) };
  const others = { ...state, units: Object.fromEntries(Object.entries(state.units).filter(([id]) => id !== u.id)) };
  return airBasesOf(ctx, state, side).filter((hex) => hex !== u.at && near.has(hex)).map((hex) => {
    const distanceTo = reach.get(hex) ?? null;
    const problem = baseProblem(ctx, state, u, hex) ?? flightProblem(ctx, state, u.owner, u.at, hex, range) ?? stackingProblem(ctx, others, u.owner, spec, hex);
    return { hex, distance: distanceTo, room: airRoom(ctx, state, hex), problem };
  });
}

/** The bases the unit may stage to now, nearest first then by id (Ref 20.2). */
export const stagingBases = (ctx: GameContext, state: GameState, u: Unit, range: number = STAGING_RANGE): StagingChoice[] =>
  stagingChoices(ctx, state, u, range).filter((c) => c.problem === null).sort((a, b) => a.distance! - b.distance! || (a.hex < b.hex ? -1 : 1));
