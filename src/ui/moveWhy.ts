import type { GameContext } from "../engine/context";
import { sideInWar } from "../engine/control";
import type { HexId } from "../engine/hex";
import { endProblem, entryProblem, reachableHexes, stackMovement } from "../engine/movement";
import type { GameState, Unit } from "../engine/types";
import { adjacentHexes, canCross, enemyZocFor, ZOC_EXIT_COST } from "../engine/zoc";
import { placeName } from "./names";
import * as T from "./moveText";

/**
 * Why a tapped hex is not a place the ticked units can go (spec 10, ticket 10-7): one plain sentence, never an id, chosen from what the engine's
 * read-only queries say. No rule is decided here; the order is only which reason to tell first. Falls back to the general sentence of moveText.ts.
 */

/** The fewest hexes from `from` to `to` over hexes the units may cross into and enter (ignoring the zone-of-control cost and the stacking limit), or null if no such route. */
export function routeLength(ctx: GameContext, state: GameState, owners: Unit["owner"][], from: HexId, to: HexId): number | null {
  const seen = new Map<HexId, number>([[from, 0]]);
  for (let frontier: HexId[] = [from]; frontier.length > 0; ) {
    const next: HexId[] = [];
    for (const here of frontier) {
      for (const n of adjacentHexes(ctx, here)) {
        if (seen.has(n) || !canCross(ctx, here, n) || entryProblem(ctx, state, owners, n) !== null) continue;
        seen.set(n, seen.get(here)! + 1);
        if (n === to) return seen.get(n)!;
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

export function whyNot(ctx: GameContext, state: GameState, units: readonly Unit[], hex: string): string {
  const place = placeName(ctx.map, hex);
  const from = units[0]?.at;
  if (units.length === 0 || from === undefined) return T.CANNOT_GET_THERE;
  const h = ctx.map.hexes[hex];
  if (!h?.land) return T.whyWater(place);
  const owners = [...new Set(units.map((u) => u.owner))];
  const side = sideInWar(state, owners[0]!);
  if (adjacentHexes(ctx, from).includes(hex) && !canCross(ctx, from, hex)) return T.whyHexside(place);
  const entry = entryProblem(ctx, state, owners, hex);
  if (entry !== null) return /is neutral land/.test(entry) ? T.whyNeutral(place) : T.whyEnemy(place);
  if (reachableHexes(ctx, state, units).has(hex)) {
    const problem = endProblem(ctx, state, units, hex);
    if (problem && /Anglo|British and French/.test(problem)) return T.whyAngloFrench(place);
    const limit = problem ? /limit (\d+)/.exec(problem)?.[1] : undefined;
    if (!limit) return T.whyNoRoom(place);
    const helps = units.length > 1 && units.some((gone) => endProblem(ctx, state, units.filter((u) => u !== gone), hex) === null);
    return T.whyFull(place, units.length, Number(limit), helps);
  }
  const mp = stackMovement([...units]);
  const exit = enemyZocFor(ctx, state, side!).has(from) ? ZOC_EXIT_COST : 0;
  const length = routeLength(ctx, state, owners, from, hex);
  if (length === null) return T.whyBlocked(place);
  return length > mp ? T.whyTooFar(place, length, mp, exit) : T.whyZocCost(place, mp, ZOC_EXIT_COST);
}
