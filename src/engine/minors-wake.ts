import type { GameEvent } from "./action-types";
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

/**
 * TODO(verify) MC28, spec 15 R9 (Ref 9.2): the value that joins the German total when an ally wakes also raises Germany's spending limit (half the total, as the Year Start Sequence
 * sets it). The text says the value is "added to the total" and says nothing of the limit. Off (conservative): only the total grows; the limit stays as it was.
 */
export const MC28_WAKE_VALUE_RAISES_SPEND_LIMIT = false;

/**
 * TODO(verify) MC29, spec 15 R9: a sleeping ally that an Allied power attacked and that Germany did not help still wakes on its own at Summer 1941 ("they wake automatically"), keeping
 * the army the declaration called up. Off: it stays asleep and fights on alone, as before.
 */
export const MC29_ATTACKED_SLEEPER_WAKES_IN_1941 = true;

export type WakeCause = "summer-1941" | "intervention";

/**
 * Ticket 15-8: `wakeAllies` (value, wars) plus what the game needs around it: a woken ally with no fighting record (none, or neutral after a revoked declaration) is asked for its army
 * (`toPlace: "axis"`, set up at step 2 by the Axis, R3); one the Allied declaration already called up keeps its army. Logs MINOR_ALLY_WOKE for each and one BRPS_CHANGED for the German total.
 */
export function wakeWithArmy(ctx: GameContext, state: GameState, countries: readonly MinorCountry[], cause: WakeCause): { state: GameState; events: GameEvent[] } {
  const r = wakeAllies(ctx, state, countries);
  if (r.woken.length === 0) return { state, events: [] };
  let next = r.state;
  const gain = next.nations.germany.brpTotal - state.nations.germany.brpTotal;
  if (MC28_WAKE_VALUE_RAISES_SPEND_LIMIT) next = { ...next, nations: { ...next.nations, germany: { ...next.nations.germany, spendLimit: Math.floor(next.nations.germany.brpTotal / 2) } } };
  const events: GameEvent[] = [];
  for (const country of r.woken) {
    const record = state.countries?.[country];
    const place = state.countries !== undefined && (record === undefined || record.status === "neutral");
    if (place) next = { ...next, countries: { ...next.countries, [country]: { ...(record ?? { status: "neutral" as const }), toPlace: "axis" as const } } };
    events.push({ type: "MINOR_ALLY_WOKE", minor: country, of: "germany", value: minorValue(country) ?? 0, cause, toPlace: place });
  }
  events.push({ type: "BRPS_CHANGED", nation: "germany", delta: gain, total: next.nations.germany.brpTotal, reason: `${r.woken.join(", ")} wake as allies of germany (Ref 17.0, 9.2)` });
  return { state: next, events };
}

/** Arriving at step 2 of an Axis Player Turn: every sleeping ally wakes once the date has come (`allyDueToWake`, MC9; MC29 for an ally the Allies attacked). */
export function wakeSleepers(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  const due = allyDueToWake(ctx, state).filter((c) => MC29_ATTACKED_SLEEPER_WAKES_IN_1941 || state.countries?.[c]?.status !== "attacked");
  return wakeWithArmy(ctx, state, due, "summer-1941");
}
