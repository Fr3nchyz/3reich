import type { CountryRecord } from "./minors-record";
import type { GameState, PowerId } from "./types";

// Spec 15 R11: Persian hex ids from the repository map; tests pin this list to its country data.
export const PERSIAN_HEXES = [
  "AA45", "AA47", "AA53", "BB44", "BB45", "BB46", "BB47", "BB48", "BB52",
  "CC44", "CC45", "CC46", "DD44", "DD45", "DD46", "EE44", "EE45", "FF44", "FF45",
] as const;

/** TODO(verify) MC14, spec 15 R11: the paying Allied power holds the opened route. */
export const MC14_PERSIA_CONTROLLER = (by: PowerId): PowerId => by;

/** Spec 15 R11, Ref 24.0: the Lend-Lease caller handles payment and payer eligibility. */
export function openPersia(state: GameState, by: PowerId): GameState {
  if (state.countries?.persia?.opened) return state; // R11: opening the route is permanent and idempotent.
  const control = { ...state.control };
  // Spec 15 R11 / MC14: every Persian hex passes to the paying Allied power.
  for (const hex of PERSIAN_HEXES) control[hex] = MC14_PERSIA_CONTROLLER(by);
  const persia: CountryRecord = { ...state.countries?.persia, status: state.countries?.persia?.status ?? "neutral", opened: true };
  return { ...state, control, countries: { ...state.countries, persia } };
}
