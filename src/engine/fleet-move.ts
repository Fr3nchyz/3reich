import type { GameContext } from "./context";
import type { HexId } from "./hex";
import type { Front } from "./map";
import { baseChangeProblem } from "./naval-change";
import { portFronts, portsOf } from "./naval-ports";
import { navalOf } from "./naval-record";
import { baseChangeRoute } from "./naval-routes";
import type { GameState } from "./types";

/** A single fleet's course, including both ports (spec 12 R10; Ref 21.2). No action or interception is resolved here. */
export interface FleetMove {
  fleet: string;
  to: HexId;
  front: Front;
  path?: readonly HexId[];
}

export type FleetMoveResult = { ok: true; state: GameState; course: HexId[] } | { ok: false; error: string };

/** First refusal, or null. Reuse every base-change check of ticket 12-10 (spec 12 R2–R5, R10; Ref 21.1–21.3). */
export function fleetMoveProblem(ctx: GameContext, state: GameState, move: FleetMove): string | null {
  if (!Object.hasOwn(state.units, move.fleet)) return `${move.fleet} is not on the map.`;
  // Spec 12 R5/R6, Ref 21.3: a fleet may change base before carrying supply, never after it this Player Turn.
  if (navalOf(state).supply.some((d) => d.fleets.includes(move.fleet))) return `${move.fleet} already carries sea supply this Player Turn (Ref 21.3).`;
  return baseChangeProblem(ctx, state, state.units[move.fleet]!, move.to, move.front, move.path);
}

/**
 * Legal destinations and their shortest courses, in port hex-id order then opening Front order (spec 12 R10; Ref 21.2).
 * Range is unlimited on the fleet's Front. A two-Front base offers each Front explicitly (R3; Ref 21.1).
 */
export function fleetMoveOptions(ctx: GameContext, state: GameState, id: string): FleetMove[] {
  if (!Object.hasOwn(state.units, id)) return [];
  const fleet = state.units[id]!;
  const options: FleetMove[] = [];
  for (const to of portsOf(ctx).sort()) for (const front of portFronts(ctx, fleet.at)) {
    const move: FleetMove = { fleet: id, to, front };
    if (fleetMoveProblem(ctx, state, move) !== null) continue;
    const path = baseChangeRoute(ctx, state, state.activeSide, front, fleet.at, to)!;
    options.push({ ...move, path });
  }
  return options;
}

/** Fleets with at least one legal change at 6b, in unit-id order (spec 12 R10; Ref 21.2). */
export function movableFleets(ctx: GameContext, state: GameState): string[] {
  return Object.keys(state.units).sort().filter((id) => fleetMoveOptions(ctx, state, id).length > 0);
}

/**
 * Apply a validated base change without mutating the position (spec 12 R10; Ref 21.2).
 * Record it once for this Player Turn; keep the Game Turn's function ledger unchanged (R5; Ref 21.3).
 * The returned course is for the later interception slice; no pending combat or event is invented here.
 */
export function moveFleet(ctx: GameContext, state: GameState, move: FleetMove): FleetMoveResult {
  const error = fleetMoveProblem(ctx, state, move);
  if (error !== null) return { ok: false, error };
  const fleet = state.units[move.fleet]!;
  const course = move.path ?? baseChangeRoute(ctx, state, state.activeSide, move.front, fleet.at, move.to)!;
  const rec = navalOf(state);
  return {
    ok: true,
    state: {
      ...state,
      units: { ...state.units, [move.fleet]: { ...fleet, at: move.to } },
      naval: { ...rec, moved: [...rec.moved, move.fleet] },
    },
    course: [...course],
  };
}

/** TODO(verify) AER119–AER120, spec 12 R10: one current-turn force per origin/destination/Front. */
export function fleetMoveGroups(state: GameState) {
  const groups: { id: string; from: HexId; to: HexId; front: Front; fleets: string[]; path: HexId[] }[] = [];
  for (const [i, move] of (navalOf(state).moves ?? []).entries()) {
    const group = state.naval?.manualFleetMove === true && groups.find(g => g.from === move.from && g.to === move.to && g.front === move.front);
    if (group) {
      group.fleets.push(move.fleet);
      group.path = [...new Set([...group.path, ...move.path])];
    } else groups.push({ id: `move:${i}`, from: move.from, to: move.to, front: move.front, fleets: [move.fleet], path: [...move.path] });
  }
  return groups;
}
