import type { GameEvent, IncomeLine } from "./action-types";
import { conquestIncome } from "./conquest-income";
import type { GameContext } from "./context";
import { territoryIncome } from "./minors-income";
import { isGone } from "./nations";
import { citiesNamedHeldByAxis, sovietCityIncome } from "./soviet-income";
import type { GameState, Nation } from "./types";

/**
 * The Year Start Sequence between a Winter and the next Spring turn (Ops 6.0, Ref 9.2, spec 02).
 * Only part B, "Calculation of initial BRP totals", is built here, from the rulebook text in
 * docs/RULES.md "Web research":
 *
 *   growth        = unused BRPs x Growth Rate / 100, fractions rounded down (none in a year the scenario names)
 *   new Base      = Base + growth
 *   initial total = new Base + the BRPs of the nation's active Minor-Allies
 *   spending limit = half the initial total, fractions rounded down, fixed for the year (Ref 10.0)
 *
 * Added by spec 14 (ticket 14-5; R4): half, rounded down, of the BRPs a conquered Major Power began the scenario with, for its conqueror, while the
 * conqueror holds the capital (conquest-income.ts). A conquered Power is skipped and keeps 0.
 *
 * Added by spec 14 (ticket 14-14; R7a): +15 for Germany and -15 for the U.S.S.R. for each of Moscow and Leningrad the Axis holds (soviet-income.ts). The U.S.S.R.'s
 * total never goes below 0.
 *
 * Added by spec 15 (ticket 15-9b; R13): `territoryIncome` (minors-income.ts) replaces the old fixed figure for the scenario's Minor-Allies: each active
 * Minor-Ally by its own value, the minors a nation helped, and the countries and colonies it conquered. A COUNTRY_INCOME event lists those lines with spec 14's.
 * A value added at a wake-up (15-8) sits in the total only until this sequence, which rebuilds the total from the Base, so it is not paid twice.
 *
 * Not built (TODO(verify), spec 02): A (strategic warfare is resolved, the only thing that can lower
 * a Base), C (strategic-warfare factors are constructed).
 */

/**
 * TODO(verify): whether BRPs a nation did not spend by the end of the year are also kept in its
 * new total. The rulebook text found says they only feed the growth, so they are not kept.
 */
export const KEEP_UNUSED_BRPS = false;

/** Ref 9.2 (growth) as the scenario rules allow it: "No BRP Base growth in the 1940 YSS" (1939 and Campaign). */
export const growthAllowed = (ctx: GameContext, year: number): boolean =>
  !ctx.scenario.rules.some((r) => r.kind === "no-brp-growth" && r.year === year);

/** Ref 9.2: growth is a percentage of the BRPs left unspent, fractions ignored. */
export const growthOf = (unused: number, growthRate: number): number => Math.floor((unused * growthRate) / 100);

/** One nation's figures after the Year Start Sequence. */
/**
 * "Unused BRPs" is read as the nation's whole `brpTotal` when the sequence runs. That total includes the
 * Minor-Allies' BRPs and any grants received, and it is what remains of the year's spending. The only
 * text found (the paraphrase of Ref 9.2 in docs/RULES.md "Web research" and spec 02) says the Base grows
 * by "unused BRPs from the previous year" times the rate; it does not say whether Minor-Ally BRPs or
 * grants count as unused. TODO(verify). With KEEP_UNUSED_BRPS false the unused BRPs are then dropped
 * (the destructive default, also TODO(verify)): only the grown Base carries into the new year.
 */
function recalculated(ctx: GameContext, state: GameState, n: Nation): { nation: Nation; growth: number; minors: number; conquered: number; cities: number; lines: IncomeLine[] } {
  const unused = n.brpTotal;
  // Spec 14 R8, TODO(verify) V27: a deficit (from the 25-BRP vital area losses) earns no growth and is taken from the new total.
  const deficit = Math.min(0, unused);
  const growth = growthAllowed(ctx, state.year) ? growthOf(Math.max(0, unused), n.growthRate) : 0;
  const brpBase = n.brpBase + growth;
  // Spec 15 R13 item 3: add minor/colony income beside spec 14's Major Power income.
  const territory = territoryIncome(ctx, state, n.id);
  const majors = conquestIncome(ctx, state, n.id);
  const minors = territory.lines.filter((l) => l.kind !== "conquered").reduce((t, l) => t + l.brps, 0);
  const conquered = majors + territory.total - minors;
  const cities = sovietCityIncome(ctx, state, n.id);
  // TODO(verify) V46: the 15s of Moscow and Leningrad join the new initial total after the growth of the Base (they do not feed it, nor the next year's growth), so the spending
  // limit, half the total, moves with them; a total never goes below 0 (it only could for the U.S.S.R.).
  const brpTotal = Math.max(0, brpBase + minors + conquered + cities + deficit + (KEEP_UNUSED_BRPS ? Math.max(0, unused) : 0));
  return { nation: { ...n, brpBase, brpTotal, spendLimit: Math.floor(brpTotal / 2), spent: 0, grantedThisYear: 0 }, growth, minors, conquered, cities, lines: [
    ...territory.lines.map((l) => ({ name: l.country, value: l.brps, reason: l.kind })),
    ...(majors === 0 ? [] : [{ name: "conquered Major Powers", value: majors, reason: "half their starting BRPs" }]),
    ...(cities === 0 ? [] : [{ name: "Moscow and Leningrad", value: cities, reason: "held by the Axis" }]),
  ] };
}

/** Runs the Year Start Sequence for the year `state` has just entered; a nation that is out of the scenario or conquered is left alone. */
export function runYearStartSequence(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  const nations = { ...state.nations };
  const events: GameEvent[] = [];
  const held = citiesNamedHeldByAxis(ctx, state).map((c) => (c === "moscow" ? "Moscow" : "Leningrad")).join(" and ");
  for (const old of Object.values(state.nations)) {
    if (isGone(old)) continue;
    const { nation, growth, minors, conquered, cities, lines } = recalculated(ctx, state, old);
    nations[old.id] = nation;
    if (lines.length > 0) events.push({ type: "COUNTRY_INCOME", nation: old.id, lines, total: lines.reduce((t, l) => t + l.value, 0) });
    if (nation.brpTotal === old.brpTotal && growth === 0) continue;
    const territory = lines.filter((line) => line.name !== "Moscow and Leningrad").map((line) => `${line.name}: ${line.value}`).join(", ");
    const reason = `Year Start Sequence ${state.year}: Base ${old.brpBase} + ${growth} growth = ${nation.brpBase}, plus ${minors} from Minor-Allies${conquered > 0 ? ` and ${conquered} from conquered countries` : ""}${territory ? ` (${territory})` : ""}${cities === 0 ? "" : cities > 0 ? `, plus ${cities} for ${held} held by the Axis` : `, less ${-cities} for ${held} held by the Axis`}`;
    events.push({ type: "BRPS_CHANGED", nation: old.id, delta: nation.brpTotal - old.brpTotal, total: nation.brpTotal, reason });
  }
  return { state: { ...state, nations }, events };
}
