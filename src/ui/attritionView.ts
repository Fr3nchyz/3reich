import { legalActions, type Action } from "../engine/actions";
import { isGroundCombatUnit } from "../engine/attack-rules";
import { attritionHexProblem, lossCandidates, occupiersOf } from "../engine/attrition";
import { attritionChoiceProblem, attritionOf, attritionRollProblem } from "../engine/attrition-record";
import { occupyAttritionHexProblem, selectAttritionHexProblem } from "../engine/attrition-action";
import { attritionColumn, ATTRITION_TABLE } from "../engine/combat";
import type { GameContext } from "../engine/context";
import { otherSide } from "../engine/game";
import type { Front } from "../engine/map";
import { overstacks } from "../engine/stacking";
import type { GameState, Side, Unit } from "../engine/types";
import { chooseAttritionLosses, chooseRetreat } from "../ai/attrition";
import { plural } from "./attackText";
import { cap } from "./format";
import { placeName, unitName, unitsWithIds } from "./names";

/** Plain data only (spec 16 D2, R2–R8). Selection belongs to the caller; no state is written. */
export interface AttritionChip {
  id: string;
  name: string;
  from: string;
  factors: number;
  chosen: boolean;
  note: string;
  destinations: string[];
}
export interface AttritionButton { text: string; action: Action | null; disabled: boolean }
export interface AttritionSelection {
  front?: Front;
  /** Undefined selects the defaults; an empty list deliberately selects nothing. */
  units?: readonly string[];
  hex?: string;
  unit?: string;
}
const button = (text: string, action: Action | null): AttritionButton => ({ text, action, disabled: action === null });
const chips = (ctx: GameContext, units: Unit[], chosen: readonly string[]): AttritionChip[] => units.map((u) => ({
  id: u.id, name: unitName(u), from: placeName(ctx.map, u.at), factors: u.strength, chosen: chosen.includes(u.id), note: "", destinations: [],
}));

/** R3/D2: six table rows, with no roll and no RNG consumption. Zero factors has no column. */
export function attritionResults(factors: number) {
  const column = attritionColumn(factors);
  return column === null ? [] : ATTRITION_TABLE[column].map(([units, hexes], i) => ({
    roll: i + 1, units, hexes, text: `Roll ${i + 1}: they lose ${plural(units, "unit")} and give up ${plural(hexes, "hex", "hexes")}.`,
  }));
}

/** R5/D2: reasons come from the same current-position query as engine selection. */
export function attritionHexTap(ctx: GameContext, state: GameState, hex: string) {
  const run = attritionOf(state, state.attrition).run;
  if (!run || run.stage !== "hex") return null;
  const participants = unitsWithIds(state, run.participants);
  const reason = attritionHexProblem(ctx, state, run.front, hex, participants);
  const valid = selectAttritionHexProblem(ctx, state, state.attrition, state.activeSide, hex) === null;
  const defenders = Object.values(state.units).filter((u) => u.at === hex && isGroundCombatUnit(u));
  return { hex, name: placeName(ctx.map, hex), reason, defenders: defenders.map((u) => u.id),
    occupiers: chips(ctx, occupiersOf(ctx, state, hex, participants), []),
    text: `Take ${placeName(ctx.map, hex)}? The defenders there must retreat.`,
    confirm: button("Take this hex", valid ? { type: "SELECT_ATTRITION_HEX", side: state.activeSide, hex } : null) };
}

/** R2–R8/D2/Q4: cards for either chooser, read-only while another side acts. */
export function attritionModel(ctx: GameContext, state: GameState, humanSide: Side, selection: AttritionSelection = {}) {
  const step = state.position?.part === "player-turn" ? state.position.step : null;
  if (step !== "7a" && step !== "7p") return null;
  const actions = legalActions(ctx, state);
  const rec = attritionOf(state, state.attrition);
  const run = rec.run;
  const chooser = run?.chooser ?? state.activeSide;
  const readOnly = chooser !== humanSide;
  const first = <T extends Action["type"]>(type: T) => actions.find((a): a is Extract<Action, { type: T }> => a.type === type);
  const allowed = (a: Action | undefined) => readOnly ? null : a ?? null;
  const moveOn = first("END_STEP");
  // R8/D2: each unresolved Front gets its own card; leaving units out changes the column.
  const fronts = actions.flatMap((a) => {
    if (a.type !== "RESOLVE_ATTRITION") return [];
    const eligible = unitsWithIds(state, a.units ?? []);
    const chosen = selection.front === a.front && selection.units !== undefined ? selection.units : eligible.map((u) => u.id);
    const factors = eligible.filter((u) => chosen.includes(u.id)).reduce((n, u) => n + u.strength, 0);
    const valid = attritionRollProblem(ctx, state, state.attrition, a.front, chosen) === null;
    return [{ front: a.front, heading: step === "7a" ? `Attrition on the ${cap(a.front)} Front` : "Attrition (you did not resolve it earlier)",
      factors, count: eligible.filter((u) => chosen.includes(u.id)).length, column: attritionColumn(factors), results: attritionResults(factors),
      chips: chips(ctx, eligible, chosen).map((c) => ({ ...c, note: c.chosen ? "Counts" : "Left out" })),
      confirm: button(step === "7a" ? "Resolve Attrition now" : "Resolve", allowed(valid ? { ...a, units: [...chosen] } : undefined)) }];
  });
  const participants = unitsWithIds(state, run?.participants ?? []);
  let heading = "Attrition";
  let unitChips: AttritionChip[] = [];
  let confirm = button("Confirm", null);
  let chooseForMe = button("Choose for me", null);
  if (run?.stage === "losses") {
    // R4/Q4: candidate count caps the required losses; hand-picked sets use the engine validator.
    const candidates = lossCandidates(ctx, state, run.front, participants);
    const defaults = chooseAttritionLosses(ctx, state, run.front, run.mustLose, participants);
    const chosen = selection.units ?? defaults;
    heading = `Choose ${plural(Math.min(run.mustLose, candidates.length), "unit")} to lose. Replacements are cheapest.`;
    unitChips = chips(ctx, candidates, chosen);
    const a: Action = { type: "CHOOSE_ATTRITION_LOSSES", side: chooser, units: [...chosen] };
    confirm = button("Confirm losses", allowed(first("CHOOSE_ATTRITION_LOSSES") && attritionChoiceProblem(ctx, state, state.attrition, chooser, chosen) === null ? a : undefined));
    chooseForMe = button("Choose for me", allowed(first("CHOOSE_ATTRITION_LOSSES") ? { ...a, units: defaults } : undefined));
  } else if (run?.stage === "hex") {
    heading = `Take a hex (${run.hexesLeft} left)`;
    confirm = button("No more hexes", allowed(first("END_ATTRITION")));
  } else if (run?.stage === "retreat") {
    // R6/Q4: one legal retreat at a time; recompute the chooser after each engine action.
    heading = `Retreat from ${placeName(ctx.map, run.target!)}`;
    unitChips = chips(ctx, unitsWithIds(state, run.retreating ?? []), selection.unit ? [selection.unit] : []);
    for (const c of unitChips) {
      c.destinations = actions.flatMap((a) => a.type === "RETREAT_UNIT" && a.unit === c.id ? [a.to] : []);
      c.note = c.destinations.length ? "" : "eliminated: nowhere to go";
    }
    const id = selection.unit ?? unitChips[0]?.id;
    const to = id ? chooseRetreat(ctx, state, id) : null;
    chooseForMe = button("Choose for me", allowed(actions.find((a) => a.type === "RETREAT_UNIT" && a.unit === id && a.to === to)));
    confirm = button("Retreat", allowed(actions.find((a) => a.type === "RETREAT_UNIT" && a.unit === id && a.to === selection.hex)));
  } else if (run?.stage === "occupy") {
    // R7/D2: default to the strongest eligible single unit; the engine checks every custom set.
    heading = `Move into ${placeName(ctx.map, run.target!)}`;
    const eligible = occupiersOf(ctx, state, run.target!, participants);
    const strongest = [...eligible].sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    const chosen = selection.units ?? (strongest ? [strongest.id] : []);
    unitChips = chips(ctx, eligible, chosen);
    confirm = button("Move in", allowed(first("OCCUPY_ATTRITION_HEX") && occupyAttritionHexProblem(ctx, state, state.attrition, chooser, chosen) === null
      ? { type: "OCCUPY_ATTRITION_HEX", side: chooser, units: [...chosen] } : undefined));
  }
  // R6/D2: defer overstack repair to Movement; reuse engine detection rather than assume a two-unit limit.
  const overstack = overstacks(ctx, state).filter((o) => o.kind === "ground").map((o) => ({ hex: o.hex, units: o.unitIds,
    text: `${placeName(ctx.map, o.hex)}: overstacked; fix before the end of your Movement Phase.` }));
  const tapped = selection.hex && run?.stage === "hex" ? attritionHexTap(ctx, state, selection.hex) : null;
  if (tapped && readOnly) tapped.confirm = button("Take this hex", null);
  return { stage: run?.stage ?? "resolve", chooser, readOnly, heading, fronts, chips: unitChips, confirm, chooseForMe,
    waiting: readOnly ? `The computer is choosing ${run?.stage === "losses" ? "its losses" : "its Attrition action"}...` : null,
    result: run ? `Die: ${run.roll}. The ${otherSide(state.activeSide) === "allies" ? "Allies" : "Axis"} lose ${plural(run.mustLose, "unit")} and must give up ${plural(ATTRITION_TABLE[run.column][run.roll - 1]![1], "hex", "hexes")}.` : null,
    targets: actions.flatMap((a) => a.type === "SELECT_ATTRITION_HEX" ? [a.hex] : []), tapped, overstack,
    moveOn: button(step === "7a" ? "After the battles" : "Skip", allowed(moveOn)) };
}
