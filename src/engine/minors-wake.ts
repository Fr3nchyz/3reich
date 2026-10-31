import { charge } from "./brps";
import type { GameContext } from "./context";
import { sideInWar, CONTROL_CHANGING_TYPES } from "./control";
import { turnIndex } from "./game";
import { sleepingAlly } from "./minors-axis";
import { AXIS_MINOR_ALLIES, AXIS_MINOR_ALLY_WAKE_TURN, minorValue } from "./minors-rules";
import type { GameState, MinorCountry } from "./types";
import { atWar } from "./war";

/** TODO(verify) MC9, spec 15 R9: wake at Axis step 2 or later. Off: any Axis step. */
export const MC9_WAKE_AT_STEP_2 = true;
/** TODO(verify) MC9, spec 15 R9: credit the value immediately. Off: report it only. */
export const MC9_VALUE_ADDED_AT_ONCE = true;
/** TODO(verify) MC9, spec 15 R9: German ground entry into an Allied-attacked ally wakes it. Off: no early wake. */
export const MC9_INTERVENTION_WAKES = true;

/** True at the Axis Player Turn of Summer 1941 or any later Axis turn, at step "2" or after. */
export function wakeDateReached(state: GameState): boolean {
  // spec 15 R9 / MC9: Allied turns and positions outside a Player Turn cannot activate allies.
  return state.activeSide === "axis" && state.position?.part === "player-turn"
    && turnIndex(state) >= turnIndex(AXIS_MINOR_ALLY_WAKE_TURN)
    && (!MC9_WAKE_AT_STEP_2 || Number.parseInt(state.position.step, 10) >= 2);
}

/** spec 15 R9: only the four still-sleeping allies are due on the automatic date. */
export function allyDueToWake(ctx: GameContext, state: GameState): MinorCountry[] {
  void ctx;
  return wakeDateReached(state) ? AXIS_MINOR_ALLIES.filter((c) => sleepingAlly(state, c)).sort() : [];
}

export interface Woken { state: GameState; woken: MinorCountry[]; brps: number }

/** Wakes `countries` (each must satisfy sleepingAlly, else it is skipped). New state, no mutation. */
export function wakeAllies(ctx: GameContext, state: GameState, countries: readonly MinorCountry[]): Woken {
  void ctx;
  // spec 15 R9: conquered, Axis-attacked and already active allies are excluded, including duplicate requests.
  const woken = [...new Set(countries)].filter((c) => sleepingAlly(state, c)).sort();
  // GameState is JSON-serializable; detach all nested objects as well as the changed records.
  let next = JSON.parse(JSON.stringify(state)) as GameState;
  let brps = 0;
  for (const country of woken) {
    const ally = next.minorAllies.find((m) => m.owner === country)!;
    ally.active = true;
    // spec 15 R9 / Ref 17.3: inherit the Major Power's enemies without a declaration or price.
    const enemies = state.wars.flatMap(([a, b]) => a === ally.of ? [b] : b === ally.of ? [a] : []);
    for (const enemy of enemies) {
      if (enemy !== country && !atWar(next, country, enemy)) next.wars.push([country, enemy]);
    }
    // spec 15 R9 / MC9: unknown or blank values contribute zero; the German total receives the value now.
    brps += minorValue(country) ?? 0;
  }
  if (MC9_VALUE_ADDED_AT_ONCE && brps !== 0) next = charge(next, "germany", -brps, "Minor-Allies wake (spec 15 R9)").state;
  return { state: next, woken, brps };
}

/** Early wake by Intervention: the ally attacked by an Allied power, and Germany has units inside it. */
export function interventionWake(ctx: GameContext, state: GameState): MinorCountry[] {
  if (!MC9_INTERVENTION_WAKES) return [];
  // spec 15 R9 / MC9: an Allied attack alone does not wake an ally; German ground presence is required.
  return AXIS_MINOR_ALLIES.filter((country) => {
    if (!sleepingAlly(state, country)) return false;
    const attacker = state.countries?.[country]?.attacker;
    return attacker !== undefined && sideInWar(state, attacker) === "allies"
      && Object.values(state.units).some((u) => u.owner === "germany" && CONTROL_CHANGING_TYPES.includes(u.type)
        && ctx.map.hexes[u.at]?.land && ctx.map.hexes[u.at]?.country === country);
  }).sort();
}
