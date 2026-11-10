import type { Action, ActionResult } from "./action-types";
import { groundSupportTargets } from "./air-missions";
import { defensiveAirProblem, defensiveAirUnits, defensiveGroundFactors, DAS_CAP_MULTIPLE } from "./air-defense";
import { airOf, markFlown } from "./air-record";
import type { GameContext } from "./context";
import type { GameState, Side } from "./types";

/** TODO(verify) AER76: opt-in Player Turn gate; no computer policy creates this flag. */
export const DAS_MANUAL_DEFAULT = false;
/** TODO(verify) AER77: potential targets follow R10 option (a); future drops/invasions add threats. */
export const DAS_TARGETS = groundSupportTargets;
/** TODO(verify) AER78: whole counters within the basic-ground cap, like GS (spec 09 C4). */
export const DAS_COMMIT_CAP_MULTIPLE = DAS_CAP_MULTIPLE;
export const dasSide = (state: GameState): Side => state.activeSide === "axis" ? "allies" : "axis";
export const dasOf = (state: GameState) => airOf(state).das ?? {};
export const setManualDas = (state: GameState, enabled: boolean): GameState => ({ ...state, air: { ...airOf(state), manualDas: enabled } });
export const manualDas = (state: GameState): boolean => airOf(state).manualDas ?? DAS_MANUAL_DEFAULT;

/** Ref 20.51 / AER78: units that fit the cap count and share losses; bases do not change. */
export function countedDas(state: GameState, target: string, ground: number) {
  const units = [];
  let factors = 0;
  for (const id of (Object.hasOwn(dasOf(state), target) ? dasOf(state)[target]! : [])) {
    const u = state.units[id];
    if (!u || u.type !== "air" || factors + u.strength > DAS_CAP_MULTIPLE * ground) continue;
    units.push(u);
    factors += u.strength;
  }
  return { units, factors };
}

/** Ref 20.51; AER76/AER77: only useful designations at 7d, ordered by target then plane id. */
export function legalDas(ctx: GameContext, state: GameState): Action[] {
  if (!manualDas(state) || state.phase !== "player-turn" || state.position?.part !== "player-turn" || state.position.step !== "7d") return [];
  const potentialTargets = [...DAS_TARGETS(ctx, state).keys()];
  const input = { potentialTargets, counterAirUnavailable: [] };
  return potentialTargets.sort().flatMap((hex): Action[] => {
    let factors = countedDas(state, hex, defensiveGroundFactors(state, hex)).factors;
    const units = defensiveAirUnits(ctx, state, input, hex).filter((id) => {
      const strength = state.units[id]!.strength;
      if (factors + strength > DAS_COMMIT_CAP_MULTIPLE * defensiveGroundFactors(state, hex)) return false;
      factors += strength;
      return true;
    });
    return units.length ? [{ type: "DESIGNATE_DAS", side: dasSide(state), units, hex }] : [];
  });
}

/** Ref 20.51, 20.3 / AER62: validate atomically, then consume the Game Turn mission. */
export function applyDas(ctx: GameContext, state: GameState, action: Extract<Action, { type: "DESIGNATE_DAS" }>): ActionResult {
  if (!manualDas(state)) return { ok: false, error: "Manual defensive air support is not enabled (AER76)." };
  if (action.side !== dasSide(state)) return { ok: false, error: "Only the Non-Phasing side designates DAS." };
  if (typeof action.hex !== "string" || !Object.hasOwn(ctx.map.hexes, action.hex)) return { ok: false, error: "DAS needs a target on the map." };
  if (!Array.isArray(action.units) || action.units.length === 0 || action.units.length > 100 ||
    Array.from(action.units).some((id) => typeof id !== "string" || !Object.hasOwn(state.units, id)) || new Set(action.units).size !== action.units.length) return { ok: false, error: "DAS names distinct air units on the map." };
  // Counter-air aborts already consume the shared flown ledger (09-9b; Ref 20.44).
  const input = { potentialTargets: [...DAS_TARGETS(ctx, state).keys()], counterAirUnavailable: [] };
  for (const id of action.units) {
    const error = defensiveAirProblem(ctx, state, input, id, action.hex);
    if (error) return { ok: false, error };
  }
  const rec = airOf(state);
  const previous = Object.hasOwn(dasOf(state), action.hex) ? dasOf(state)[action.hex]! : [];
  const ids = [...previous, ...action.units];
  if (ids.reduce((n, id) => n + state.units[id]!.strength, 0) > DAS_COMMIT_CAP_MULTIPLE * defensiveGroundFactors(state, action.hex)) return { ok: false, error: "DAS exceeds three times basic defending ground factors (AER78)." };
  const flown = markFlown(state, action.units, "das");
  return { ok: true, state: { ...flown, air: { ...rec, das: { ...dasOf(state), [action.hex]: ids } } },
    events: [{ type: "DAS_COMMITTED", side: action.side, hex: action.hex, units: [...action.units] }] };
}

/** Spec 09 C4: clear only the fought target; unused missions remain flown until the Game Turn ends. */
export function clearDas(state: GameState, target: string): GameState {
  if (!Object.hasOwn(dasOf(state), target)) return state;
  const { [target]: _gone, ...das } = dasOf(state);
  return { ...state, air: { ...airOf(state), das } };
}
