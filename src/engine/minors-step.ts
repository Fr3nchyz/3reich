import type { Action, ActionResult, GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { MINOR_COUNTRIES } from "./minors-ids";
import { applyMinorPlacement, pending, suggestMinorPlacement } from "./minors-place";
import type { GameState, MinorCountry, Side } from "./types";

/**
 * Step 2 of the Player Turn: the army of a newly attacked minor country is set up (spec 15 R3, C2, C5; Ref 14.0, Ops 5.41a). The side that did not declare places it,
 * so the step is the second place where the non-active side acts (`sideToAct`, actor.ts). The pure placement rules are in minors-place.ts.
 *
 * TODO(verify) MC23: a pending army for which no legal placement exists (no room, no base) cannot be asked for, so the step is passed and `toPlace` stays set. The manual
 * does not say what then happens; the map has room for every chart row, so this is a guard against a stalled game, not a rule.
 */
export const MC23_UNPLACEABLE_ARMY_PASSES = true;

/** The country whose army is set up next: the first in the fixed country order with `toPlace` set (spec 15 C1). Null when none waits. */
export function firstPendingMinor(state: GameState): MinorCountry | null {
  if (!state.countries) return null;
  return MINOR_COUNTRIES.find((c) => pending(state, c)) ?? null;
}

/** The side that sets the next army up, or null when none waits (spec 15 C5). */
export function placingSide(state: GameState): Side | null {
  const minor = firstPendingMinor(state);
  return minor ? state.countries?.[minor]?.toPlace ?? null : null;
}

/** Whether step 2 has an army to ask for (spec 15 C4.6: it waits only when a country has `toPlace`). */
export function hasMinorPlaceWork(ctx: GameContext, state: GameState): boolean {
  const minor = firstPendingMinor(state);
  return minor !== null && (!MC23_UNPLACEABLE_ARMY_PASSES || suggestMinorPlacement(ctx, state, minor) !== null);
}

/** Spec 15 C2: one PLACE_MINOR_FORCES for the next army, with R16's suggested placement; the human edits hexes through `legalMinorPlacements`. */
export function legalMinorPlaceActions(ctx: GameContext, state: GameState): Action[] {
  const minor = firstPendingMinor(state);
  const side = placingSide(state);
  const placements = minor ? suggestMinorPlacement(ctx, state, minor) : null;
  return minor && side && placements ? [{ type: "PLACE_MINOR_FORCES", side, minor, placements }] : [];
}

/** Spec 15 C2: the placing side sets up the next pending army, exactly as the chart says. */
export function applyPlaceMinorForces(ctx: GameContext, state: GameState, action: Extract<Action, { type: "PLACE_MINOR_FORCES" }>): ActionResult {
  const minor = firstPendingMinor(state);
  if (minor === null) return { ok: false, error: "No minor country's army is waiting to be set up." };
  if (action.minor !== minor) return { ok: false, error: `The army to set up now is ${minor}'s, not ${String(action.minor)}'s.` };
  const side = state.countries?.[minor]?.toPlace;
  if (action.side !== side) return { ok: false, error: `The ${side} side sets up the army of ${minor}, not ${String(action.side)}.` };
  if (!Array.isArray(action.placements)) return { ok: false, error: "A placement is a list of counters and hexes." };
  const placed = applyMinorPlacement(ctx, state, minor, action.placements);
  if (!placed.ok) return placed;
  const units = Object.keys(placed.state.units).filter((id) => !(id in state.units));
  const events: GameEvent[] = [{ type: "MINOR_FORCES_PLACED", minor, side: action.side, units }];
  return { ok: true, state: placed.state, events };
}
