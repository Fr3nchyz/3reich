import type { Action, ActionResult } from "./action-types";
import { occupiersOf, attritionParticipants, lossCandidates, selectableHexes } from "./attrition";
import {
  attritionChoiceProblem, attritionOf, attritionRollProblem, attritionUsed, chooseAttritionLosses, finishAttritionHexStage, rollAttrition,
} from "./attrition-record";
import type { AttritionRecord, AttritionResult } from "./attrition-record";
import {
  endAttrition, endAttritionProblem, occupyAttritionHex, occupyAttritionHexProblem, retreatAttritionUnit, retreatAttritionUnitProblem,
  selectAttritionHex, selectAttritionHexProblem,
} from "./attrition-action";
import { combatOf } from "./combat-record";
import type { GameContext } from "./context";
import { FRONTS } from "./frontoptions";
import type { Front } from "./map";
import { retreatOptions } from "./retreat";
import type { GameState, Unit } from "./types";

/**
 * Steps 7a and 7p (spec 16 C3, C5, C8; Ops 5.46a, 5.46p): the six Attrition actions, routed to the pure handlers of attrition-record.ts and attrition-action.ts.
 * The steps wait while a Front has the Attrition Option and a participant and is not done, or while a run is in progress. The run keeps its own chooser
 * (`sideToAct`): the other side at "losses" and "retreat", the Phasing side at "hex" and "occupy".
 * TODO(verify, AER48): the units a run uses (its participants, and the units that occupy) are also written into `CombatRecord.attacked`, as spec 16 C1
 * says, so the ordinary attack at 7h cannot use them again.
 * TODO(verify, AER49): a run that waits at the "occupy" stage with no unit able to move in (it cannot happen at selection time, but the position can change by a retreat's capture) has no action; it is closed at once instead of stalling the step.
 */

/**
 * Actions whose listing is only a default or a few sets: the engine accepts any set that passes the rule's checks (spec 16 C3: "any valid set is accepted, as
 * `lossSetError` accepts any valid Exchange loss"). The self-play check "on the legal list" lets the computer's own set through for these, and the engine still
 * refuses it if it breaks a rule.
 */
export const OPEN_SET_ACTIONS: readonly Action["type"][] = ["CHOOSE_ATTRITION_LOSSES", "OCCUPY_ATTRITION_HEX"];

/** The steps that wait for these actions. */
export const ATTRITION_STEPS: readonly string[] = ["7a", "7p"];

const record = (state: GameState): AttritionRecord => attritionOf(state, state.attrition);
const unitsOf = (state: GameState, ids: readonly string[]): Unit[] => ids.flatMap((id) => (state.units[id] ? [state.units[id]] : []));

/** The run in progress, if any. */
export const attritionRun = (state: GameState) => record(state).run;

/** The Fronts the Phasing side may resolve now, each with all its participants. */
export function resolvableFronts(ctx: GameContext, state: GameState): { front: Front; units: string[] }[] {
  const rec = record(state);
  if (rec.run) return [];
  return FRONTS.flatMap((front) => {
    const units = attritionParticipants(ctx, state, front, attritionUsed(state, rec)).units.map((u) => u.id);
    return attritionRollProblem(ctx, state, rec, front, units) === null ? [{ front, units }] : [];
  });
}

/** Whether 7a or 7p has work: a run is in progress, or a Front can be resolved. */
export const hasAttritionWork = (ctx: GameContext, state: GameState): boolean => record(state).run !== null || resolvableFronts(ctx, state).length > 0;

/** The default loss set (spec 16 R4, Q4): Replacements first, then the weakest, then by id. */
export function defaultAttritionLosses(ctx: GameContext, state: GameState): string[] {
  const run = record(state).run!;
  const candidates = lossCandidates(ctx, state, run.front, unitsOf(state, run.participants));
  return candidates.sort((a, b) => Number(b.type === "replacement") - Number(a.type === "replacement") || a.strength - b.strength || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, run.mustLose).map((u) => u.id);
}

/** The legal Attrition actions at 7a or 7p (spec 16 C3): what the stage of the run, or the absence of one, allows. */
export function legalAttrition(ctx: GameContext, state: GameState): Action[] {
  const rec = record(state);
  const run = rec.run;
  const side = state.activeSide;
  if (!run) return resolvableFronts(ctx, state).map((f) => ({ type: "RESOLVE_ATTRITION", side, front: f.front, units: f.units }));
  const participants = unitsOf(state, run.participants);
  switch (run.stage) {
    case "losses":
      return [{ type: "CHOOSE_ATTRITION_LOSSES", side: run.chooser, units: defaultAttritionLosses(ctx, state) }];
    case "hex":
      return [...[...selectableHexes(ctx, state, run.front, participants)].filter(([, problem]) => problem === null)
        .map(([hex]): Action => ({ type: "SELECT_ATTRITION_HEX", side, hex })), { type: "END_ATTRITION", side }];
    case "retreat":
      return [...(run.retreating ?? [])].sort().flatMap((unit) => retreatOptions(ctx, state, unit).map((to): Action => ({ type: "RETREAT_UNIT", side: run.chooser, unit, to })));
    case "occupy": {
      const eligible = occupiersOf(ctx, state, run.target!, participants).map((u) => u.id);
      const sets = eligible.length > 1 ? [...eligible.map((id) => [id]), eligible] : eligible.map((id) => [id]);
      return sets.filter((units) => occupyAttritionHexProblem(ctx, state, rec, side, units) === null).map((units): Action => ({ type: "OCCUPY_ATTRITION_HEX", side, units }));
    }
  }
}

/** Keeps the record in the state, and the units a run used in the combat record, so they cannot attack at 7h (AER48). */
function store(state: GameState, rec: AttritionRecord): GameState {
  const next = { ...state, attrition: rec };
  const combat = combatOf(next);
  const missing = rec.used.filter((id) => !combat.attacked.includes(id));
  return missing.length === 0 ? next : { ...next, combat: { ...combat, attacked: [...combat.attacked, ...missing] } };
}

/** After any change a run in the "hex" stage with nothing left to select closes (C8); an "occupy" stage with no occupier closes too (AER49). */
function settleRun(ctx: GameContext, state: GameState, rec: AttritionRecord): AttritionRecord {
  const closed = finishAttritionHexStage(ctx, state, rec);
  const run = closed.run;
  if (run?.stage === "occupy" && occupiersOf(ctx, state, run.target!, unitsOf(state, run.participants)).length === 0) return { ...closed, run: null };
  return closed;
}

const stringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const done = (ctx: GameContext, state: GameState, r: AttritionResult): ActionResult => {
  const rec = settleRun(ctx, r.state, r.record);
  return { ok: true, state: store(r.state, rec), events: r.events };
};

/** Applies one Attrition action at 7a or 7p. Refuses, with the rule's reason, what the pure handlers refuse. */
export function applyAttrition(ctx: GameContext, state: GameState, action: Action): ActionResult {
  const rec = state.attrition;
  switch (action.type) {
    case "RESOLVE_ATTRITION": {
      if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${action.side}.` };
      const ids = action.units ?? attritionParticipants(ctx, state, action.front, attritionUsed(state, record(state))).units.map((u) => u.id);
      if (!stringList(ids)) return { ok: false, error: "RESOLVE_ATTRITION names its units as a list of ids." };
      const problem = attritionRollProblem(ctx, state, rec, action.front, ids);
      return problem ? { ok: false, error: problem } : done(ctx, state, rollAttrition(ctx, state, rec, action.front, ids));
    }
    case "CHOOSE_ATTRITION_LOSSES": {
      const problem = stringList(action.units) ? attritionChoiceProblem(ctx, state, rec, action.side, action.units) : "CHOOSE_ATTRITION_LOSSES names its units as a list of ids.";
      return problem ? { ok: false, error: problem } : done(ctx, state, chooseAttritionLosses(ctx, state, rec, action.side, action.units));
    }
    case "SELECT_ATTRITION_HEX": {
      const problem = selectAttritionHexProblem(ctx, state, rec, action.side, action.hex);
      return problem ? { ok: false, error: problem } : done(ctx, state, selectAttritionHex(ctx, state, rec, action.side, action.hex));
    }
    case "END_ATTRITION": {
      const problem = endAttritionProblem(ctx, state, rec, action.side);
      return problem ? { ok: false, error: problem } : done(ctx, state, endAttrition(ctx, state, rec, action.side));
    }
    case "RETREAT_UNIT": {
      const problem = retreatAttritionUnitProblem(ctx, state, rec, action.side, action.unit, action.to);
      return problem ? { ok: false, error: problem } : done(ctx, state, retreatAttritionUnit(ctx, state, rec, action.side, action.unit, action.to));
    }
    case "OCCUPY_ATTRITION_HEX": {
      const problem = stringList(action.units) ? occupyAttritionHexProblem(ctx, state, rec, action.side, action.units) : "OCCUPY_ATTRITION_HEX names its units as a list of ids.";
      return problem ? { ok: false, error: problem } : done(ctx, state, occupyAttritionHex(ctx, state, rec, action.side, action.units));
    }
    default:
      return { ok: false, error: `Not an Attrition action: ${action.type}` };
  }
}
