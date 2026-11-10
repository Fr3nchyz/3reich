import { applyAction, legalActions, type Action } from "../engine/actions";
import type { GameContext } from "../engine/context";
import { interceptTargets } from "../engine/naval-intercept";
import { navalOf } from "../engine/naval-record";
import type { GameState, Side } from "../engine/types";
import { placeName, unitName } from "./names";
import { SEA_AIR_TEXT as T } from "./navalText";
import { sideName } from "./format";

type Designation = Extract<Action, { type: "DESIGNATE_SEA_AIR" }>;
export interface AirSeaDraft { units?: readonly string[]; target?: string; point?: string }

/** Spec 12 R15, AER98–103: choices and timing come only from legal actions.
 * Both sides may designate at 6c, independently of the interception round's actor.
 * A pure engine validation of a subset consumes no missions or dice in the real state. */
export function airSeaModel(ctx: GameContext, state: GameState, side: Side, draft: AirSeaDraft = {}) {
  if (state.phase !== "player-turn" || state.position?.part !== "player-turn") return null;
  const rec = navalOf(state);
  if (rec.manualSeaAir !== true) return null;
  const legal = legalActions(ctx, state);
  const proposals = legal.filter((a): a is Designation => a.type === "DESIGNATE_SEA_AIR" && a.side === side);
  const courses = interceptTargets(state);
  const courseName = (id: string) => {
    const t = courses.find(t => t.id === id);
    if (!t) return T.fleet;
    const names = t.fleets.flatMap(id => state.units[id] ? [unitName(state.units[id], true)] : []);
    return T.course(names.join(", ") || T.fleet, placeName(ctx.map, t.path[0]!), placeName(ctx.map, t.path.at(-1)!));
  };
  const planes = [...new Set(proposals.flatMap(a => a.units))].map(id => {
    const u = state.units[id]!;
    return { id, text: T.at(unitName(u), placeName(ctx.map, u.at)), chosen: draft.units?.includes(id) ?? false };
  });
  const selected = planes.filter(p => p.chosen).map(p => p.id);
  const targets = [...new Set(proposals.map(a => a.target))].map(id => ({ id, text: courseName(id), chosen: draft.target === id }));
  const meetings = proposals.filter(a => a.target === draft.target);
  const proposal = meetings.find(a => a.point === draft.point) ?? (draft.point === undefined ? meetings[0] : undefined);
  const points = meetings.map(a => ({ id: a.point, text: placeName(ctx.map, a.point), chosen: proposal?.point === a.point }));
  const candidate = proposal ? { ...proposal, units: selected } : null;
  const action = candidate && selected.length > 0 && selected.length === (draft.units?.length ?? 0) &&
    selected.every(id => proposal!.units.includes(id)) && applyAction(ctx, state, candidate).ok ? candidate : null;
  const resolve = legal.find(a => a.type === "RESOLVE_SEA_AIR" && a.side === side) ?? null;
  const assigned = (rec.seaAir ?? []).filter(a => a.side === side).map(a => ({
    target: courseName(a.target), point: placeName(ctx.map, a.point),
    planes: a.units.flatMap(id => state.units[id] ? [unitName(state.units[id])] : []),
  }));
  // AER103: stored actual dice and actual losses; null and no-fleets never imply a roll.
  const results = (rec.seaAirResults ?? []).map(r => ({
    title: T.resultTitle(sideName(r.side), courseName(r.target), placeName(ctx.map, r.point)),
    lines: r.result === null ? [T.noAir] : r.result.status === "no-fleets" ? [T.noFleets] : [
      T.rolls(r.result.rolls.map(r => r.roll)), T.losses(r.result.air.lost, r.result.navalHits, r.result.navalLost),
    ],
  }));
  return proposals.length || resolve || assigned.length || results.length ? {
    planes, targets, points, action, resolve, assigned, results,
    factors: selected.reduce((sum, id) => sum + state.units[id]!.strength, 0),
  } : null;
}
