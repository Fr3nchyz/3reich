import { isGroundCombatUnit, lonersAt } from "./attack-rules";
import { attritionHexProblem, occupiersOf } from "./attrition";
import { ATTRITION_USES_UNITS, attritionOf, closeAttritionRun, finishAttritionHexStage } from "./attrition-record";
import type { AttritionRecord, AttritionResult } from "./attrition-record";
import { afterHexTaken } from "./capture";
import type { GameContext } from "./context";
import { enterHexes } from "./control";
import { otherSide } from "./game";
import type { HexId } from "./hex";
import { eliminateUnits } from "./losses";
import { stackingProblem } from "./placement";
import { retreatOptions, retreatProblem } from "./retreat";
import type { GameState, Side } from "./types";

const participantsOf = (state: GameState, record: AttritionRecord) =>
  record.run!.participants.flatMap((id) => state.units[id] ? [state.units[id]] : []);

/** Phasing side selects just one current target (spec 16 R5; AER11). */
export function selectAttritionHexProblem(ctx: GameContext, state: GameState, record: AttritionRecord | undefined, side: Side, hex: HexId): string | null {
  const rec = attritionOf(state, record);
  if (!rec.run || rec.run.stage !== "hex") return "No Attrition hex selection is waiting.";
  if (side !== state.activeSide) return "The Phasing side must select the Attrition hex.";
  if (rec.run.hexesLeft <= 0) return "No Attrition hex allowance remains.";
  return attritionHexProblem(ctx, state, rec.run.front, hex, participantsOf(state, rec));
}

/** Resolve trapped units immediately, including on selection and after each retreat (spec 16 R6).
 * Air and ships use the same capture sweep as a battle, without a combat advance or Breakthrough (AER10).
 */
function settleRetreat(ctx: GameContext, result: AttritionResult): AttritionResult {
  let { state, record } = result;
  const events = [...result.events];
  const run = record.run!;
  const trapped = run.retreating!.filter((id) => retreatOptions(ctx, state, id).length === 0);
  const losses = eliminateUnits(state, trapped);
  state = losses.state;
  events.push(...losses.events);
  const retreating = run.retreating!.filter((id) => !trapped.includes(id));
  record = { ...record, run: { ...run, retreating } };
  if (!retreating.length) {
    const taken = afterHexTaken(ctx, state, run.target!, lonersAt(state, participantsOf(state, record), run.target!));
    const swept = eliminateUnits(taken.state, taken.destroy.map((u) => u.id));
    if (taken.destroy.length) events.push({ type: "UNITS_SWEPT", hex: run.target!, units: taken.destroy.map((u) => ({ id: u.id, owner: u.owner, type: u.type, strength: u.strength })) });
    state = swept.state;
    events.push(...swept.events, ...taken.events);
    record = { ...record, run: { ...record.run!, stage: "occupy", chooser: state.activeSide,
      occupiers: occupiersOf(ctx, state, run.target!, participantsOf(state, record)).map((u) => u.id) } };
  }
  return { state, record, events };
}

export function selectAttritionHex(ctx: GameContext, state: GameState, record: AttritionRecord | undefined, side: Side, hex: HexId): AttritionResult {
  const problem = selectAttritionHexProblem(ctx, state, record, side, hex);
  if (problem) throw new Error(problem);
  const rec = attritionOf(state, record);
  // Every ground unit must leave; replacements retreat too (spec 16 R6).
  const retreating = Object.values(state.units).filter((u) => u.at === hex && isGroundCombatUnit(u)).map((u) => u.id).sort();
  return settleRetreat(ctx, { state, record: { ...rec, run: { ...rec.run!, target: hex, stage: "retreat", chooser: otherSide(state.activeSide), retreating } },
    events: [{ type: "ATTRITION_HEX_SELECTED", hex }] });
}

/** Stopping is optional only between hexes (spec 16 R5/R8). */
export function endAttritionProblem(_ctx: GameContext, state: GameState, record: AttritionRecord | undefined, side: Side): string | null {
  if (attritionOf(state, record).run?.stage !== "hex") return "Attrition can end only at the hex selection stage.";
  return side !== state.activeSide ? "The Phasing side must end Attrition." : null;
}

export function endAttrition(ctx: GameContext, state: GameState, record: AttritionRecord | undefined, side: Side): AttritionResult {
  const problem = endAttritionProblem(ctx, state, record, side);
  if (problem) throw new Error(problem);
  return { state, record: closeAttritionRun(attritionOf(state, record)), events: [] };
}

/** The defender chooses a one-hex retreat; stacking is deferred to 6g (spec 16 R6; AER6). */
export function retreatAttritionUnitProblem(ctx: GameContext, state: GameState, record: AttritionRecord | undefined, side: Side, unitId: string, to: HexId): string | null {
  const run = attritionOf(state, record).run;
  if (!run || run.stage !== "retreat") return "No Attrition retreat is waiting.";
  if (side !== otherSide(state.activeSide)) return "The defending side must retreat its units.";
  if (!run.retreating?.includes(unitId) || state.units[unitId]?.at !== run.target) return "Choose a retreating ground unit in the selected hex.";
  return retreatProblem(ctx, state, unitId, to);
}

export function retreatAttritionUnit(ctx: GameContext, state: GameState, record: AttritionRecord | undefined, side: Side, unitId: string, to: HexId): AttritionResult {
  const problem = retreatAttritionUnitProblem(ctx, state, record, side, unitId, to);
  if (problem) throw new Error(problem);
  const rec = attritionOf(state, record);
  const unit = state.units[unitId]!;
  const entered = enterHexes(ctx, { ...state, units: { ...state.units, [unitId]: { ...unit, at: to } } }, unit, [to]);
  return settleRetreat(ctx, { state: entered.state, record: { ...rec, run: { ...rec.run!, retreating: rec.run!.retreating!.filter((id) => id !== unitId) } },
    events: [{ type: "UNIT_RETREATED", unit: unitId, from: unit.at, to }, ...entered.events] });
}

/** Occupation requires a nonempty, distinct subset of current eligible participants (spec 16 R7). */
export function occupyAttritionHexProblem(ctx: GameContext, state: GameState, record: AttritionRecord | undefined, side: Side, unitIds: readonly string[]): string | null {
  const rec = attritionOf(state, record);
  const run = rec.run;
  if (!run || run.stage !== "occupy") return "No Attrition occupation is waiting.";
  if (side !== state.activeSide) return "The Phasing side must occupy the Attrition hex.";
  const eligible = occupiersOf(ctx, state, run.target!, participantsOf(state, rec)).map((u) => u.id);
  if (!unitIds.length || new Set(unitIds).size !== unitIds.length || unitIds.some((id) => !eligible.includes(id))) return "Choose at least one distinct eligible Attrition occupier.";
  let next = state;
  for (const id of unitIds) {
    const u = next.units[id]!;
    const problem = stackingProblem(ctx, next, u.owner, u, run.target!);
    if (problem) return problem;
    next = { ...next, units: { ...next.units, [id]: { ...u, at: run.target! } } };
  }
  return null;
}

export function occupyAttritionHex(ctx: GameContext, state: GameState, record: AttritionRecord | undefined, side: Side, unitIds: readonly string[]): AttritionResult {
  const problem = occupyAttritionHexProblem(ctx, state, record, side, unitIds);
  if (problem) throw new Error(problem);
  const rec = attritionOf(state, record);
  const run = rec.run!;
  const target = run.target!;
  let next = state;
  const events: AttritionResult["events"] = [{ type: "ATTRITION_HEX_OCCUPIED", hex: target, units: [...unitIds] }];
  // Ref 6.0; spec 16 R7: ordinary entry takes control; occupation never opens a Breakthrough.
  for (const id of unitIds) {
    const u = next.units[id]!;
    const entered = enterHexes(ctx, { ...next, units: { ...next.units, [id]: { ...u, at: target } } }, u, [target]);
    next = entered.state;
    events.push(...entered.events);
  }
  const updated: AttritionRecord = { ...rec, used: ATTRITION_USES_UNITS ? [...new Set([...rec.used, ...unitIds])] : rec.used,
    run: { ...run, hexesLeft: run.hexesLeft - 1, taken: [...run.taken, target], stage: "hex", chooser: state.activeSide, target: undefined, retreating: undefined, occupiers: undefined } };
  return { state: next, record: finishAttritionHexStage(ctx, next, updated), events };
}
