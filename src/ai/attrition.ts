import { attritionParticipants, lossCandidates, occupiersOf, selectableHexes } from "../engine/attrition";
import { defendersAt, isGroundCombatUnit, neighborIds } from "../engine/attack-rules";
import type { GameContext } from "../engine/context";
import { enterHexes, sideInWar } from "../engine/control";
import { distance, hex, type HexId } from "../engine/hex";
import type { Front } from "../engine/map";
import { stackingProblem } from "../engine/placement";
import { retreatOptions } from "../engine/retreat";
import { isUnitSupplied } from "../engine/supply";
import type { GameState, Side, Unit } from "../engine/types";
import { MOVE_MAX_ENEMY_RATIO } from "./move";

// spec 16 Part E, R4; TODO(verify): AER47, settled ticket 16-8a loss ordering.
export const AI_ATTRITION_MISSING_MOVEMENT = 0;
// spec 16 Part E; TODO(verify): AER47, owners with no printed capital tie on distance.
export const AI_ATTRITION_NO_CAPITAL_DISTANCE = 0;
const order = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const factors = (units: readonly Unit[]): number => units.reduce((n, u) => n + u.strength, 0);

function capitalDistance(ctx: GameContext, unit: Unit, at = unit.at): number {
  const capitals = Object.values(ctx.map.hexes).filter((h) => h.country === unit.owner
    && h.features.some((f) => f === "capital" || f === "capital-port"));
  return capitals.length ? Math.min(...capitals.map((h) => distance(hex(at), hex(h.id)))) : AI_ATTRITION_NO_CAPITAL_DISTANCE;
}

/** Private copy of move.ts's local enemyNear policy, permitted by ticket 16-8a (Part E). */
function enemyNear(ctx: GameContext, state: GameState, side: Side, to: HexId): number {
  const near = neighborIds(ctx, to);
  return factors(Object.values(state.units).filter((u) => {
    const s = sideInWar(state, u.owner);
    return isGroundCombatUnit(u) && near.includes(u.at) && s !== null && s !== side;
  }));
}

/** R4 / Part E: whole-Front losses, Replacements before strength, movement, distance and id. */
export function chooseAttritionLosses(ctx: GameContext, state: GameState, front: Front, mustLose: number): string[] {
  const participants = attritionParticipants(ctx, state, front).units;
  return lossCandidates(ctx, state, front, participants).sort((a, b) =>
    Number(b.type === "replacement") - Number(a.type === "replacement") || a.strength - b.strength
    || (a.movement ?? AI_ATTRITION_MISSING_MOVEMENT) - (b.movement ?? AI_ATTRITION_MISSING_MOVEMENT)
    || capitalDistance(ctx, b) - capitalDistance(ctx, a) || order(a.id, b.id))
    .slice(0, mustLose).map((u) => u.id);
}

/** R7 / Part E: smallest safe legal stack; preferred units break equal-size ties. */
export function chooseOccupiers(ctx: GameContext, state: GameState, to: HexId, occupiers: readonly Unit[]): string[] {
  const eligible = occupiersOf(ctx, state, to, occupiers);
  const preferred = (u: Unit): number => Number(u.type === "armor" || u.type === "infantry");
  const units = [...eligible].sort((a, b) => preferred(b) - preferred(a) || b.strength - a.strength || order(a.id, b.id));
  const threat = enemyNear(ctx, state, state.activeSide, to);
  // R7: judge the vacated hex; its defenders will retreat before occupation.
  const base = { ...state, units: Object.fromEntries(Object.entries(state.units).filter(([, u]) => u.at !== to)) };
  function search(start: number, left: number, picked: Unit[], position: GameState): string[] | null {
    if (left === 0) return threat <= MOVE_MAX_ENEMY_RATIO * factors(picked) ? picked.map((u) => u.id) : null;
    for (let i = start; i <= units.length - left; i++) {
      const u = units[i]!;
      if (stackingProblem(ctx, position, u.owner, u, to) !== null) continue;
      const next = { ...position, units: { ...position.units, [u.id]: { ...u, at: to } } };
      const result = search(i + 1, left - 1, [...picked, u], next);
      if (result) return result;
    }
    return null;
  }
  for (let size = 1; size <= units.length; size++) {
    const result = search(0, size, [], base);
    if (result) return result;
  }
  // R7 / ticket 16-8a: forced occupation even when every non-empty set is unsafe.
  return [...eligible].sort((a, b) => b.strength - a.strength || order(a.id, b.id)).slice(0, 1).map((u) => u.id);
}

/** R5 / Part E: selection-time safety only; callers re-query after each retreat. */
export function chooseAttritionHex(ctx: GameContext, state: GameState, front: Front, participants: readonly Unit[], hexesLeft: number): HexId | null {
  if (hexesLeft <= 0) return null;
  const valuable = (to: HexId): number => Number(ctx.map.hexes[to]!.features.some((f) =>
    ["objective", "capital", "capital-port", "city", "port"].includes(f)));
  const candidates = [...selectableHexes(ctx, state, front, participants)].filter(([to, problem]) => {
    if (problem !== null) return false;
    const ids = chooseOccupiers(ctx, state, to, participants);
    return ids.length > 0 && enemyNear(ctx, state, state.activeSide, to) <= MOVE_MAX_ENEMY_RATIO * factors(ids.map((id) => state.units[id]!));
  }).map(([to]) => to);
  candidates.sort((a, b) => valuable(b) - valuable(a)
    || factors(defendersAt(state, participants, b)) - factors(defendersAt(state, participants, a)) || order(a, b));
  return candidates[0] ?? null;
}

/** R6 / Part E: supply, then adjacent enemy factors, capital distance, hex order. */
export function chooseRetreat(ctx: GameContext, state: GameState, unitId: string): HexId | null {
  const options = retreatOptions(ctx, state, unitId);
  const unit = state.units[unitId];
  if (!unit || options.length === 0) return null;
  const side = sideInWar(state, unit.owner);
  const supplied = (to: HexId): number => {
    // R6: retreat takes control; use the engine's capture effects before checking supply.
    const after = enterHexes(ctx, state, unit, [to]).state;
    return Number(isUnitSupplied(ctx, { ...after, units: { ...after.units, [unitId]: { ...unit, at: to } } }, unitId));
  };
  options.sort((a, b) => supplied(b) - supplied(a)
    || (side === null ? 0 : enemyNear(ctx, state, side, a) - enemyNear(ctx, state, side, b))
    || capitalDistance(ctx, unit, a) - capitalDistance(ctx, unit, b) || order(a, b));
  return options[0] ?? null;
}
