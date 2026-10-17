import { airbasePlacements } from "./air-actions";
import { airOf, airbasesInReserve } from "./air-record";
import { stagingBases } from "./air-range";
import { ONE_STAGE_PER_TURN } from "./air-rules";
import { stageProblem } from "./air-stage";
import type { GameContext } from "./context";
import { sideInWar } from "./control";
import type { GameState, PowerId, Unit } from "./types";
import { isMajorPower } from "./war";

/**
 * Whether step 6f has air work for the side to move (spec 09 C5, ticket 09-13): some air unit that has not staged this Player Turn could change base, or
 * some Major Power of the side has an airbase left to place somewhere. Splitting and combining are not counted: they change nothing a step could wait for.
 * Asked only when no ground unit can move (`hasWork` in turn.ts tries the ground first), so its cost is paid in the rare turn that has no ground move.
 */

/** Whether the air unit may stage to at least one base now (Ref 20.2): not yet staged this Player Turn, and a base in reach that `stageProblem` accepts. */
function canStage(ctx: GameContext, state: GameState, u: Unit): boolean {
  if (ONE_STAGE_PER_TURN && airOf(state).staged.includes(u.id)) return false;
  return stagingBases(ctx, state, u).some((c) => stageProblem(ctx, state, [u], c.hex) === null);
}

/** The Major Powers of the side to move that are in the war and have an airbase in reserve. */
export const powersWithReserve = (state: GameState): PowerId[] =>
  (Object.keys(state.nations) as PowerId[]).filter((p) => isMajorPower(p) && sideInWar(state, p) === state.activeSide && airbasesInReserve(state, p) > 0);

export function hasAirMoveWork(ctx: GameContext, state: GameState): boolean {
  // A plane of the other side is refused by `stageProblem` (it names the bases the side to move held at the start of its turn), so no side test is made here.
  const planes = Object.values(state.units).filter((u) => u.type === "air" && Object.hasOwn(ctx.map.hexes, u.at));
  return planes.some((u) => canStage(ctx, state, u)) || powersWithReserve(state).some((p) => airbasePlacements(ctx, state, p).length > 0);
}
