import type { Action, ActionResult, GameEvent } from "./action-types";
import { enterHexes } from "./control";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { noteMinorEntry } from "./minors-duty";
import { noteIntervention } from "./minors-intervene";
import { movesOf } from "./move-record";
import { endProblem, movableProblem, movableUnits, movePathProblem, reachableHexes } from "./movement";
import type { GameState, Unit } from "./types";
import { enemyZocFor } from "./zoc";

/**
 * The MOVE action at step 6f (Ref 5.45f, spec 03): one unit or a stack standing together moves along
 * a path of adjacent hexes. Rules and their open questions are in movement.ts. Not built: air movement, fleets,
 * supply, strategic redeployment, overstack elimination at 6g, and a computer that moves.
 */

type MoveAction = Extract<Action, { type: "MOVE" }>;

/**
 * Whether control changes on the hexes a unit only passes through, not just where it ends (Ref 7.0).
 * TODO(verify, Ref 7.0): the rule text does not settle it. Off: only the hex where the move ends changes hands, which does not
 * depend on which of several equal routes the listed path happens to take. Set true for control.ts's other reading (every hex entered).
 */
export const CONTROL_ON_PASS_THROUGH = false;

/** Counts uncached computations of the full move list, so a test can bound the work a tap causes. */
export const moveListStats = { computed: 0 };

const listed = new WeakMap<GameState, WeakMap<GameContext, Action[]>>();

/** True for a real array of strings: holes (a sparse array) and other entries are refused, since `some` and `map` skip holes. */
function allStrings(x: unknown): x is string[] {
  if (!Array.isArray(x)) return false;
  for (let i = 0; i < x.length; i++) if (typeof x[i] !== "string") return false;
  return true;
}

/** Groups of movable units that stand in one hex, in hex order (units in id order). */
function groups(ctx: GameContext, state: GameState): Unit[][] {
  const by = new Map<HexId, Unit[]>();
  for (const u of movableUnits(ctx, state)) by.set(u.at, [...(by.get(u.at) ?? []), u]);
  return [...by].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, us]) => us);
}

/** Each place this group can end, with the path to it, by the cheapest route that is allowed. */
export function destinations(ctx: GameContext, state: GameState, units: readonly Unit[], zoc: ReadonlySet<HexId>): [HexId, HexId[]][] {
  return [...reachableHexes(ctx, state, units, zoc)].filter(([hex]) => endProblem(ctx, state, units, hex) === null).sort(([a], [b]) => (a < b ? -1 : 1));
}

/**
 * Every move the side to move may make now: each movable unit alone to each place it can reach, and each stack of two or
 * more that can move together (the slowest unit's points) to each place all of it can reach.
 */
export function legalMoves(ctx: GameContext, state: GameState): Action[] {
  // A state is never changed, so its list is computed once however often the UI and the computer ask (the list is not to be edited).
  const hit = listed.get(state)?.get(ctx);
  if (hit) return hit;
  const out = computeMoves(ctx, state);
  listed.set(state, (listed.get(state) ?? new WeakMap()).set(ctx, out));
  return out;
}

function computeMoves(ctx: GameContext, state: GameState): Action[] {
  moveListStats.computed++;
  const side = state.activeSide;
  const zoc = enemyZocFor(ctx, state, side);
  const out: Action[] = [];
  for (const group of groups(ctx, state)) {
    for (const set of group.length > 1 ? [...group.map((u) => [u]), group] : [group]) {
      for (const [, path] of destinations(ctx, state, set, zoc)) out.push({ type: "MOVE", side, units: set.map((u) => u.id), path });
    }
  }
  return out;
}

/** Whether any unit of the side to move can move at all: the step waits only while this is true. */
export function hasMoveWork(ctx: GameContext, state: GameState): boolean {
  const zoc = enemyZocFor(ctx, state, state.activeSide);
  return movableUnits(ctx, state).some((u) => destinations(ctx, state, [u], zoc).length > 0);
}

/** The reasons the units named cannot move together, or the units themselves. */
export function resolveUnits(ctx: GameContext, state: GameState, ids: unknown): { units: Unit[] } | { error: string } {
  if (!allStrings(ids) || ids.length === 0 || new Set(ids).size !== ids.length) return { error: "A move names one or more distinct units." };
  if (ids.some((id) => !Object.hasOwn(state.units, id))) return { error: "A moving unit is not on the map." };
  const units = ids.map((id) => state.units[id]!);
  for (const u of units) {
    const problem = movableProblem(ctx, state, u);
    if (problem) return { error: problem };
  }
  const apart = units.find((u) => u.at !== units[0]!.at);
  return apart ? { error: `${apart.id} at ${apart.at} is not with ${units[0]!.id} at ${units[0]!.at}: only units in one hex move as a stack.` } : { units };
}

/** Moves the units along the path; control changes through the hexes entered (control.ts). */
export function applyMove(ctx: GameContext, state: GameState, action: MoveAction): ActionResult {
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${action.side}.` };
  const found = resolveUnits(ctx, state, action.units);
  if ("error" in found) return { ok: false, error: found.error };
  const { units } = found;
  const path = action.path;
  if (!allStrings(path) || path.length === 0 || path.some((h) => !Object.hasOwn(ctx.map.hexes, h))) {
    return { ok: false, error: "A move names a path of one or more hexes on the map." };
  }
  const problem = movePathProblem(ctx, state, units, path);
  if (problem) return { ok: false, error: problem };

  const to = path[path.length - 1]!;
  const from = units[0]!.at;
  const rec = movesOf(state);
  let next: GameState = {
    ...state,
    units: { ...state.units, ...Object.fromEntries(units.map((u) => [u.id, { ...u, at: to }])) },
    moves: { ...rec, moved: [...rec.moved, ...units.map((u) => u.id)] },
  };
  const events: GameEvent[] = [{ type: "UNITS_MOVED", units: units.map((u) => u.id), from, to, path: [...path] }];
  for (const u of units) {
    const entered = enterHexes(ctx, next, next.units[u.id]!, CONTROL_ON_PASS_THROUGH ? path : [to]);
    next = entered.state;
    events.push(...entered.events);
  }
  // Spec 15 R4: a move into a minor's land meets the declarer's duty; a pass-through counts, whatever CONTROL_ON_PASS_THROUGH says about control.
  next = noteMinorEntry(ctx, next, units, path);
  // Spec 15 R6: the same entry by a Major Power of the minor's side is its Intervention.
  const helped = noteIntervention(ctx, next, units, path);
  next = helped.state;
  events.push(...helped.events);
  return { ok: true, state: next, events };
}
