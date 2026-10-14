import { controllerOf, controllingSide, sideInWar } from "../engine/control";
import type { GameContext } from "../engine/context";
import type { HexId } from "../engine/hex";
import { MINOR_COUNTRY_FORCES } from "../engine/tables";
import type { HexFeature } from "../engine/terrain";
import type { ForceOwner, GameState, Side } from "../engine/types";
import { atWar } from "../engine/war";
import { adjacentHexes, canCross } from "../engine/zoc";

/**
 * Where the computer wants its ground units to go (computer policy, not rules): toward the nearest hex of the enemy
 * that is worth taking. A distance is counted in hexes along ground hexsides a unit could cross, so a sea or a closed
 * border is never "close".
 * TODO(verify): the list of features that make a hex worth taking is the computer's own policy (spec 05).
 */
export const OBJECTIVE_FEATURES: readonly HexFeature[] = ["capital", "capital-port", "objective"];

const lists = new WeakMap<GameContext, HexId[]>();

/** The capitals and objective cities of the map, in hex order. */
export function objectiveHexes(ctx: GameContext): readonly HexId[] {
  let hit = lists.get(ctx);
  if (!hit) {
    hit = Object.values(ctx.map.hexes).filter((h) => h.land && h.features.some((f) => OBJECTIVE_FEATURES.includes(f))).map((h) => h.id).sort();
    lists.set(ctx, hit);
  }
  return hit;
}

/** Whether a hex is an objective or capital. */
export const isObjective = (ctx: GameContext, hex: HexId): boolean => ctx.map.hexes[hex]?.features.some((f) => OBJECTIVE_FEATURES.includes(f)) ?? false;

/** Land the owner's units may not enter: a neutral country's, as movement.ts's entryProblem reads it (the units standing there are left out). */
function closedTo(ctx: GameContext, state: GameState, owner: ForceOwner, hex: HexId): boolean {
  const control = controllerOf(ctx, state, hex);
  if (control !== null) return control !== owner && sideInWar(state, control) === null && !atWar(state, owner, control);
  const country = ctx.map.hexes[hex]?.country;
  return country !== undefined && Object.hasOwn(MINOR_COUNTRY_FORCES, country) && !atWar(state, owner, country as ForceOwner);
}

/** Hexes of the enemy of `side` that are objectives or capitals and that it controls now, in hex order. */
export function enemyObjectives(ctx: GameContext, state: GameState, side: Side): HexId[] {
  return objectiveHexes(ctx).filter((h) => {
    const holder = controllingSide(ctx, state, h);
    return holder !== null && holder !== side;
  });
}

const crossings = new WeakMap<GameContext, Map<HexId, readonly HexId[]>>();

/** The hexes a ground unit could cross into from this one: fixed by the map, so worked out once per hex. */
function crossable(ctx: GameContext, here: HexId): readonly HexId[] {
  let map = crossings.get(ctx);
  if (!map) crossings.set(ctx, (map = new Map<HexId, readonly HexId[]>()));
  let hit = map.get(here);
  if (!hit) map.set(here, (hit = adjacentHexes(ctx, here).filter((n) => canCross(ctx, here, n))));
  return hit;
}

/** Breadth-first ground distance from the `sources` to every hex a unit of `owner` could reach on foot; with `from`, also the source each hex is nearest to (the first in the list on a tie). */
export function groundDistances(ctx: GameContext, state: GameState, owner: ForceOwner, sources: readonly HexId[], from?: Map<HexId, HexId>): Map<HexId, number> {
  const dist = new Map<HexId, number>();
  let frontier: HexId[] = [];
  for (const h of sources) {
    dist.set(h, 0);
    from?.set(h, h);
    frontier.push(h);
  }
  for (let d = 1; frontier.length > 0; d++) {
    const next: HexId[] = [];
    for (const here of frontier) {
      for (const n of crossable(ctx, here)) {
        if (dist.has(n) || closedTo(ctx, state, owner, n)) continue;
        dist.set(n, d);
        from?.set(n, from.get(here)!);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * For every hex a unit of `owner` could reach on foot, the number of hexes to the nearest enemy-held objective or capital
 * (and, with `from`, which one). A hex missing from the map cannot reach any (a sea, an island, or land cut off by neutral country).
 */
export function distanceToEnemyObjective(ctx: GameContext, state: GameState, owner: ForceOwner, side: Side, from?: Map<HexId, HexId>): Map<HexId, number> {
  return groundDistances(ctx, state, owner, enemyObjectives(ctx, state, side), from);
}
