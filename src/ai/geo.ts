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

/**
 * Hexes of the enemy of `side` that are objectives or capitals and that it controls now, and for every hex a
 * unit of `owner` could reach on foot, the number of hexes to the nearest of them. A hex missing from the map
 * cannot reach any (a sea, an island, or land cut off by neutral country).
 */
export function distanceToEnemyObjective(ctx: GameContext, state: GameState, owner: ForceOwner, side: Side): Map<HexId, number> {
  const dist = new Map<HexId, number>();
  let frontier: HexId[] = [];
  for (const h of objectiveHexes(ctx)) {
    const holder = controllingSide(ctx, state, h);
    if (holder !== null && holder !== side) {
      dist.set(h, 0);
      frontier.push(h);
    }
  }
  for (let d = 1; frontier.length > 0; d++) {
    const next: HexId[] = [];
    for (const here of frontier) {
      for (const n of adjacentHexes(ctx, here)) {
        if (dist.has(n) || !canCross(ctx, here, n) || closedTo(ctx, state, owner, n)) continue;
        dist.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}
