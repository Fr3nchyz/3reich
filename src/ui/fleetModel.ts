import { legalActions, type Action } from "../engine/actions";
import type { GameContext } from "../engine/context";
import { interceptProblem, interceptTargets, interceptionCourse } from "../engine/naval-intercept";
import { interceptionRolls } from "../engine/tables";
import type { GameState } from "../engine/types";
import { placeName, unitName } from "./names";
import { cap } from "./format";
import { FLEET_TEXT as T } from "./navalText";

export type FleetMove = Extract<Action, { type: "MOVE_FLEET" }>;
export type FleetIntercept = Extract<Action, { type: "DECLARE_INTERCEPT" }>;
export interface FleetDraft {
  fleet?: string;
  destination?: string;
  target?: string;
  point?: string;
  fleets?: string[];
  breakOff?: boolean;
}
const fleetName = (ctx: GameContext, state: GameState, id: string) => {
  const u = state.units[id]!;
  return T.at(unitName(u, true), placeName(ctx.map, u.at));
};
const destinationKey = (a: FleetMove) => `${a.front}:${a.to}`;
export { destinationKey };

/** Spec 12 R10/D3, AER75: destinations are exactly the engine's MOVE_FLEET entries. No preview rolls. */
export function fleetMoveModel(ctx: GameContext, state: GameState, draft: FleetDraft = {}) {
  const legal = legalActions(ctx, state);
  const moves = legal.filter((a): a is FleetMove => a.type === "MOVE_FLEET");
  const fleets = [...new Set(moves.map(a => a.fleet))].map(id => ({ id, name: fleetName(ctx, state, id) }));
  const selected = fleets.find(f => f.id === draft.fleet);
  const destinations = moves.filter(a => a.fleet === selected?.id).map(action => ({
    key: destinationKey(action), name: `${placeName(ctx.map, action.to)} — ${cap(action.front)} Front`, action,
  }));
  const chosen = destinations.find(d => d.key === draft.destination);
  return { fleets, selected, destinations, action: chosen?.action ?? null,
    end: legal.find(a => a.type === "END_STEP" && a.step === "6b") ?? null };
}

/** Spec 12 R11/D3, AER84–87/AER90: proposals supply candidates; the engine validates the chosen subset and break-off. */
export function fleetInterceptModel(ctx: GameContext, state: GameState, draft: FleetDraft = {}) {
  const legal = legalActions(ctx, state);
  const proposals = legal.filter((a): a is FleetIntercept => a.type === "DECLARE_INTERCEPT");
  const allTargets = interceptTargets(state);
  const targets = [...new Set(proposals.map(a => a.target))].map(id => {
    const t = allTargets.find(t => t.id === id)!;
    return { id, name: T.course(t.fleets.map(f => unitName(state.units[f]!, true)).join(", "),
      placeName(ctx.map, t.path[0]!), placeName(ctx.map, t.path.at(-1)!)) };
  });
  const target = targets.find(t => t.id === draft.target) ?? targets[0];
  const meetings = proposals.filter(a => a.target === target?.id);
  const proposal = meetings.find(a => a.meetingPoint === draft.point) ?? meetings[0];
  const selected = draft.fleets ?? proposal?.fleets ?? [];
  const t = allTargets.find(t => t.id === target?.id);
  const fleets = (proposal?.fleets ?? []).map(id => {
    const u = state.units[id]!;
    const course = interceptionCourse(ctx, state, proposal!.side, t!.front, u.at, proposal!.meetingPoint)!;
    const distance = course.length - 1;
    return { id, name: fleetName(ctx, state, id), selected: selected.includes(id), distance,
      needed: interceptionRolls(distance) };
  });
  const candidate: FleetIntercept | null = proposal ? { ...proposal, fleets: fleets.filter(f => f.selected).map(f => f.id), breakOff: draft.breakOff ?? false } : null;
  const problem = candidate ? interceptProblem(ctx, state, candidate) : null;
  return { side: state.naval?.interceptSide ?? proposals[0]?.side, targets, target, fleets,
    meetings: meetings.map(a => ({ id: a.meetingPoint, name: placeName(ctx.map, a.meetingPoint) })),
    point: proposal?.meetingPoint, breakOff: draft.breakOff ?? false,
    action: candidate && !problem ? candidate : null,
    pass: legal.find(a => a.type === "PASS_INTERCEPT") ?? null,
    resolve: legal.find(a => a.type === "RESOLVE_INTERCEPTIONS") ?? null };
}
