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
