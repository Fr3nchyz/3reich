import type { Action, GameEvent, IncomeLine } from "../engine/action-types";
import type { GameContext } from "../engine/context";
import { conquestRecipient } from "../engine/conquest-income";
import { MC24_REVOKED_BRPS_LOST } from "../engine/minors-duty";
import type { CountryId } from "../engine/minors-record";
import { capitalOf, MINOR_COUNTRIES, minorValue } from "../engine/minors-rules";
import { combatantName, POWER_NAMES, isGone } from "../engine/nations";
import { sideOfOwner } from "../engine/setup";
import type { GameState, MinorCountry, PowerId, Side } from "../engine/types";
import { runYearStartSequence } from "../engine/yearstart";

const countryName = (id: CountryId): string => combatantName(id);

export interface DutyChip { country: CountryId; by: PowerId; text: string; tone: "danger" }

/** Spec 15 R4 / D1/D3: an open duty persists until the engine clears it; old saves have none. */
export function dutyChips(state: GameState, side: Side): DutyChip[] {
  return (Object.keys(state.countries ?? {}).sort() as CountryId[]).flatMap((country) => {
    const duty = state.countries?.[country]?.duty;
    return duty && sideOfOwner(duty.by) === side
      ? [{ country, by: duty.by, text: `${countryName(country)}: enter or attack this turn`, tone: "danger" as const }]
      : [];
  });
}

/** Spec 15 R4 / D3 / Q5: screen confirmation at 7h, independent of the later engine check at 7p. */
export function dutyWarning(state: GameState, action: Action) {
  if (state.phase !== "player-turn" || state.position?.part !== "player-turn" || state.position.step !== "7h"
    || action.type !== "END_STEP" || action.step !== "7h" || action.side !== state.activeSide) return null;
  const duties = dutyChips(state, action.side);
  if (duties.length === 0) return null;
  return {
    title: "End combat?",
    lines: duties.map((d) => `You have not entered or attacked ${countryName(d.country)}. If you end combat now the declaration is cancelled and you lose the ${MC24_REVOKED_BRPS_LOST} BRPs.`),
    countries: duties.map((d) => d.country),
    back: { text: "Go back" }, confirm: { text: "End combat", action },
  };
}

/** Spec 15 R6 / D3: use the engine's entry result for a move preview or the completed move's events. */
export function interventionCards(events: readonly GameEvent[]) {
  return events.flatMap((event) => event.type === "MINOR_INTERVENED" ? [{
    country: event.minor, by: event.by,
    text: `Moving here helps ${countryName(event.minor)}. ${POWER_NAMES[event.by]} will fight beside it (Intervention).`,
    log: `${POWER_NAMES[event.by]} intervenes in ${countryName(event.minor)}`,
  }] : []);
}

/** Spec 15 R9 / D5: actual wake events supply countries, recipient, value and placement, including partial wakes. */
export function wakeCards(events: readonly GameEvent[]) {
  const wakes = events.filter((e) => e.type === "MINOR_ALLY_WOKE");
  return [...new Set(wakes.map((e) => e.of))].map((of) => {
    const group = wakes.filter((e) => e.of === of);
    const countries = group.map((e) => e.minor);
    const value = group.reduce((sum, e) => sum + e.value, 0);
    const toPlace = group.filter((e) => e.toPlace).map((e) => e.minor);
    return { of, countries, value, toPlace, text: `${countries.map(countryName).join(", ")} join ${POWER_NAMES[of]}. ${POWER_NAMES[of]} gains ${value} BRPs.${toPlace.length ? " Place their armies." : ""}`,
      buttons: toPlace.length ? [{ text: "Place automatically" }] : [] };
  });
}

/** Spec 15 R7/R13 / D4: only a minor adds this capital-dependent sentence to spec 14's conquest card. */
export function minorConquestLine(ctx: GameContext, state: GameState, event: GameEvent) {
  if (event.type !== "COUNTRY_CONQUERED" || !MINOR_COUNTRIES.includes(event.country as MinorCountry)) return null;
  const capital = capitalOf(ctx, event.country);
  const value = minorValue(event.country);
  if (capital === null || value === null || value === undefined) return null;
  const by = conquestRecipient(state, event.by);
  const place = ctx.map.hexes[capital]?.name?.trim() || capital;
  return { country: event.country, by, value, capital,
    text: `${POWER_NAMES[by]} gains ${value} BRPs at each year start while it keeps ${place}.` };
}

export interface NextYearStartCard {
  nation: PowerId; title: "Next year start"; base: number; growth: number; total: number;
  lines: IncomeLine[]; why: "Why?";
}

/** Spec 15 R13 / D6: project the next YSS, including this year's completed conquests and spec 14's lines.
 * Reuse the engine's growth, deficit, capital and income rules; this is an estimate from current holdings and cash.
 */
export function nextYearStartCards(ctx: GameContext, state: GameState): NextYearStartCard[] {
  const projected = runYearStartSequence(ctx, { ...state, year: state.year + 1 });
  return Object.values(state.nations).filter((n) => !isGone(n)).map((n) => {
    const next = projected.state.nations[n.id];
    const income = projected.events.find((e) => e.type === "COUNTRY_INCOME" && e.nation === n.id);
    return { nation: n.id, title: "Next year start", base: next.brpBase, growth: next.brpBase - n.brpBase,
      total: next.brpTotal, lines: income?.type === "COUNTRY_INCOME" ? income.lines : [], why: "Why?" };
  });
}
