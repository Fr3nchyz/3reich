import { otherSide } from "./game";
import { INTERCEPT_PASSES, declareIntercept, interceptEnabled, interceptPasses, interceptProblem, interceptSide, interceptTargets, interceptionsOf, resolveInterceptions } from "./naval-intercept";
import { fleetMoveOptions, movableFleets, moveFleet } from "./fleet-move";
import type { Action, ActionResult, GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { markUsed, navalOf, type SeaSupplyDesignation } from "./naval-record";
import { checkDesignations } from "./naval-supply";
import { seaSupplyOptions, seaSupplyProblem } from "./naval-supply-options";
import { supplyNetwork } from "./supply";
import { supplyEffectsOn } from "./supply-effects";
import type { GameState } from "./types";

/**
 * Sea supply at steps 6e and 9f (spec 12 R6, R8, C2, C3, C5; Ref 19.31, 5.45e, 5.48f): the player names the fleets, the receiving place and the
 * units; the rules are `seaSupplyProblem` (naval-supply.ts) and the effect is felt through `supplyStatus`, which feeds the units of every valid designation
 * recorded in `GameState.naval`. The steps wait only while supply effects are on and some cut-off unit could be saved by a legal designation
 * (`hasSeaSupplyWork`); with the switch off, as shipped, they are passed as they always were. TODO(verify), spec 12 part J: N8 (a fleet may be named again for
 * the capacity it has left), N14 and N34 (supply is read again when 6e is left, and the elimination then follows that list, so a unit saved at 6e whose
 * designation lapses is cut off again in `supplyStatus` but is not on the list and is not eliminated).
 */

export type DesignateSeaSupply = Extract<Action, { type: "DESIGNATE_SEA_SUPPLY" }>;

/** Whether the step waits for the side to move: supply effects are on and a legal designation would save at least one cut-off unit. */
export const hasSeaSupplyWork = (ctx: GameContext, state: GameState): boolean => supplyEffectsOn(ctx) && seaSupplyOptions(ctx, state, state.activeSide).length > 0;

/** The designations offered at 6e and 9f: one proposal per origin port and receiving place that saves at least one cut-off unit (C2, B7). `applyAction` accepts any legal subset. */
export const legalSeaSupply = (ctx: GameContext, state: GameState): DesignateSeaSupply[] =>
  seaSupplyOptions(ctx, state, state.activeSide).map((o) => ({ type: "DESIGNATE_SEA_SUPPLY", side: state.activeSide, fleets: o.fleets, to: o.to, units: o.units }));

/** Name fleets to carry supply to a place for units: refused with the first rule broken, in a sentence; otherwise recorded, and the fleets are used up for the Game Turn (R5). */
export function applySeaSupply(ctx: GameContext, state: GameState, action: DesignateSeaSupply): ActionResult {
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${String(action.side)}.` };
  // The port is where the fleets stand (they all stand in one port: the check says so); a malformed list gets the check's own sentence.
  const first = Array.isArray(action.fleets) && typeof action.fleets[0] === "string" ? state.units[action.fleets[0]] : undefined;
  const designation: SeaSupplyDesignation = { fleets: action.fleets, from: first?.at ?? "", to: action.to, units: action.units };
  const problem = seaSupplyProblem(ctx, state, state.activeSide, designation);
  if (problem !== null) return { ok: false, error: problem };
  const used = markUsed(state, action.fleets, "supply");
  const kept: SeaSupplyDesignation = { fleets: [...action.fleets], from: designation.from, to: action.to, units: [...action.units] };
  const rec = navalOf(used);
  const event: GameEvent = { type: "FLEET_DESIGNATED_FOR_SUPPLY", ...kept };
  return { ok: true, state: { ...used, naval: { ...rec, supply: [...rec.supply, kept] } }, events: [event] };
}

/**
 * The designations of this Player Turn that no longer hold (a fleet lost, the port cut off, the place taken, a unit gone: R7, R8), one event each, as
 * the Player Turn ends and before the units still cut off are eliminated. The units of a lapsed designation are cut off again in `supplyStatus`
 * whatever the elimination then does (`ELIMINATE_ONLY_IF_CUT_OFF_AT_START`, N34). Nothing is searched while no designation is recorded.
 */
export function lapsedDesignations(ctx: GameContext, state: GameState): GameEvent[] {
  if (!state.naval) return [];
  return checkDesignations(ctx, state, supplyNetwork(ctx, state, state.activeSide)).flatMap((c) =>
    c.problem === null ? [] : [{ type: "SEA_SUPPLY_LAPSED" as const, fleets: [...c.designation.fleets], from: c.designation.from, to: c.designation.to, units: [...c.designation.units], reason: c.problem }],
  );
}

/** TODO(verify) AER75, spec 12 Wiring 12-11b: pure opt-in; engine defaults stay empty. */
export function setManualFleetMove(state: GameState, enabled: boolean): GameState {
  return { ...state, naval: { ...navalOf(state), manualFleetMove: enabled } };
}

/** Spec 12 R10 / AER75: legal courses only for movable fleets of the active side. */
export function legalFleetMoves(ctx: GameContext, state: GameState): Extract<Action, { type: "MOVE_FLEET" }>[] {
  if (state.naval?.manualFleetMove !== true) return [];
  return movableFleets(ctx, state).flatMap((id) => fleetMoveOptions(ctx, state, id).map((move) => ({ type: "MOVE_FLEET", side: state.activeSide, ...move, path: move.path ? [...move.path] : undefined })));
}

/** Spec 12 R10 / AER75: record a validated move, leaving interception to 12-12. */
export function applyFleetMove(ctx: GameContext, state: GameState, action: Extract<Action, { type: "MOVE_FLEET" }>): ActionResult {
  if (state.naval?.manualFleetMove !== true) return { ok: false, error: "Manual fleet movement is not enabled (AER75)." };
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${action.side}.` };
  const done = moveFleet(ctx, state, action);
  if (!done.ok) return done;
  const course = { fleet: action.fleet, from: state.units[action.fleet]!.at, to: action.to, front: action.front, path: done.course };
  const rec = navalOf(done.state);
  return { ok: true, state: { ...done.state, naval: { ...rec, moves: [...(rec.moves ?? []), course] } }, events: [{ type: "FLEET_MOVED", side: action.side, ...course }] };
}

/** Spec 12 R11, TODO(verify) AER76–AER79: useful full-force proposals; arbitrary legal subsets accepted. */
export function legalInterceptDeclarations(ctx: GameContext, state: GameState): Extract<Action, { type: "DECLARE_INTERCEPT" }>[] {
  if (!interceptEnabled(state) || interceptPasses(state) >= INTERCEPT_PASSES) return [];
  const side = interceptSide(state);
  return interceptTargets(state).filter(t => t.side !== side).flatMap(target => [...new Set(target.path)].flatMap(meetingPoint => {
    const fleets = Object.keys(state.units).sort().filter(id => interceptProblem(ctx, state, { side, target: target.id, fleets: [id], meetingPoint }) === null);
    return fleets.length ? [{ type: "DECLARE_INTERCEPT" as const, side, target: target.id, fleets, meetingPoint }] : [];
  }));
}

/** Spec 12 C5 / AER76/AER80: stay for both passes once a round starts, then for explicit resolution. */
export function hasInterceptWork(ctx: GameContext, state: GameState, step: string): boolean {
  if (!interceptEnabled(state)) return false;
  const rec = navalOf(state);
  if (step === "6d") return interceptionsOf(state).length > 0 && rec.interceptsResolved !== true;
  return step === "6c" && interceptPasses(state) < INTERCEPT_PASSES && (rec.interceptSide !== undefined || interceptionsOf(state).length > 0 || legalInterceptDeclarations(ctx, state).length > 0);
}

/** TODO(verify) AER76/AER80: moving on requires a pass or resolution, never an END_STEP bypass. */
export function interceptMoveOn(state: GameState): Action[] {
  if (!interceptEnabled(state) || state.position?.part !== "player-turn") return [];
  if (state.position.step === "6c" && interceptPasses(state) < INTERCEPT_PASSES) return [{ type: "PASS_INTERCEPT", side: interceptSide(state) }];
  if (state.position.step === "6d" && interceptionsOf(state).length > 0 && navalOf(state).interceptsResolved !== true) return [{ type: "RESOLVE_INTERCEPTIONS", side: state.activeSide }];
  return [];
}

export function legalInterceptActions(ctx: GameContext, state: GameState, step: string): Action[] {
  return hasInterceptWork(ctx, state, step) ? [...(step === "6c" ? legalInterceptDeclarations(ctx, state) : []), ...interceptMoveOn(state)] : [];
}

/** Spec 12 R11/R12, TODO(verify) AER76–AER83: guards before writing state or rolling dice. */
export function applyIntercept(ctx: GameContext, state: GameState, action: Extract<Action, { type: "DECLARE_INTERCEPT" | "PASS_INTERCEPT" | "RESOLVE_INTERCEPTIONS" }>): ActionResult {
  if (!interceptEnabled(state)) return { ok: false, error: "Interception needs the manual movement flag and a recorded course (AER77)." };
  if (action.type === "RESOLVE_INTERCEPTIONS") {
    if (action.side !== state.activeSide || interceptPasses(state) < INTERCEPT_PASSES || navalOf(state).interceptsResolved || !interceptionsOf(state).length) return { ok: false, error: "Only the phasing side resolves queued interceptions after two passes (AER80)." };
    if (action.turnBack !== undefined && (!Array.isArray(action.turnBack) || Array.from(action.turnBack).some(id => typeof id !== "string" || !interceptTargets(state).some(t => t.id === id && id.startsWith("move:"))) || new Set(action.turnBack).size !== action.turnBack.length)) return { ok: false, error: "Turn-back choices must name distinct recorded moves (AER82)." };
    return { ok: true, ...resolveInterceptions(ctx, state, action.turnBack) };
  }
  if (action.side !== interceptSide(state) || interceptPasses(state) >= INTERCEPT_PASSES) return { ok: false, error: "It is not this side's interception round (Ref 21.5)." };
  if (action.type === "DECLARE_INTERCEPT") {
    const error = interceptProblem(ctx, state, action);
    if (error) return { ok: false, error };
    const next = declareIntercept(ctx, state, action);
    const item = interceptionsOf(next).find(i => i.target === action.target)!;
    return { ok: true, state: next, events: [{ type: "INTERCEPTION_DECLARED", side: action.side, interception: item.id, target: item.target, fleets: [...action.fleets], meetingPoint: item.meetingPoint, breakOff: item.breakOff }] };
  }
  const rec = navalOf(state), consecutive = interceptPasses(state) + 1;
  return { ok: true, state: { ...state, naval: { ...rec, interceptSide: otherSide(action.side), interceptPasses: consecutive } }, events: [{ type: "INTERCEPTION_PASSED", side: action.side, consecutive }] };
}
