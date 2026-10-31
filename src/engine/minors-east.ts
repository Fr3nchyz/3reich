import type { GameContext } from "./context";
import { isConquered } from "./conquest-record";
import type { HexId } from "./hex";
import { minorDeclarationProblem } from "./minors-declare";
import { MINOR_VALUES } from "./minors-rules";
import type { GameState, PowerId, Side } from "./types";

// Spec 15 R12, Ref 29.0: repository Eastern Europe zone; tests pin the map-derived partition.
export const EASTERN_EUROPE_HEXES: readonly HexId[] = [
  "E40", "E41", "E42", "F39", "F40", "F41", "G38", "G39", "G40", "G41",
  "H37", "H38", "H39", "H40", "H41", "I37", "I38", "I39", "I40", "J38",
  "J39", "J40", "K38", "K39", "L38", "M37", "N36", "N37", "O36", "P35",
  "Q35", "R35", "R36", "S36", "T36", "U36",
];
// Spec 15 R12, Ref 29.0: only the Polish portion is east of the Partition Line.
export const EASTERN_POLISH_HEXES: readonly HexId[] = [
  "J39", "J40", "K38", "K39", "L38", "M37", "N36", "N37", "O36", "P35", "Q35",
];
// Spec 15 R12, Ref 29.0: reuse the value table; Poland and Rumania keep their values.
export const EASTERN_EUROPE_VALUE = MINOR_VALUES["eastern-europe"];
/** TODO(verify) MC13, spec 15 R12: no chart row means no new army. */
export const MC13_EASTERN_EUROPE_ARMY = [] as const;
/** TODO(verify) MC13, spec 15 R12: explicit null overrides previous and starting control. */
export const MC13_EASTERN_EUROPE_CONTROLLER = null;
/** TODO(verify) MC13, spec 15 R12: remove the Polish counters immediately, without transfer or pool return. */
export const MC13_POLISH_REMOVAL_AT_CREATION = true;
/** TODO(verify) MC13, spec 15 R12: coalition queries use the two expressly dated declarers. */
export const MC13_SIDE_DECLARERS = { axis: "germany", allies: "ussr" } as const;

/** Spec 15 R12: pure end-of-Axis-Fall-1939 hook; the future turn caller owns scheduling.
 * German elimination remains the scenario rule's responsibility. No turn hook or event is added.
 */
export function createEasternEurope(state: GameState): GameState {
  if (state.countries?.["eastern-europe"]) return state;
  if (state.year !== 1939 || state.season !== "fall" || state.activeSide !== "axis") return state;
  const control = { ...state.control };
  for (const hex of EASTERN_EUROPE_HEXES) control[hex] = MC13_EASTERN_EUROPE_CONTROLLER;
  const units = { ...state.units };
  // Spec 15 R12 / Peele's errata: only while Poland is unconquered, only Polish counters east of the line.
  if (MC13_POLISH_REMOVAL_AT_CREATION && !isConquered(state, "poland")) {
    for (const unit of Object.values(units)) {
      if ((unit.nationality ?? unit.owner) === "poland" && EASTERN_POLISH_HEXES.includes(unit.at)) delete units[unit.id];
    }
  }
  return { ...state, control, units, countries: { ...state.countries, "eastern-europe": { status: "neutral" } } };
}

/** Spec 15 R12: political land membership, distinct from occupation/control. Unwired reader:
 * detached Polish and Rumanian land stays Eastern European even after conquest.
 */
export function easternEuropeCountryOf(ctx: GameContext, state: GameState, hex: HexId): string | undefined {
  if (state.countries?.["eastern-europe"] && EASTERN_EUROPE_HEXES.includes(hex)) return "eastern-europe";
  return ctx.map.hexes[hex]?.country;
}

/** Spec 15 R12: ordinary country declaration checks plus Germany's 1940 / Soviet Fall 1939 gates.
 * Power queries preserve individual eligibility; Side queries use MC13's named representatives.
 */
export function easternEuropeDeclarationProblem(ctx: GameContext, state: GameState, side: Side | PowerId): string | null {
  const by = side === "axis" || side === "allies" ? MC13_SIDE_DECLARERS[side] : side;
  if (by === "ussr" && state.year === 1939 && state.season === "fall" && state.activeSide !== "allies") return "The U.S.S.R. must wait until Allied Fall 1939.";
  return minorDeclarationProblem(ctx, state, by, "eastern-europe");
}
