import { isGroundCombatUnit, neighborIds } from "../engine/attack-rules";
import { areEnemies } from "../engine/control";
import { distance, hex } from "../engine/hex";
import { interceptionCourse, interceptTargets, interceptionsOf } from "../engine/naval-intercept";
import { supplyStatus } from "../engine/supply";
import { AI_USES_FLEETS } from "./policies";
import type { Action } from "../engine/actions";
import type { GameContext } from "../engine/context";
import { seaSupplyOptions } from "../engine/naval-supply-options";
import type { ForceOwner, GameState } from "../engine/types";
import type { Decision } from "./types";

const byHex = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, i) => id === b[i]);

/** Sea-supply policy (spec 12 Part E, Release I; R6/R7): save most units, then the lowest receiving hex, origin and fleet ids.
 * Re-read after every action; return only an action from the supplied legal list. The caller ends the step when none saves a unit.
 */
export function chooseSeaSupply(ctx: GameContext, state: GameState, legal: readonly Action[]): Decision | undefined {
  const options = seaSupplyOptions(ctx, state, state.activeSide).filter((o) => o.saves > 0)
    .sort((a, b) => b.saves - a.saves || byHex(a.to, b.to) || byHex(a.from, b.from) || byHex(a.fleets.join("|"), b.fleets.join("|")));
  for (const proposal of options) {
    const action = legal.find((a) => a.type === "DESIGNATE_SEA_SUPPLY" && a.side === state.activeSide && a.to === proposal.to
      && same(a.fleets, proposal.fleets) && same(a.units, proposal.units));
    if (action) return { action, why: `Sea supply saves ${proposal.saves} cut-off unit${proposal.saves === 1 ? "" : "s"}.` };
  }
  return undefined;
}

/** TODO(verify) AER111–AER115, spec 12 Part E: policy thresholds, not engine rules. */
export const FLEET_DANGER_BASES = 2;
export const FLEET_INTERCEPT_MAX_DISTANCE = 1;
export const FLEET_INTERCEPT_MIN_RATIO = 1;
export const FLEET_BREAK_OFF = false;

const moveKey = (a: Extract<Action, { type: "MOVE_FLEET" }>) => [a.to, a.fleet, a.front, ...(a.path ?? [])].join("|");
const interceptKey = (a: Extract<Action, { type: "DECLARE_INTERCEPT" }>) => [a.target, a.meetingPoint, ...a.fleets].join("|");

/** Spec 12 Part E / TODO(verify) AER111: adjacent hostile ground, irrespective of ground movement availability. */
function threatened(ctx: GameContext, state: GameState, owner: ForceOwner, at: string): boolean {
  const next = neighborIds(ctx, at);
  return Object.values(state.units).some(u => isGroundCombatUnit(u) && areEnemies(state, owner, u.owner) && next.includes(u.at));
}

/** Pure base-change policy over the real legal list; never enables the human flag (AER110–AER112/AER114). */
export function chooseFleetMove(ctx: GameContext, state: GameState, legal: readonly Action[]): Decision | undefined {
  if (!AI_USES_FLEETS || state.naval?.manualFleetMove !== true) return undefined;
  const pockets = supplyStatus(ctx, state, state.activeSide).unsupplied.map(id => state.units[id]!).filter(isGroundCombatUnit);
  const nearest = (at: string) => Math.min(...pockets.map(u => distance(hex(at), hex(u.at))));
  const candidates = legal.filter((a): a is Extract<Action, { type: "MOVE_FLEET" }> => a.type === "MOVE_FLEET").flatMap(action => {
    const fleet = state.units[action.fleet]!;
    const escape = threatened(ctx, state, fleet.owner, fleet.at);
    if (escape ? threatened(ctx, state, fleet.owner, action.to) : nearest(action.to) >= nearest(fleet.at)) return [];
    // AER112: distinct hostile bases, including fleets already used; engine sea routes decide reach.
    const bases = new Set(Object.values(state.units).filter(u => u.type === "fleet" && areEnemies(state, fleet.owner, u.owner)
      && interceptionCourse(ctx, state, action.side === "axis" ? "allies" : "axis", action.front, u.at, action.to) !== null).map(u => u.at));
    if (bases.size >= FLEET_DANGER_BASES) return [];
    return [{ action, escape, distance: nearest(action.to) }];
  }).sort((a, b) => Number(b.escape) - Number(a.escape) || (a.distance === b.distance ? 0 : a.distance - b.distance) || byHex(moveKey(a.action), moveKey(b.action)));
  const picked = candidates[0];
  return picked ? { action: picked.action, why: picked.escape ? "Move the fleet away from adjacent enemy ground forces." : "Move the fleet nearer an unsupplied friendly pocket." } : undefined;
}

/** Spec 12 Part E / TODO(verify) AER113–AER115: close, equal-or-stronger full forces; otherwise pass. */
export function chooseFleetIntercept(ctx: GameContext, state: GameState, legal: readonly Action[]): Decision | undefined {
  if (!AI_USES_FLEETS || state.naval?.manualFleetMove !== true) return undefined;
  const targets = interceptTargets(state);
  const factors = (ids: readonly string[]) => ids.reduce((sum, id) => sum + (state.units[id]?.strength ?? 0), 0);
  const declarations = legal.filter((a): a is Extract<Action, { type: "DECLARE_INTERCEPT" }> => a.type === "DECLARE_INTERCEPT").filter(a => {
    if ((a.breakOff ?? false) !== FLEET_BREAK_OFF) return false;
    const target = targets.find(t => t.id === a.target);
    if (!target) return false;
    const committed = interceptionsOf(state).find(i => i.target === a.target)?.fleets ?? [];
    if (factors([...new Set([...committed, ...a.fleets])]) < factors(target.fleets) * FLEET_INTERCEPT_MIN_RATIO) return false;
    return a.fleets.every(id => {
      const course = interceptionCourse(ctx, state, a.side, target.front, state.units[id]!.at, a.meetingPoint);
      return course !== null && course.length - 1 <= FLEET_INTERCEPT_MAX_DISTANCE;
    });
  }).sort((a, b) => byHex(interceptKey(a), interceptKey(b)));
  const action = declarations[0] ?? legal.find(a => a.type === "PASS_INTERCEPT" || a.type === "RESOLVE_INTERCEPTIONS");
  return action ? { action, why: action.type === "DECLARE_INTERCEPT" ? "Intercept nearby with at least equal naval factors." : action.type === "PASS_INTERCEPT" ? "Pass: no close interception with sufficient factors." : "Resolve the declared interceptions and continue surviving moves." } : undefined;
}
