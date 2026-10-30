import type { GameEvent } from "./action-types";
import { crossable, defendersAt, neighborIds } from "./attack-rules";
import { attritionLossProblem, attritionParticipants, lossCandidates, selectableHexes } from "./attrition";
import { attritionColumn, resolveAttrition } from "./combat";
import type { AttritionColumn } from "./combat";
import { turnKey } from "./combat-record";
import type { GameContext } from "./context";
import { frontOptionOf } from "./frontoptions";
import { otherSide } from "./game";
import type { HexId } from "./hex";
import { eliminateUnits } from "./losses";
import type { Front } from "./map";
import type { ForceOwner, GameState, Side } from "./types";

/** TODO(verify) AER8: participation/occupation uses a unit for the Player Turn (spec 16 R2/R7). */
export const ATTRITION_USES_UNITS = true;
/** TODO(verify) AER9: each Front is resolved at most once per Player Turn (spec 16 R8). */
export const ATTRITION_ONCE_PER_FRONT = true;

/** Serializable run, including the later hex/retreat/occupation stages (spec 16 C1). */
export interface AttritionRun {
  front: Front;
  factors: number;
  column: AttritionColumn;
  roll: number;
  mustLose: number;
  hexesLeft: number;
  participants: string[];
  against: ForceOwner[];
  stage: "losses" | "hex" | "retreat" | "occupy";
  chooser: Side;
  target?: HexId;
  retreating?: string[];
  occupiers?: string[];
  taken: HexId[];
}

/** Kept separately from GameState until the action ticket wires it (spec 16 C1).
 * `used` preserves participation after a completed run; future occupation also adds its ids (AER8).
 */
export interface AttritionRecord {
  turn: string;
  done: Front[];
  run: AttritionRun | null;
  used: string[];
}

/** Payloads for the later action integration; no new shared event types yet (spec 16 C4). */
export type AttritionEvent =
  | { type: "ATTRITION_RESOLVED"; front: Front; side: Side; factors: number; column: AttritionColumn; roll: number; mustLose: number; hexesLeft: number; against: ForceOwner[] }
  | { type: "ATTRITION_LOSSES_CHOSEN"; units: string[] }
  | { type: "ATTRITION_HEX_SELECTED"; hex: HexId }
  | { type: "UNIT_RETREATED"; unit: string; from: HexId; to: HexId }
  | { type: "ATTRITION_HEX_OCCUPIED"; hex: HexId; units: string[] };
export interface AttritionResult { state: GameState; record: AttritionRecord; events: GameEvent[] }

/** Missing and stale records read as empty (spec 16 C1). */
export function attritionOf(state: GameState, record?: AttritionRecord): AttritionRecord {
  return record?.turn === turnKey(state) ? record : { turn: turnKey(state), done: [], run: null, used: [] };
}

/** Only the current Player Turn uses units (spec 16 R2/R7, AER8). */
export function attritionUsed(state: GameState, record?: AttritionRecord): string[] {
  return ATTRITION_USES_UNITS ? [...new Set(attritionOf(state, record).used)] : [];
}

/** Validate before drawing a die; caller supplies a nonempty subset (spec 16 R1/R2/R8). */
export function attritionRollProblem(ctx: GameContext, state: GameState, record: AttritionRecord | undefined, front: Front, ids: readonly string[]): string | null {
  const rec = attritionOf(state, record);
  if (rec.run) return "Finish the current Attrition run first.";
  if (ATTRITION_ONCE_PER_FRONT && rec.done.includes(front)) return "This Front has already resolved Attrition this Player Turn.";
  if (frontOptionOf(state, front) !== "attrition") return "This Front needs the Attrition Option.";
  const eligible = attritionParticipants(ctx, state, front, attritionUsed(state, rec)).units;
  if (!ids.length || new Set(ids).size !== ids.length || ids.some((id) => !eligible.some((u) => u.id === id))) return "Choose distinct eligible Attrition participants.";
  if (eligible.filter((u) => ids.includes(u.id)).reduce((sum, u) => sum + u.strength, 0) <= 0) return "Attrition requires positive factors.";
  return null;
}

/** Pure seeded resolution; no step/action integration (Ref 12.4; spec 16 R2/R3/R4/R8/R9). */
export function rollAttrition(ctx: GameContext, state: GameState, record: AttritionRecord | undefined, front: Front, ids: readonly string[]): AttritionResult {
  const problem = attritionRollProblem(ctx, state, record, front, ids);
  if (problem) throw new Error(problem);
  const rec = attritionOf(state, record);
  const participants = attritionParticipants(ctx, state, front, attritionUsed(state, rec)).units.filter((u) => ids.includes(u.id));
  const factors = participants.reduce((sum, u) => sum + u.strength, 0);
  const result = resolveAttrition(factors, state.rngState);
  const against = [...new Set(participants.flatMap((u) => neighborIds(ctx, u.at)
    .filter((to) => ctx.map.hexes[to]?.front === front && crossable(ctx, u.at, to))
    .flatMap((to) => defendersAt(state, [u], to).map((enemy) => enemy.owner))))].sort();
  const run: AttritionRun = { front, factors, column: attritionColumn(factors)!, roll: result.roll!, mustLose: result.units, hexesLeft: result.hexes,
    participants: participants.map((u) => u.id), against, stage: "losses", chooser: otherSide(state.activeSide), taken: [] };
  // R4/AER5: no eligible losses means proceed immediately; R5: no hex allowance finishes the run.
  if (!run.mustLose || !lossCandidates(ctx, state, front, participants).length) { run.stage = "hex"; run.chooser = state.activeSide; }
  return { state: { ...state, rngState: result.rngState }, record: { ...rec, done: [...rec.done, front],
    used: [...new Set([...rec.used, ...run.participants])], run: run.stage === "hex" && !run.hexesLeft ? null : run },
  events: [{ type: "ATTRITION_RESOLVED", front, side: state.activeSide, factors, column: run.column, roll: run.roll, mustLose: run.mustLose, hexesLeft: run.hexesLeft, against }] };
}

/** Defender chooses whole units; routing is shared with combat losses (Ref 12.4; spec 16 R4/C4). */
export function attritionChoiceProblem(ctx: GameContext, state: GameState, record: AttritionRecord | undefined, side: Side, ids: readonly string[]): string | null {
  const run = attritionOf(state, record).run;
  if (!run || run.stage !== "losses") return "No Attrition losses are waiting.";
  if (side !== run.chooser) return "The defending side must choose its losses.";
  return attritionLossProblem(ctx, state, run.front, run.participants.flatMap((id) => state.units[id] ? [state.units[id]] : []), run.mustLose, ids);
}

export function chooseAttritionLosses(ctx: GameContext, state: GameState, record: AttritionRecord | undefined, side: Side, ids: readonly string[]): AttritionResult {
  const problem = attritionChoiceProblem(ctx, state, record, side, ids);
  if (problem) throw new Error(problem);
  const rec = attritionOf(state, record);
  const run = rec.run!;
  const losses = eliminateUnits(state, ids); // spec 16 R4; spec 17 R1/R4: return to the owner's pool where eligible.
  // R8, AER9: a run with no hex allowance closes here, and its Front is done.
  return { state: losses.state, record: run.hexesLeft ? { ...rec, run: { ...run, stage: "hex", chooser: state.activeSide } } : closeAttritionRun(rec),
    events: [{ type: "ATTRITION_LOSSES_CHOSEN", units: [...ids] }, ...losses.events] };
}

/** Close at a hex boundary when the allowance or current choices run out (spec 16 R5/R8, C8; AER11).
 * Exported for the later caller after losses; no action wiring here.
 */
export function finishAttritionHexStage(ctx: GameContext, state: GameState, record: AttritionRecord): AttritionRecord {
  const run = record.run;
  if (!run || run.stage !== "hex") return record;
  const participants = run.participants.flatMap((id) => state.units[id] ? [state.units[id]] : []);
  if (run.hexesLeft > 0 && [...selectableHexes(ctx, state, run.front, participants).values()].some((p) => p === null)) return record;
  return closeAttritionRun(record);
}

/** Completing or declining a run resolves its Front (spec 16 R8; AER9). */
export function closeAttritionRun(record: AttritionRecord): AttritionRecord {
  const front = record.run?.front;
  return { ...record, run: null, done: ATTRITION_ONCE_PER_FRONT && front ? [...new Set([...record.done, front])] : record.done };
}
