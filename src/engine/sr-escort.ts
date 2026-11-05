import type { GameContext } from "./context";
import { controllingSide, sideInWar } from "./control";
import type { HexId } from "./hex";
import { endProblem } from "./movement";
import { occupationSrProblem } from "./occupation-step";
import { isPort, portFronts, portsOf } from "./naval-ports";
import { fleetMayAct } from "./naval-record";
import { baseChangeCourseProblem, seaRoute } from "./naval-routes";
import { srOf } from "./sr-record";
import { srRegion, srUnitProblem, srView, type SrView } from "./sr-region";
import { srAllowanceProblem, srUnitCost } from "./sr-rules";
import type { GameState, Unit } from "./types";

/** Spec 16 R22, AER29 TODO(verify): Beta ends at the receiving port; no onward land leg or chains. */
export const SEA_ESCORT_PORT_DESTINATION_ONLY = true;
/** Ref 21.6, spec 16 R22: one ground counter of any size per full fleet. */
export const SEA_ESCORT_FACTORS = 9;
export const SEA_ESCORT_UNITS = 1;

/** Spec 16 R22: friendly, unused full fleets standing in a friendly port; the fleet stays there. */
export function escortFleets(ctx: GameContext, state: GameState): Unit[] {
  return Object.values(state.units).filter(f => f.type === "fleet" && f.strength === SEA_ESCORT_FACTORS &&
    sideInWar(state, f.owner) === state.activeSide && fleetMayAct(state, f.id) &&
    isPort(ctx, f.at) && controllingSide(ctx, state, f.at) === state.activeSide &&
    !srOf(state).moved.includes(f.id)).sort((a, b) => a.id.localeCompare(b.id));
}

/** Spec 16 R22: shortest sea route on one water Front, with no straits/canal chains (AER29). */
function seaHop(ctx: GameContext, state: GameState, from: HexId, to: HexId): boolean {
  if (from === to || !isPort(ctx, to) || controllingSide(ctx, state, to) !== state.activeSide) return false;
  const route = seaRoute(ctx, from, to);
  return route !== null && portFronts(ctx, from).some(front => portFronts(ctx, to).includes(front) &&
    baseChangeCourseProblem(ctx, state, state.activeSide, front, from, to, route) === null);
}

/** Spec 16 R18-R22: reuse all land eligibility, allowance, destination and occupation restrictions. */
export function escortProblem(ctx: GameContext, state: GameState, ids: readonly string[], to: HexId,
  escort: string, view: SrView = srView(ctx, state)): string | null {
  if (ids.length !== SEA_ESCORT_UNITS) return "A Sea Escort carries exactly one ground unit or Replacement.";
  const unit = state.units[ids[0]!];
  if (!unit) return "Choose a ground unit or Replacement.";
  const rec = srOf(state);
  const problem = srUnitProblem(ctx, state, unit, rec.moved, view) ??
    srAllowanceProblem(rec.used, srUnitCost(state, [unit]));
  if (problem) return problem;
  const fleet = escortFleets(ctx, state).find(f => f.id === escort);
  if (!fleet) return "Choose a free 9-factor fleet in a friendly port for the Sea Escort.";
  if (!srRegion(ctx, state, unit, view).has(fleet.at)) return "The unit cannot reach the escort's port over friendly supplied land.";
  if (unit.at === to || (SEA_ESCORT_PORT_DESTINATION_ONLY && !isPort(ctx, to)) || !seaHop(ctx, state, fleet.at, to)) return "A Sea Escort needs two friendly ports joined on one Front.";
  // R20: the receiving port must itself be a legal supplied land hex, even though it is outside the starting region.
  if (!srRegion(ctx, state, { ...unit, at: to }, view).has(to)) return "The receiving port is cut off or on or next to an enemy.";
  return occupationSrProblem(ctx, state, unit, to) ?? endProblem(ctx, state, [unit], to);
}

/** Legal single-hop choices; kept separate from land actions so the computer may leave escort unused (ticket 16-21). */
export function escortOptions(ctx: GameContext, state: GameState, unit: Unit, view: SrView = srView(ctx, state)): { to: HexId; escort: string }[] {
  const region = srRegion(ctx, state, unit, view);
  const fleets = escortFleets(ctx, state).filter(f => region.has(f.at));
  if (!fleets.length) return [];
  return portsOf(ctx).flatMap(to => fleets.filter(f => escortProblem(ctx, state, [unit.id], to, f.id, view) === null)
    .map(f => ({ to, escort: f.id })));
}
