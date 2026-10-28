import { airOf } from "./air-record";
import type { GameContext } from "./context";
import { areEnemies, sideInWar } from "./control";
import { frontOptionOf } from "./frontoptions";
import { distance, parseHexId, type HexId } from "./hex";
import type { Front } from "./map";
import { movesOf } from "./move-record";
import { mayBasePort, portCapacity, portFronts } from "./naval-ports";
import { grayProblem, grayUntil, heldAtStart, navalOf, useOf } from "./naval-record";
import { baseChangeCourseProblem, baseChangeRoute } from "./naval-routes";
import { ONE_BASE_CHANGE_PER_TURN } from "./naval-rules";
import type { GameState, Side, Unit } from "./types";

/** Spec 12 R10, Ref 11.42: under Pass the entire course must be more than four hexes from every enemy plane. */
export const PASS_PLANE_RANGE = 4;
/** TODO(verify): N20, measure plane distance straight across the hex grid, from each course hex, including both ports. */
export const PASS_PLANE_DISTANCE = distance;

/** R10 Option row (Ref 11.41, 11.42). N20: the enemy-fleet test uses its port's water Front; even planes unable to intercept count. */
export function baseChangeOptionProblem(ctx: GameContext, state: GameState, fleet: Unit, front: Front, course: readonly HexId[]): string | null {
  if (frontOptionOf(state, front) !== "defensive") return null;
  for (const enemy of Object.values(state.units).filter((u) => areEnemies(state, fleet.owner, u.owner))) {
    if (enemy.type === "fleet" && portFronts(ctx, enemy.at).includes(front)) return `Pass Option: enemy fleet ${enemy.id} is based on the ${front} Front (Ref 11.42).`;
    if (enemy.type !== "air") continue;
    const plane = parseHexId(enemy.at);
    if (plane && ctx.map.hexes[enemy.at] && course.some((h) => {
      const at = parseHexId(h);
      return at !== null && PASS_PLANE_DISTANCE(at, plane) <= PASS_PLANE_RANGE;
    })) return `Pass Option: the course comes within ${PASS_PLANE_RANGE} hexes of enemy plane ${enemy.id} (Ref 11.42).`;
  }
  return null;
}

/** R10 Same Front row (R3; Ref 21.1, 21.2): the caller names the fleet's Front, including at a two-Front port. */
export function baseChangeFrontProblem(ctx: GameContext, fleet: Unit, to: HexId, front: Front): string | null {
  return portFronts(ctx, fleet.at).includes(front) && portFronts(ctx, to).includes(front) ? null : `Both ports must serve the fleet's ${front} Front (Ref 21.2).`;
}

/** R10 Held at the start row (Ref 21.2): read the Player Turn snapshot, not current control. */
export const baseChangeHeldProblem = (ctx: GameContext, state: GameState, side: Side, to: HexId): string | null =>
  heldAtStart(ctx, state, side, to) ? null : `${to} was not held by the ${side} side at the start of its Player Turn (Ref 21.2).`;

/** R10 Room and nation row (R2, R4; Ref 21.1, 26.0, 27.0): room for the whole counter; other unit types use no naval capacity. */
export function baseChangePortProblem(ctx: GameContext, state: GameState, fleet: Unit, to: HexId): string | null {
  const nation = mayBasePort(ctx, state, fleet, to);
  if (nation) return nation;
  const factors = Object.values(state.units).filter((u) => u.id !== fleet.id && u.type === "fleet" && u.at === to).reduce((n, u) => n + u.strength, 0);
  const capacity = portCapacity(ctx, to);
  return factors + fleet.strength > capacity ? `${to} would hold ${factors + fleet.strength} naval factors (limit ${capacity}, Ref 21.1).` : null;
}

/** R10 Once row (Ref 21.2), TODO(verify): N19. A stale Player Turn record does not block a new change. */
export const baseChangeOnceProblem = (state: GameState, id: string): string | null =>
  ONE_BASE_CHANGE_PER_TURN && navalOf(state).moved.includes(id) ? `${id} has already changed base this Player Turn (N19).` : null;

/** R10 Before the rest row (Ref 21.2; Ops 5.45b): step 6b, before any air staging or ground/air movement. */
export function baseChangeOrderProblem(state: GameState): string | null {
  if (state.phase !== "player-turn" || state.position?.part !== "player-turn" || state.position.step !== "6b") return "Fleets change base at step 6b, before air or ground movement (Ref 21.2).";
  if (movesOf(state).moved.length || airOf(state).staged.length) return "Fleets must change base before any air or ground unit moves (Ref 21.2).";
  return null;
}

/**
 * All R10 checks for one fleet; nothing moves or is recorded. With no course supplied, choose the shortest legal sea course first,
 * then test the Option against that course (spec 12 R10). Action validation and recording belong to ticket 12-11.
 */
export function baseChangeProblem(ctx: GameContext, state: GameState, fleet: Unit, to: HexId, front: Front, path?: readonly HexId[]): string | null {
  if (fleet.type !== "fleet") return `${fleet.id} is not a fleet.`;
  const side = sideInWar(state, fleet.owner);
  if (side === null || side !== state.activeSide) return `${fleet.id} does not change base for the active side.`;
  if (fleet.at === to) return `${to} is already this fleet's base.`;
  // Spec 12 R5, Ref 21.3, 11.62: new and gray fleets cannot act; a base change itself uses no function.
  const until = grayUntil(state, fleet.id);
  if (until) return grayProblem(fleet.id, until);
  if (useOf(state, fleet.id) === "new") return `${fleet.id} was built this Game Turn and cannot act yet (Ref 21.3).`;
  const problem = baseChangeFrontProblem(ctx, fleet, to, front) ?? baseChangeHeldProblem(ctx, state, side, to)
    ?? baseChangePortProblem(ctx, state, fleet, to) ?? baseChangeOnceProblem(state, fleet.id) ?? baseChangeOrderProblem(state);
  if (problem) return problem;
  const course = path ?? baseChangeRoute(ctx, state, side, front, fleet.at, to);
  if (course === null) return `No sea course joins ${fleet.at} to ${to} on the ${front} Front (Ref 21.2).`;
  return baseChangeCourseProblem(ctx, state, side, front, fleet.at, to, course) ?? baseChangeOptionProblem(ctx, state, fleet, front, course);
}
