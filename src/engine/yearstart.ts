import type { GameEvent } from "./action-types";
import { conquestIncome } from "./conquest-income";
import type { GameContext } from "./context";
import { isGone } from "./nations";
import { sovietCityIncome } from "./soviet-income";
import type { GameState, Nation, PowerId } from "./types";

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
 * Not built (TODO(verify), spec 02): A (strategic warfare is resolved, the only thing that can lower
 * a Base), C (strategic-warfare factors are constructed), the BRPs of conquered minor countries and
 * colonies, of attacked minors the nation intervened in.
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

/**
 * BRPs the nation's active Minor-Allies add to its total (Ref 9.2). The scenario pages give the sum
 * for the Minor-Allies active at the start (Germany's 45 for Finland, Rumania, Hungary and Bulgaria
 * in 1942 and 1944: total less Base); the value of each one alone is not in the data, except that
 * the PC README puts Bulgaria at 10. So the sum counts while all of those Minor-Allies are active.
 * TODO(verify): the value of each Minor-Ally, for when only some are active or others are activated.
 */
export function minorAllyBrps(ctx: GameContext, state: GameState, id: PowerId): number {
  const start = ctx.scenario.nations[id];
  const allies = ctx.scenario.minorAllies.filter((m) => m.of === id && m.active);
  const stillActive = allies.every((m) => state.minorAllies.some((a) => a.owner === m.owner && a.active));
  return stillActive ? start.brpTotal - start.brpBase : 0;
}

/** One nation's figures after the Year Start Sequence. */
/**
 * "Unused BRPs" is read as the nation's whole `brpTotal` when the sequence runs. That total includes the
 * Minor-Allies' BRPs and any grants received, and it is what remains of the year's spending. The only
 * text found (the paraphrase of Ref 9.2 in docs/RULES.md "Web research" and spec 02) says the Base grows
 * by "unused BRPs from the previous year" times the rate; it does not say whether Minor-Ally BRPs or
 * grants count as unused. TODO(verify). With KEEP_UNUSED_BRPS false the unused BRPs are then dropped
 * (the destructive default, also TODO(verify)): only the grown Base carries into the new year.
 */
function recalculated(ctx: GameContext, state: GameState, n: Nation): { nation: Nation; growth: number; minors: number; conquered: number; cities: number } {
  const unused = n.brpTotal;
  const growth = growthAllowed(ctx, state.year) ? growthOf(unused, n.growthRate) : 0;
  const brpBase = n.brpBase + growth;
  const conquered = conquestIncome(ctx, state, n.id);
  const minors = minorAllyBrps(ctx, state, n.id);
  const cities = sovietCityIncome(ctx, state, n.id);
  const brpTotal = Math.max(0, brpBase + minors + conquered + cities + (KEEP_UNUSED_BRPS ? unused : 0));
  return { nation: { ...n, brpBase, brpTotal, spendLimit: Math.floor(brpTotal / 2), spent: 0, grantedThisYear: 0 }, growth, minors, conquered, cities };
}

/** Runs the Year Start Sequence for the year `state` has just entered; a nation that is out of the scenario or conquered is left alone. */
export function runYearStartSequence(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  const nations = { ...state.nations };
  const events: GameEvent[] = [];
  for (const old of Object.values(state.nations)) {
    if (isGone(old)) continue;
    const { nation, growth, minors, conquered, cities } = recalculated(ctx, state, old);
    nations[old.id] = nation;
    if (nation.brpTotal === old.brpTotal && growth === 0) continue;
    const reason = `Year Start Sequence ${state.year}: Base ${old.brpBase} + ${growth} growth = ${nation.brpBase}, plus ${minors} from Minor-Allies${conquered > 0 ? ` and ${conquered} from conquered countries` : ""}${cities === 0 ? "" : cities > 0 ? `, plus ${cities} for Moscow and Leningrad held by the Axis` : `, less ${-cities} for Moscow and Leningrad held by the Axis`}`;
    events.push({ type: "BRPS_CHANGED", nation: old.id, delta: nation.brpTotal - old.brpTotal, total: nation.brpTotal, reason });
  }
  return { state: { ...state, nations }, events };
}
