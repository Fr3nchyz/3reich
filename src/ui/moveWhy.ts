import type { GameContext } from "../engine/context";
import { sideInWar } from "../engine/control";
import { endProblem, entryProblem, reachableHexes, stackMovement } from "../engine/movement";
import type { GameState, Unit } from "../engine/types";
import { adjacentHexes, canCross, enemyZocFor, ZOC_EXIT_COST } from "../engine/zoc";
import { placeName } from "./names";
import * as T from "./moveText";

/**
 * Why a tapped hex is not a place the ticked units can go (spec 10, ticket 10-7): one plain sentence, never an id, chosen from what the engine's
 * read-only queries say. No rule is decided here; the order is only which reason to tell first. Falls back to the general sentence of moveText.ts.
 */
export function whyNot(ctx: GameContext, state: GameState, units: readonly Unit[], hex: string): string {
  const place = placeName(ctx.map, hex);
  const from = units[0]?.at;
  if (units.length === 0 || from === undefined) return T.CANNOT_GET_THERE;
  const h = ctx.map.hexes[hex];
  if (!h?.land) return T.whyWater(place);
  const owners = [...new Set(units.map((u) => u.owner))];
  const side = sideInWar(state, owners[0]!);
  if (adjacentHexes(ctx, from).includes(hex) && !canCross(ctx, from, hex)) return T.whyHexside(place);
  if (entryProblem(ctx, state, owners, hex) !== null) {
    const enemy = Object.values(state.units).some((u) => u.at === hex && sideInWar(state, u.owner) !== side);
    return enemy ? T.whyEnemy(place) : T.whyNeutral(place);
  }
  if (reachableHexes(ctx, state, units).has(hex)) {
    const problem = endProblem(ctx, state, units, hex);
    const limit = problem ? /limit (\d+)/.exec(problem)?.[1] : undefined;
    return limit ? T.whyFull(place, units.length, Number(limit)) : T.whyNoRoom(place);
  }
  const mp = stackMovement([...units]);
  return T.whyTooFar(place, mp, enemyZocFor(ctx, state, side!).has(from) ? ZOC_EXIT_COST : 0);
}
