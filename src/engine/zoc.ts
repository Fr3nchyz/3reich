import { sideInWar } from "./control";
import type { GameContext } from "./context";
import { otherSide } from "./game";
import { hexId, hexsideId, neighbors, parseHexId, ROW_COUNT, type HexId } from "./hex";
import type { MapHexside } from "./map";
import type { GameState, Side, Unit, UnitType } from "./types";

/**
 * Zones of control (Ref 6.0, spec 03). A ground unit exerts a ZOC into every adjacent land hex it could
 * cross a hexside into; a ground unit entering an enemy ZOC must stop, and may leave one freely.
 * Pure queries only: moving units is the movement round's job.
 *
 * docs/RULES.md does not settle the following, so each is a named constant or a parameter:
 * TODO(verify, Ref 6.0): which counters exert a ZOC (here the three that fight on foot; replacements
 * and bridgeheads do not, air units and fleets never do).
 * TODO(verify, Ref 6.0): whether a friendly ground unit in a hex cancels the enemy ZOC there. Spec 03
 * says friendly units negate ZOC "for supply and movement"; `ZOC_POLICY` says so, and a caller may pass
 * another policy. Whether negation also needs the unit to be in supply, or applies to retreats, is open.
 * TODO(verify, Ref 6.0): ZOC does not stop air movement, naval movement or airborne drops (not modelled here).
 */

export const ZOC_UNIT_TYPES: readonly UnitType[] = ["infantry", "armor", "airborne"];

export interface ZocPolicy {
  /** A friendly ground unit in a hex cancels the enemy ZOC in that hex (for the mover; supply will use the same). */
  friendlyUnitNegates: boolean;
}
export const ZOC_POLICY: ZocPolicy = { friendlyUnitNegates: true };

/**
 * Whether a ground unit may cross from one hex into the next (Ref 4.3, 4.6): a land hexside, or a
 * crossing arrow; never a Qattara hexside, never open water. Rivers and the Suez Canal do not stop it.
 * The two hexes must be adjacent and on the map.
 * TODO(verify, docs/RULES.md "Map details"): 25 hexsides where the coast reaches only one end are crossable by
 * land in the original game but not on our map (and K32-K33 the reverse); ZOC follows our map until that is decided.
 */
export function canCross(ctx: GameContext, from: HexId, to: HexId): boolean {
  const a = parseHexId(from);
  const b = parseHexId(to);
  if (!a || !b || !ctx.map.hexes[from]?.land || !ctx.map.hexes[to]?.land) return false;
  let side: MapHexside | undefined;
  try {
    side = ctx.map.hexsides[hexsideId(a, b)];
  } catch {
    return false; // not adjacent
  }
  return !!side && !side.qattara && (side.land || !!side.crossingArrow);
}

/** The playable hexes next to this one, in a fixed order (E, W, NE, NW, SE, SW). */
export function adjacentHexes(ctx: GameContext, id: HexId): HexId[] {
  const h = parseHexId(id);
  if (!h) return [];
  return neighbors(h)
    .filter((n) => n.q >= 0 && n.r >= 0 && n.r < ROW_COUNT)
    .map(hexId)
    .filter((n) => ctx.map.hexes[n]);
}

/** Whether this counter exerts a ZOC from where it stands. */
export const exertsZoc = (ctx: GameContext, u: Pick<Unit, "type" | "at">): boolean => ZOC_UNIT_TYPES.includes(u.type) && !!ctx.map.hexes[u.at]?.land;

/** The hexes one unit exerts its ZOC into: adjacent land hexes it could cross into. Empty if it exerts none. */
export function zocOfUnit(ctx: GameContext, u: Pick<Unit, "type" | "at">): HexId[] {
  return exertsZoc(ctx, u) ? adjacentHexes(ctx, u.at).filter((n) => canCross(ctx, u.at, n)) : [];
}

/** Every hex a side's ground units exert a ZOC into (hexes the side's own units stand in included). */
export function zocHexes(ctx: GameContext, state: GameState, side: Side): Set<HexId> {
  const out = new Set<HexId>();
  for (const u of Object.values(state.units)) {
    if (sideInWar(state, u.owner) === side) for (const h of zocOfUnit(ctx, u)) out.add(h);
  }
  return out;
}

/** The hexes where the side's ground units are, which cancel enemy ZOC there under `friendlyUnitNegates`. */
function coveredHexes(ctx: GameContext, state: GameState, side: Side): Set<HexId> {
  return new Set(Object.values(state.units).filter((u) => sideInWar(state, u.owner) === side && ZOC_UNIT_TYPES.includes(u.type) && ctx.map.hexes[u.at]).map((u) => u.at));
}

/** The hexes where a ground unit of `side` is in an enemy ZOC that counts (not cancelled by a friendly unit there). */
export function enemyZocFor(ctx: GameContext, state: GameState, side: Side, policy: ZocPolicy = ZOC_POLICY): Set<HexId> {
  const zoc = zocHexes(ctx, state, otherSide(side));
  if (policy.friendlyUnitNegates) for (const h of coveredHexes(ctx, state, side)) zoc.delete(h);
  return zoc;
}

/** Whether a unit of `side` standing in `hex` is in an enemy ZOC. */
export const inEnemyZoc = (ctx: GameContext, state: GameState, side: Side, hex: HexId, policy: ZocPolicy = ZOC_POLICY): boolean =>
  enemyZocFor(ctx, state, side, policy).has(hex);

/** Whether a ground unit of `side` that enters `hex` must stop there (Ref 6.0). Leaving a ZOC never forces a stop. */
export const mustStop = inEnemyZoc;

/**
 * How far a ground unit can go along a path of hexes it enters, start excluded: the index of the
 * hex where it must stop (the path is cut after it), or null if no hex on it forces a stop. A path that
 * continues past a stop is illegal; a path that starts inside a ZOC is fine.
 */
export function zocStopIndex(ctx: GameContext, state: GameState, side: Side, path: readonly HexId[], policy: ZocPolicy = ZOC_POLICY): number | null {
  const zoc = enemyZocFor(ctx, state, side, policy);
  const i = path.findIndex((h) => zoc.has(h));
  return i < 0 ? null : i;
}

/** Why a path of entered hexes is not allowed by ZOC (it goes on past a hex where the unit must stop), or null. */
export function zocPathProblem(ctx: GameContext, state: GameState, side: Side, path: readonly HexId[], policy: ZocPolicy = ZOC_POLICY): string | null {
  const stop = zocStopIndex(ctx, state, side, path, policy);
  return stop !== null && stop < path.length - 1 ? `A unit entering ${path[stop]} must stop there: it is in an enemy zone of control.` : null;
}

/** Ids of the enemy units that exert a ZOC into this hex, for showing why a hex is in one. */
export const zocSources = (ctx: GameContext, state: GameState, side: Side, hex: HexId): string[] =>
  Object.values(state.units).filter((u) => sideInWar(state, u.owner) === otherSide(side) && zocOfUnit(ctx, u).includes(hex)).map((u) => u.id);
