import { angloFrenchStopProblem } from "./anglo-french";
import { crossable, isGroundCombatUnit, neighborIds } from "./attack-rules";
import type { GameContext } from "./context";
import { controllingSide } from "./control";
import type { HexId } from "./hex";
import { entryProblem } from "./movement";
import { angloFrenchSharingProblem } from "./placement";
import type { GameState } from "./types";

/** Why a ground counter cannot retreat one hex; overstacking and enemy ZOC are allowed (Ref 12.4, 5.0, 26.0; spec 16 R6; TODO(verify) AER6). */
export function retreatProblem(ctx: GameContext, state: GameState, unitId: string, to: HexId): string | null {
  const u = state.units[unitId];
  if (!u || !isGroundCombatUnit(u) || !ctx.map.hexes[u.at]) return "Only a ground unit on the map may retreat.";
  if (!ctx.map.hexes[to]?.land || !crossable(ctx, u.at, to)) return "A retreat must cross one land hexside or Crossing Arrow.";
  if (controllingSide(ctx, state, to) === null) return "A retreat must end on land controlled by either side.";
  return entryProblem(ctx, state, [u.owner], to) ?? angloFrenchStopProblem(ctx, state, u.owner, to) ?? angloFrenchSharingProblem(state, u.owner, Object.values(state.units).filter((other) => other.at === to));
}

/** Legal one-hex destinations, including enemy ZOC, vacant enemy fortresses and overstacked hexes. Empty means the later action must eliminate the unit; this query never does (Ref 12.4; spec 16 R6). */
export function retreatOptions(ctx: GameContext, state: GameState, unitId: string): HexId[] {
  const u = state.units[unitId];
  return !u || !ctx.map.hexes[u.at] ? [] : neighborIds(ctx, u.at).filter((to) => retreatProblem(ctx, state, unitId, to) === null);
}
