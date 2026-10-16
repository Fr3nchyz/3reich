import { areEnemies, controllerOf, sideInWar } from "./control";
import type { GameContext } from "./context";
import { type HexId } from "./hex";
import { stackingProblem } from "./placement";
import { sideOfOwner } from "./setup";
import { MINOR_COUNTRY_FORCES } from "./tables";
import type { LandTerrain } from "./terrain";
import type { ForceOwner, GameState, Side, Unit, UnitType } from "./types";
import { atWar } from "./war";
import { hasMoved } from "./move-record";
import { adjacentHexes, canCross, enemyZocFor, ZOC_EXIT_COST, zocExitCost } from "./zoc";

/**
 * Ground movement at step 6f (Ref 5.45f, spec 03): which units can move, what a move may cross and
 * enter, and which hexes a stack can reach. Pure queries; applying a move is move-action.ts.
 *
 * The rule text in docs/RULES.md settles: a unit moves up to its movement factor in hexes along hexsides
 * ground units may cross (land hexsides and crossing arrows both ways, never Qattara, Ref 4.3, 4.6, 4.51),
 * leaving a hex in enemy armor ZOC costs 2 extra movement factors (Ref 7.0, spec 13), stacking applies at the end (Ref 5.0). It does not settle:
 * TODO(verify, Ref 4.5): the cost of entering terrain (`TERRAIN_MOVE_COST`: 1 for every terrain; rivers and
 * crossing arrows cost nothing extra); TODO(verify, Ref 5.45f): that each unit moves once per Player Turn
 * (`ONE_MOVE_PER_TURN`); TODO(verify, Ref 13.0, 14.0, 17.0): that neutral land cannot be entered (`NEUTRAL_LAND_CLOSED`).
 */

/** Counters that move on the ground. Replacements print no movement factor and stay put. Air units, fleets, airbases and bridgeheads are not in scope. */
export const GROUND_MOVERS: readonly UnitType[] = ["infantry", "armor", "airborne"];

/** Movement points spent on entering a hex of this terrain. TODO(verify, Ref 4.5): the terrain chart in docs/RULES.md gives defence only. */
export const TERRAIN_MOVE_COST: Readonly<Record<LandTerrain, number>> = { plain: 1, mountains: 1, swamp: 1, "qattara-depression": 1 };

/** Each unit moves at most once in a Player Turn. TODO(verify, Ref 5.45f): set false to let a unit move again with the points it has. */
export const ONE_MOVE_PER_TURN = true;

/**
 * A stack moves at its slowest unit's factor (`stackMovement`). TODO(verify, Ref 5.45f; spec 10 engine fact 8, docs/RULES.md "Ground movement open items"):
 * the rule text does not settle it; it is the same as moving each unit alone to the same hex, and nothing says a stack is one move.
 * A marker for the assumption (read by `stackMovement` and by the tests that name it), not a switch: no other reading is encoded.
 */
export const STACK_MOVES_AT_SLOWEST_UNIT = true;

/**
 * Units of different nations (Germans with Italians, say) may move as one group. TODO(verify, spec 10 engine fact 3): only British and French
 * are kept apart before 1942 (Ref 26.0, in stacking). Set false to refuse a group of more than one owner (checked where it ends, `endProblem`).
 */
export const MIXED_NATIONS_MOVE_TOGETHER = true;

/**
 * Stacking at the end of a move is checked one unit at a time, each seeing the ones before it (`endProblem`). TODO(verify, spec 10 engine fact 9):
 * it matters only for the London limit (three if all British) and the Anglo-French rule. A marker for the assumption, not a switch.
 */
export const STACKING_CHECKED_ONE_AT_A_TIME = true;

/** A unit may not enter land of a minor country that is not at war with it, or land held by a power that takes no side and is not at war with it. TODO(verify). */
export const NEUTRAL_LAND_CLOSED = true;

const isMinorCountry = (c: string | undefined): boolean => c !== undefined && Object.hasOwn(MINOR_COUNTRY_FORCES, c);

/** The movement points a unit has, or 0 when it cannot move on the ground at all. */
export const movementFactor = (u: Pick<Unit, "type" | "movement">): number =>
  GROUND_MOVERS.includes(u.type) && typeof u.movement === "number" && Number.isFinite(u.movement) && u.movement > 0 ? Math.floor(u.movement) : 0;

/** Why a unit cannot be moved now, or null if it can: of the side to move and at war, on the map, with movement left to spend. */
export function movableProblem(ctx: GameContext, state: GameState, u: Unit): string | null {
  if (movementFactor(u) === 0) return `${u.id} has no ground movement factor.`;
  if (!Object.hasOwn(ctx.map.hexes, u.at)) return `${u.id} is not on the map.`;
  if (sideInWar(state, u.owner) !== state.activeSide) return `${u.id} does not move for the ${state.activeSide} side now.`;
  if (ONE_MOVE_PER_TURN && hasMoved(state, u.id)) return `${u.id} has already moved this Player Turn.`;
  return null;
}

/** The ground units of the side to move that could move now, in id order. */
export function movableUnits(ctx: GameContext, state: GameState): Unit[] {
  const order = (u: Unit) => Number(u.id.replace(/\D/g, ""));
  return Object.values(state.units).filter((u) => movableProblem(ctx, state, u) === null).sort((a, b) => order(a) - order(b));
}

/** The points a stack moves with: the slowest unit's (`STACK_MOVES_AT_SLOWEST_UNIT`, TODO(verify)). */
export const stackMovement = (units: readonly Unit[]): number => Math.min(...units.map(movementFactor));

const occupancy = new WeakMap<GameState["units"], Map<HexId, Unit[]>>();

/** The units standing in a hex. The index is built once per set of units (they are never edited), so asking for many hexes is cheap. */
function occupants(state: GameState, hex: HexId): Unit[] {
  let index = occupancy.get(state.units);
  if (!index) {
    index = new Map();
    for (const u of Object.values(state.units)) index.set(u.at, [...(index.get(u.at) ?? []), u]);
    occupancy.set(state.units, index);
  }
  return index.get(hex) ?? [];
}

/** Why units of these owners may not enter `hex`: enemy or foreign units there, or land that is closed to them. Null if they may. */
export function entryProblem(ctx: GameContext, state: GameState, owners: readonly ForceOwner[], hex: HexId): string | null {
  const side = sideInWar(state, owners[0]!);
  const blocker = occupants(state, hex).find((u) => (sideOfOwner(u.owner) !== side || owners.some((o) => areEnemies(state, o, u.owner))));
  if (blocker) return `${hex} holds ${blocker.id} of the other side: that is an attack, not a move.`;
  return neutralLandProblem(ctx, state, owners, hex);
}

/**
 * Why units of these owners may not enter or pass over `hex` because it is neutral land (`NEUTRAL_LAND_CLOSED`, TODO(verify)), or null.
 * One test for ground movement and for air flight (spec 09 R4: "the same test, so one rule decides both").
 */
export function neutralLandProblem(ctx: GameContext, state: GameState, owners: readonly ForceOwner[], hex: HexId): string | null {
  if (!NEUTRAL_LAND_CLOSED) return null;
  const control = controllerOf(ctx, state, hex);
  const country = ctx.map.hexes[hex]?.country;
  for (const o of owners) {
    if (control !== null ? control !== o && sideInWar(state, control) === null && !atWar(state, o, control) : isMinorCountry(country) && !atWar(state, o, country as ForceOwner)) {
      return `${hex} is neutral land: ${o} is not at war with it.`;
    }
  }
  return null;
}

/** The cost of entering a hex. */
export const entryCost = (ctx: GameContext, hex: HexId): number => TERRAIN_MOVE_COST[ctx.map.hexes[hex]?.land ?? "plain"];

/**
 * Why these units, standing together, may not all end in `to` (stacking and the Anglo-French rule of Ref 5.0, 26.0, as
 * in setup), or null. They are added one at a time, so each sees the ones before it; units already there count (`STACKING_CHECKED_ONE_AT_A_TIME`, TODO(verify)).
 */
export function endProblem(ctx: GameContext, state: GameState, units: readonly Unit[], to: HexId): string | null {
  if (!MIXED_NATIONS_MOVE_TOGETHER && new Set(units.map((u) => u.owner)).size > 1) return "Units of different nations do not move as one group.";
  // Stacking looks only at the units in the hex, so the rest are left out of the state it is asked about.
  let s = { ...state, units: Object.fromEntries(occupants(state, to).map((u) => [u.id, u])) };
  for (const u of units) {
    const spec = { type: u.type, strength: u.strength, ...(u.nationality ? { nationality: u.nationality } : {}) };
    const problem = stackingProblem(ctx, s, u.owner, spec, to);
    if (problem) return problem;
    s = { ...s, units: { ...s.units, [u.id]: { ...u, at: to } } };
  }
  return null;
}

/** Why this path of entered hexes (start excluded) is not a legal move for these stacked units, or null. */
export function movePathProblem(ctx: GameContext, state: GameState, units: readonly Unit[], path: readonly HexId[]): string | null {
  const start = units[0]!.at;
  const owners = [...new Set(units.map((u) => u.owner))];
  const mp = stackMovement(units);
  let at = start;
  let spent = 0;
  let exited = false;
  const zoc = enemyZocFor(ctx, state, sideInWar(state, owners[0]!) as Side);
  const seen = new Set<HexId>([start]);
  for (const hex of path) {
    if (seen.has(hex)) return `The path goes through ${hex} twice.`;
    seen.add(hex);
    if (!adjacentHexes(ctx, at).includes(hex)) return `${hex} is not next to ${at}.`;
    if (!canCross(ctx, at, hex)) return `Ground units cannot cross from ${at} into ${hex}: that hexside is water or the Qattara Depression.`;
    const blocked = entryProblem(ctx, state, owners, hex);
    if (blocked) return blocked;
    const exit = zocExitCost(zoc, at);
    spent += exit + entryCost(ctx, hex);
    exited ||= exit > 0;
    if (spent > mp) return `The move costs ${spent} movement points${exited ? ` (leaving an enemy zone of control costs ${ZOC_EXIT_COST} more)` : ""}; the slowest unit has ${mp}.`;
    at = hex;
  }
  return endProblem(ctx, state, units, at);
}

/**
 * The hexes the stack can reach this Player Turn and the cheapest path to each (start excluded), a shortest path by cost,
 * ties broken by the fixed order of neighbours. Leaving a hex in enemy armor ZOC costs 2 extra (Ref 7.0), including the first step.
 * Where it may end is a separate question (`endProblem`). `zoc` is the side's enemy ZOC, passed in when many stacks are asked at once.
 */
export function reachableHexes(ctx: GameContext, state: GameState, units: readonly Unit[], zoc?: ReadonlySet<HexId>): Map<HexId, HexId[]> {
  const start = units[0]!.at;
  const owners = [...new Set(units.map((u) => u.owner))];
  const mp = stackMovement(units);
  const inZoc = zoc ?? enemyZocFor(ctx, state, sideInWar(state, owners[0]!) as Side);
  const best = new Map<HexId, { cost: number; path: HexId[] }>([[start, { cost: 0, path: [] }]]);
  const blocked = new Map<HexId, boolean>();
  const closed = (hex: HexId): boolean => blocked.get(hex) ?? blocked.set(hex, entryProblem(ctx, state, owners, hex) !== null).get(hex)!;
  const open: HexId[] = [start];
  const done = new Set<HexId>();
  while (open.length > 0) {
    let k = 0;
    for (let i = 1; i < open.length; i++) if (best.get(open[i]!)!.cost < best.get(open[k]!)!.cost) k = i;
    const here = open.splice(k, 1)[0]!;
    if (done.has(here)) continue;
    done.add(here);
    const now = best.get(here)!;
    for (const next of adjacentHexes(ctx, here)) {
      if (done.has(next) || !canCross(ctx, here, next) || closed(next)) continue;
      const cost = now.cost + zocExitCost(inZoc, here) + entryCost(ctx, next);
      if (cost > mp || (best.has(next) && best.get(next)!.cost <= cost)) continue;
      best.set(next, { cost, path: [...now.path, next] });
      open.push(next);
    }
  }
  best.delete(start);
  return new Map([...best].map(([hex, r]) => [hex, r.path]));
}
