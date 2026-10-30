import type { GameContext } from "./context";
import { isConquered } from "./conquest-record";
import { MINOR_COUNTRIES } from "./minors-ids";
import type { CountryId } from "./minors-record";
import { BRP_COSTS } from "./tables";
import type { GameState, MinorCountry, PowerId } from "./types";

const war = (state: GameState, a: string, b: string): boolean =>
  state.wars.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** Spec 15 R2 (Ref 13.1): Beta restrictions only; neutral declarers remain outside Beta (MC21).
 * `by` identifies the declaring Major Power, rather than the whole coalition.
 */
export function minorDeclarationProblem(ctx: GameContext, state: GameState, by: PowerId, countryId: string): string | null {
  // Spec 15 R1/R2: Switzerland, the U.S.A. and colonies are not minor targets.
  if (!MINOR_COUNTRIES.includes(countryId as MinorCountry) && countryId !== "eastern-europe") return "Not a minor declaration target.";
  const country = countryId as CountryId;
  // Spec 15 R2: the scenario may prohibit declarations on neutrals.
  if (ctx.scenario.rules.some((r) => r.kind === "no-war-on-neutrals")) return "The scenario prohibits war on neutrals.";
  if (isConquered(state, country)) return "The country is conquered.";
  const record = state.countries?.[country];
  // Spec 15 R2/R9: sleeping allies are targets; active allies and fighting minors are not neutral.
  if (state.minorAllies.some((m) => m.owner === country && m.active)) return "The minor ally is active.";
  if (record && record.status !== "neutral") return "The minor is already fighting.";
  if (Object.keys(state.nations).some((p) => war(state, p, country))) return "The minor is already at war with a Major Power.";
  // Spec 15 R10: a recorded Garrison ban survives revocation.
  if (record?.closedTo?.includes(by)) return "A Garrison bars this declaration.";
  // Spec 15 R11: the opened Persian route no longer needs a declaration.
  if (record?.opened) return "The Persian route is already open.";
  // Spec 15 R2/R12: Eastern Europe is created separately by 15-11.
  if (country === "eastern-europe") {
    if (!record) return "Eastern Europe has not been created.";
    if (by === "germany" && state.year < 1940) return "Germany must wait until 1940.";
    if (by === "ussr" && (state.year < 1939 || (state.year === 1939 && (state.season === "spring" || state.season === "summer")))) return "The U.S.S.R. must wait until Fall 1939.";
  }
  return null;
}

/** TODO(verify) MC4, spec 15 R2: only explicit helpers and active allies imply automatic Major-Power war.
 * Sleeping allies do not; no legal Beta declaration triggers this price. Colonies and Vichy come with their own tickets.
 */
export const MC4_EXPLICIT_PROTECTORS_ONLY = true;
/** TODO(verify) MC14, spec 15 R1/R11: unopened Persia uses the ordinary minor price. */
export const MC14_PERSIA_DECLARATION_COST = BRP_COSTS.declareWarOnMinorCountry;

/** Spec 15 R2, Ref 13.0: 10 BRPs, or 35 if a protecting Major Power must also be fought. */
export function declarationCost(_ctx: GameContext, state: GameState, by: PowerId, countryId: string): number {
  if (["germany", "italy", "ussr", "britain", "france", "usa"].includes(countryId)) return BRP_COSTS.declareWarOnMajorPower;
  const helpers = state.countries?.[countryId as CountryId]?.helpers ?? [];
  const allies = state.minorAllies.filter((m) => m.owner === countryId && m.active).map((m) => m.of);
  const bringsMajorWar = MC4_EXPLICIT_PROTECTORS_ONLY && [...helpers, ...allies].some((p) => p !== by && !war(state, by, p));
  if (bringsMajorWar) return BRP_COSTS.declareWarOnMajorPower;
  return countryId === "persia" ? MC14_PERSIA_DECLARATION_COST : BRP_COSTS.declareWarOnMinorCountry;
}
