import { airbasePlacements } from "./air-actions";
import { airOf, airbasesInReserve } from "./air-record";
import { airBasesOf, airRoom } from "./air-bases";
import { flightDistances } from "./air-range";
import { ONE_STAGE_PER_TURN, STAGING_RANGE } from "./air-rules";
import { stageProblem } from "./air-stage";
import type { GameContext } from "./context";
import { sideInWar } from "./control";
import type { HexId } from "./hex";
import type { GameState, PowerId, Unit } from "./types";
import { isMajorPower } from "./war";

/**
 * Whether step 6f has air work for the side to move (spec 09 C5, ticket 09-13): some air unit that has not staged this Player Turn could change base, or
 * some Major Power of the side has an airbase left to place somewhere. Splitting and combining are not counted: they change nothing a step could wait for.
 * Asked only when no ground unit can move (`hasWork` in turn.ts tries the ground first), so its cost is paid in the rare turn that has no ground move.
 */

/** Whether the air unit may stage to at least one base now (Ref 20.2): not yet staged this Player Turn, and a base in reach that `stageProblem` accepts. */
function canStage(ctx: GameContext, state: GameState, u: Unit, bases: readonly HexId[]): boolean {
  if (ONE_STAGE_PER_TURN && airOf(state).staged.includes(u.id)) return false;
  const reach = flightDistances(ctx, state, u.owner, u.at, STAGING_RANGE);
  // A base with less room than the plane has factors is refused by the stacking test of `stageProblem` anyway; skipping it first saves a route search per full base.
  return bases.some((hex) => hex !== u.at && reach.has(hex) && airRoom(ctx, state, hex) >= u.strength && stageProblem(ctx, state, [u], hex) === null);
}

/** The Major Powers of the side to move that are in the war and have an airbase in reserve. */
export const powersWithReserve = (state: GameState): PowerId[] =>
  (Object.keys(state.nations) as PowerId[]).filter((p) => isMajorPower(p) && sideInWar(state, p) === state.activeSide && airbasesInReserve(state, p) > 0);

export function hasAirMoveWork(ctx: GameContext, state: GameState): boolean {
  // The same planes `STAGE_AIR` accepts: the side to move's own (`applyStageAir` refuses the other side's). Planes alike in place, owner, nationality, strength and staged state answer alike, so each kind is asked once.
  const bases = airBasesOf(ctx, state, state.activeSide); // worked out once: it looks at every hex of the map
  const asked = new Set<string>();
  const planes = Object.values(state.units).filter((u) => u.type === "air" && sideInWar(state, u.owner) === state.activeSide && Object.hasOwn(ctx.map.hexes, u.at));
  const once = (u: Unit): boolean => {
    const key = `${u.at}|${u.owner}|${u.nationality ?? ""}|${u.strength}|${u.movement ?? ""}|${airOf(state).staged.includes(u.id)}`;
    if (asked.has(key)) return false;
    asked.add(key);
    return canStage(ctx, state, u, bases);
  };
  return planes.some(once) || powersWithReserve(state).some((p) => airbasePlacements(ctx, state, p).length > 0);
}
