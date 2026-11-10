import type { Action, ActionResult, GameEvent } from "./action-types";
import { baseProblem } from "./air-bases";
import { applyPortLosses, chooseFleetLosses } from "./air-port-wire";
import { flightProblem } from "./air-range";
import { hasFlown, markFlown } from "./air-record";
import { MISSION_RANGE } from "./air-rules";
import { resolveSeaAttack } from "./air-sea-attack";
import type { GameContext } from "./context";
import { areEnemies, sideInWar } from "./control";
import { interceptTargets, interceptionsOf, INTERCEPT_PASSES, interceptPasses } from "./naval-intercept";
import { navalOf } from "./naval-record";
import type { GameState } from "./types";

type Designation = Extract<Action, { type: "DESIGNATE_SEA_AIR" }>;
/** TODO(verify) AER98/AER103: absent/off never creates work or state. */
export const seaAirOf = (s: GameState) => navalOf(s).manualSeaAir === true ? navalOf(s).seaAir ?? [] : [];
export const hasSeaAirWork = (s: GameState): boolean => seaAirOf(s).length > 0;
export const legalSeaAir = (s: GameState): Action[] => hasSeaAirWork(s) &&
  (!interceptionsOf(s).length || navalOf(s).interceptsResolved === true) ? [{ type: "RESOLVE_SEA_AIR", side: s.activeSide }] : [];

/** Ref 20.431/20.52; TODO(verify) AER98/AER99/AER101: assignments by either side at 6c. */
function designationProblem(ctx: GameContext, state: GameState, a: Designation): string | null {
  if (navalOf(state).manualSeaAir !== true) return "Manual sea air is disabled (AER98).";
  if (interceptPasses(state) >= INTERCEPT_PASSES) return "Naval declarations are closed (AER99).";
  const target = interceptTargets(state).find(t => t.id === a.target);
  if (!target || target.side === a.side || !target.path.includes(a.point)) return "Name an opposing recorded course and a point on it (Ref 20.431).";
  if (!Array.isArray(a.units) || !a.units.length || a.units.length > 100 || new Set(a.units).size !== a.units.length ||
    Array.from(a.units).some(id => typeof id !== "string" || !Object.hasOwn(state.units, id))) return "Name distinct air units on the map.";
  for (const id of a.units) {
    const u = state.units[id]!;
    if (u.type !== "air" || !Number.isInteger(u.strength) || u.strength <= 0 || sideInWar(state, u.owner) !== a.side || hasFlown(state, id)) return "Only this side's unused air may attack ships (Ref 20.3).";
    if (!ctx.map.hexes[u.at]?.land || target.fleets.some(f => !state.units[f] || !areEnemies(state, u.owner, state.units[f].owner))) return "Air needs an on-map base and hostile ships.";
    const error = baseProblem(ctx, state, u, u.at) ?? flightProblem(ctx, state, u.owner, u.at, a.point, MISSION_RANGE);
    if (error) return error;
  }
  return null;
}

/** AER98/AER101: flag-gated useful proposals; preview does not consume dice or missions. */
export function legalSeaAirDesignations(ctx: GameContext, state: GameState): Action[] {
  if (navalOf(state).manualSeaAir !== true || state.phase !== "player-turn" || state.position?.part !== "player-turn" || state.position.step !== "6c") return [];
  return interceptTargets(state).flatMap(t => t.path.flatMap(point => {
    const side = t.side === "axis" ? "allies" as const : "axis" as const;
    const units = Object.keys(state.units).sort().filter(id => designationProblem(ctx, state, { type: "DESIGNATE_SEA_AIR", side, target: t.id, point, units: [id] }) === null);
    return units.length ? [{ type: "DESIGNATE_SEA_AIR" as const, side, target: t.id, point, units }] : [];
  }));
}

export function applySeaAirDesignation(ctx: GameContext, state: GameState, a: Designation): ActionResult {
  const error = designationProblem(ctx, state, a);
  if (error) return { ok: false, error };
  const flown = markFlown(state, a.units, "sea-attack"), rec = navalOf(flown);
  return { ok: true, state: { ...flown, naval: { ...rec, seaAir: [...(rec.seaAir ?? []), { side: a.side, target: a.target, point: a.point, units: [...a.units] }] } }, events: [] };
}

/** Ref 20.52, spec 12 R15/R21; AER99–AER103: after naval dice, current participants only. */
export function applyResolveSeaAir(state: GameState, a: Extract<Action, { type: "RESOLVE_SEA_AIR" }>): ActionResult {
  if (a.side !== state.activeSide || !legalSeaAir(state).length) return { ok: false, error: "Resolve assigned sea air after naval interceptions (AER99)." };
  // AER100/AER102: initialize unopposed courses too, so replacements remain in later missions.
  let next: GameState = { ...state, naval: { ...navalOf(state), seaAirForces: navalOf(state).seaAirForces ??
    Object.fromEntries(interceptTargets(state).map(t => [t.id, [...t.fleets]])) } };
  const events: GameEvent[] = [];
  const results: NonNullable<ReturnType<typeof navalOf>["seaAirResults"]> = [];
  for (const mission of seaAirOf(state)) {
    const target = interceptTargets(next).find(t => t.id === mission.target);
    const ids = navalOf(next).seaAirForces?.[mission.target] ?? target?.fleets ?? [];
    const fleets = ids.flatMap(id => next.units[id]?.type === "fleet" ? [next.units[id]] : []);
    const attacker = mission.units.flatMap(id => next.units[id]?.type === "air" ? [next.units[id]] : []);
    if (!attacker.length) {
      results.push({ side: mission.side, target: mission.target, point: mission.point, result: null });
      continue;
    }
    const result = resolveSeaAttack({ attacker, fleets, rngState: next.rngState }, chooseFleetLosses);
    const loss = applyPortLosses(next, attacker.map(u => u.id), result, true);
    if ("problem" in loss) return { ok: false, error: loss.problem };
    next = { ...loss.state, rngState: result.rngState };
    results.push({ side: mission.side, target: mission.target, point: mission.point, result });
    events.push(...loss.events);
  }
  return { ok: true, state: { ...next, naval: { ...navalOf(next), seaAir: [], seaAirResults: results } }, events };
}
