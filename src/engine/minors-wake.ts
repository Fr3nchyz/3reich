import type { GameEvent } from "./action-types";
import { turnIndex } from "./game";
import { AXIS_MINOR_ALLIES } from "./minors-ids";
import { sleepingAlly } from "./minors-axis";
import { AXIS_MINOR_ALLY_WAKE_TURN, minorValue } from "./minors-rules";
import type { GameState, MinorCountry } from "./types";

/**
 * Spec 15 R9 (Ref 17.0 to 17.3, 9.2; Ops 5.41a): the four Axis Minor-Allies wake up. At step 2 of the Axis Player Turn of Summer 1941 every sleeping ally wakes at once, or
 * earlier when an Allied power has declared on one, has a unit inside, and a German unit then enters (the Intervention). A woken ally is at war with the enemies of Germany with no
 * declaration price, its value joins the German BRP total at once, and its army is set up by the Axis (spec 15 R3) unless the Allied declaration already called one up. Pure functions.
 */

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
 * Wakes one sleeping ally: marks it active, adds its value to the total of its Major Power, and (if no Allied declaration called its army up) asks the Axis to set the army up
 * at step 2. Returns the state unchanged for a country that is not a sleeping ally.
 */
export function wakeAlly(state: GameState, country: MinorCountry, cause: WakeCause): { state: GameState; events: GameEvent[] } {
  const entry = state.minorAllies.find((m) => m.owner === country);
  if (!sleepingAlly(state, country) || !entry) return { state, events: [] };
  const value = minorValue(country) ?? 0;
  const nation = state.nations[entry.of];
  const brpTotal = nation.brpTotal + value;
  const record = state.countries?.[country];
  const place = state.countries !== undefined && (record === undefined || record.status === "neutral");
  const next: GameState = {
    ...state,
    minorAllies: state.minorAllies.map((m) => (m.owner === country ? { ...m, active: true } : m)),
    nations: { ...state.nations, [entry.of]: { ...nation, brpTotal, ...(MC28_WAKE_VALUE_RAISES_SPEND_LIMIT ? { spendLimit: Math.floor(brpTotal / 2) } : {}) } },
    ...(place ? { countries: { ...state.countries, [country]: { ...(record ?? { status: "neutral" as const }), toPlace: "axis" as const } } } : {}),
  };
  return {
    state: next,
    events: [
      { type: "MINOR_ALLY_WOKE", minor: country, of: entry.of, value, cause, toPlace: place },
      { type: "BRPS_CHANGED", nation: entry.of, delta: value, total: brpTotal, reason: `${country} wakes as an ally of ${entry.of} (Ref 17.0, 9.2)` },
    ],
  };
}

/** Whether the wake-up turn has come: the Axis Player Turn of Summer 1941 or any later one (spec 15 MC9; the Allied turn of that Game Turn still finds the allies asleep). */
export const wakeTurnReached = (state: GameState): boolean =>
  state.activeSide === AXIS_MINOR_ALLY_WAKE_TURN.side && turnIndex(state) >= turnIndex({ year: AXIS_MINOR_ALLY_WAKE_TURN.year, season: AXIS_MINOR_ALLY_WAKE_TURN.season });

/** Leaving step 1 of an Axis Player Turn: every sleeping ally wakes once the wake-up turn has come (R9, MC9). */
export function wakeSleepers(state: GameState): { state: GameState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  if (!wakeTurnReached(state)) return { state, events };
  for (const country of AXIS_MINOR_ALLIES) {
    if (!MC29_ATTACKED_SLEEPER_WAKES_IN_1941 && next.countries?.[country]?.status === "attacked") continue;
    const woke = wakeAlly(next, country, "summer-1941");
    next = woke.state;
    events.push(...woke.events);
  }
  return { state: next, events };
}
