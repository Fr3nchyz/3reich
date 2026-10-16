import { sideInWar } from "./control";
import type { GameContext } from "./context";
import { otherSide } from "./game";
import { hexId, hexsideId, neighbors, parseHexId, ROW_COUNT, type HexId } from "./hex";
import type { MapHexside } from "./map";
import type { GameState, Side, Unit, UnitType } from "./types";

/**
 * Zones of control (Ref 7.0 of the PC Reference Manual, spec 13). Every ground unit exerts a ZOC on the hex it occupies, which has no effect of its own
 * (an enemy cannot enter the hex, and supply is not blocked by a ZOC over the unit or its source, Ref 19.3). An armor unit, only, exerts an
 * additional ZOC on the six adjacent hexes, except across a hexside that is water or holds a Crossing Arrow, and into a Fortress hex (it does
 * extend out of a Fortress hex, and across rivers and the Suez Canal). Friendly units do not negate enemy ZOC. A moving ground unit pays
 * ZOC_EXIT_COST extra movement factors to leave a hex in enemy armor ZOC; entering costs nothing extra and never forces a stop (Ref 11.41).
 * Pure queries only: moving units is the movement round's job.
 *
 * TODO(verify, Ref 7.0, 12.31): the 12.31 Exploitation example prices exiting enemy ZOCs at +3, against +2 in 7.0; built +2.
 * TODO(verify, Ref 7.0): whether a unit with fewer than ZOC_EXIT_COST factors left may leave at all (built: no, the cost cannot be paid).
 * TODO(verify, Ref 7.0): whether airborne units count as ground units here (built: yes, though only armor reaches the adjacent hexes).
 * ZOC does not stop air movement, naval movement or airborne drops (Ref 11.41; not modelled here).
 */

/** The ground units: each exerts a ZOC on its own hex (Ref 7.0). Supply also checks these counters. */
export const ZOC_UNIT_TYPES: readonly UnitType[] = ["infantry", "armor", "airborne"];

/** The counters that exert a ZOC on the adjacent hexes (Ref 7.0: "An armor unit, only"). */
export const ARMOR_ZOC_TYPES: readonly UnitType[] = ["armor"];

/** Movement factors a ground unit pays extra to leave a hex in enemy armor ZOC (Ref 7.0; the 12.31 example says +3, TODO(verify)). */
export const ZOC_EXIT_COST = 2;

export interface ZocPolicy {
  /** A friendly ground unit in a hex cancels the enemy ZOC in that hex. Ref 7.0: "Friendly units do not negate the effect of enemy ZOC." */
  friendlyUnitNegates: boolean;
}
export const ZOC_POLICY: ZocPolicy = { friendlyUnitNegates: false };

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

/** Whether this counter exerts a ZOC from where it stands (on its own hex; only armor reaches the adjacent hexes, see `zocOfUnit`). */
export const exertsZoc = (ctx: GameContext, u: Pick<Unit, "type" | "at">): boolean => ZOC_UNIT_TYPES.includes(u.type) && !!ctx.map.hexes[u.at]?.land;

/** Whether armor ZOC reaches from one hex across their shared hexside: a land hexside (rivers and the Suez Canal included), never water, a Crossing Arrow or the Qattara Depression (Ref 7.0). */
export function armorZocCrosses(ctx: GameContext, from: HexId, to: HexId): boolean {
  const a = parseHexId(from);
  const b = parseHexId(to);
  if (!a || !b || !ctx.map.hexes[from]?.land || !ctx.map.hexes[to]?.land) return false;
  try {
    const side = ctx.map.hexsides[hexsideId(a, b)];
    return !!side && !side.qattara && side.land && !side.crossingArrow;
  } catch {
    return false; // not adjacent
  }
}

/** The adjacent hexes one unit exerts its ZOC into: armor only, never across the hexsides above and never into a Fortress hex (Ref 7.0, 4.8). Empty for other counters. */
export function zocOfUnit(ctx: GameContext, state: GameState, u: Pick<Unit, "type" | "at">): HexId[] {
  if (!ARMOR_ZOC_TYPES.includes(u.type) || !exertsZoc(ctx, u)) return [];
  return adjacentHexes(ctx, u.at).filter((n) => armorZocCrosses(ctx, u.at, n) && state.fortresses[n] !== true);
}

/** Every hex a side's armor exerts a ZOC into (hexes the side's own units stand in included). */
export function zocHexes(ctx: GameContext, state: GameState, side: Side): Set<HexId> {
  const out = new Set<HexId>();
  for (const u of Object.values(state.units)) {
    if (sideInWar(state, u.owner) === side) for (const h of zocOfUnit(ctx, state, u)) out.add(h);
  }
  return out;
}

/** The hexes where a ground unit of `side` is, which cancel enemy ZOC there only under `friendlyUnitNegates` (off: Ref 7.0). */
function coveredHexes(ctx: GameContext, state: GameState, side: Side): Set<HexId> {
  return new Set(Object.values(state.units).filter((u) => sideInWar(state, u.owner) === side && ZOC_UNIT_TYPES.includes(u.type) && ctx.map.hexes[u.at]).map((u) => u.at));
}

/** The hexes where a ground unit of `side` is in an enemy ZOC that counts: leaving such a hex costs ZOC_EXIT_COST extra. */
export function enemyZocFor(ctx: GameContext, state: GameState, side: Side, policy: ZocPolicy = ZOC_POLICY): Set<HexId> {
  const zoc = zocHexes(ctx, state, otherSide(side));
  if (policy.friendlyUnitNegates) for (const h of coveredHexes(ctx, state, side)) zoc.delete(h);
  return zoc;
}

/** Whether a unit of `side` standing in `hex` is in an enemy ZOC. */
export const inEnemyZoc = (ctx: GameContext, state: GameState, side: Side, hex: HexId, policy: ZocPolicy = ZOC_POLICY): boolean =>
  enemyZocFor(ctx, state, side, policy).has(hex);

/** The extra movement factors a ground unit of `side` pays to leave `hex` (Ref 7.0), given the side's enemy ZOC (`enemyZocFor`). */
export const zocExitCost = (zoc: ReadonlySet<HexId>, hex: HexId): number => (zoc.has(hex) ? ZOC_EXIT_COST : 0);

/** Ids of the enemy armor units that exert a ZOC into this hex, for showing why a hex is in one. */
export const zocSources = (ctx: GameContext, state: GameState, side: Side, hex: HexId): string[] =>
  Object.values(state.units).filter((u) => sideInWar(state, u.owner) === otherSide(side) && zocOfUnit(ctx, state, u).includes(hex)).map((u) => u.id);
