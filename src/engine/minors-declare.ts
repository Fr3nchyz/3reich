import type { GameContext } from "./context";
import { isConquered } from "./conquest-record";
import { MINOR_COUNTRIES } from "./minors-ids";
import type { CountryId } from "./minors-record";
import { BRP_COSTS } from "./tables";
import type { GameState, MinorCountry, PowerId } from "./types";

const war = (state: GameState, a: string, b: string): boolean =>
  state.wars.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/**
 * TODO(verify) MC21, spec 15 R2 (Ref 13.1): the minors the U.S.S.R. may declare on before it is at war with Germany or Italy. The repo carries no source list, so this is the
 * interim reading from the map: every minor with a land border on the U.S.S.R. (tests/minors-declare-neutral.test.ts checks it against map.json), Eastern Europe included.
 */
export const MC21_USSR_BORDER_MINORS: readonly string[] = ["finland", "poland", "rumania", "turkey", "persia", "eastern-europe"];
/** TODO(verify) MC21: "the Western Allies" of 13.1 are Britain, France and the U.S.A.; being at war with any one of them counts. */
export const MC21_WESTERN_ALLIES: readonly PowerId[] = ["britain", "france", "usa"];
/**
 * TODO(verify) MC21, Ref 13.1 / spec 15 R2, R10: while not at war with Germany or Italy (which includes every date before Fall 1941, when the U.S.S.R. cannot declare on them),
 * the U.S.S.R. may not declare on an Axis Minor-Ally that holds a German ground factor, a Replacement included.
 */
const GROUND = ["infantry", "armor", "airborne", "replacement"];

/** Powers that declared on, or are at war with, the minor (the record's attacker and the pairs in `wars`). */
const declarersOn = (state: GameState, country: CountryId): PowerId[] => {
  const out = new Set<PowerId>();
  const attacker = state.countries?.[country]?.attacker;
  if (attacker) out.add(attacker);
  for (const p of Object.keys(state.nations) as PowerId[]) if (war(state, p, country)) out.add(p);
  return [...out];
};

/** Countries sharing a land hexside with `country`, read from the map (no data import). */
function neighbourCountries(ctx: GameContext, country: string): Set<string> {
  const out = new Set<string>();
  for (const [key, side] of Object.entries(ctx.map.hexsides)) {
    if (!side.land) continue;
    const [a, b] = key.split("-").map((id) => ctx.map.hexes[id]?.country);
    if (a && b && a !== b && (a === country || b === country)) out.add(a === country ? b : a);
  }
  return out;
}

/** Spec 15 R2 (Ref 13.1), the joint rules and the U.S.S.R. before war; `by` may be a neutral Major Power (MC21). */
function jointDeclarationProblem(ctx: GameContext, state: GameState, by: PowerId, country: CountryId): string | null {
  const others = declarersOn(state, country).filter((p) => p !== by);
  if ((by === "germany" || by === "italy") && others.some((p) => p === "germany" || p === "italy") && !MC21_WESTERN_ALLIES.some((w) => war(state, "italy", w))) {
    return "Germany and Italy may not both declare on one minor until Italy is at war with the Western Allies.";
  }
  const ussrWithWest = (by === "ussr" && others.some((p) => MC21_WESTERN_ALLIES.includes(p))) || (MC21_WESTERN_ALLIES.includes(by) && others.includes("ussr"));
  if (ussrWithWest && !war(state, "ussr", "germany") && !war(state, "ussr", "italy")) {
    return "The U.S.S.R. and the Western Allies may not both declare on one minor until Russia is at war with Germany or Italy.";
  }
  if (by !== "ussr" || war(state, "ussr", "germany") || war(state, "ussr", "italy")) return null;
  const conquered = (state.conquests ?? []).filter((c) => c.by === "ussr").map((c) => c.country as string);
  if (!MC21_USSR_BORDER_MINORS.includes(country) && !conquered.some((c) => neighbourCountries(ctx, c).has(country))) {
    return "The U.S.S.R. may declare, before it is at war with Germany or Italy, only on a minor bordering it or bordering a minor it has conquered.";
  }
  const garrisoned = Object.values(state.units).some((u) => u.owner === "germany" && GROUND.includes(u.type) && ctx.map.hexes[u.at]?.country === country);
  if (garrisoned && state.minorAllies.some((m) => m.owner === country)) {
    return "A German Garrison in this Axis Minor-Ally bars the U.S.S.R. while it is not at war with Germany or Italy.";
  }
  return null;
}

/** Spec 15 R2 (Ref 13.1): Beta restrictions only; MC21 adds the joint rules and neutral declarers.
 * `by` identifies the declaring Major Power, rather than the whole coalition.
 */
export function minorDeclarationProblem(ctx: GameContext, state: GameState, by: PowerId, countryId: string): string | null {
  // Spec 15 R1/R2: Switzerland, the U.S.A. and colonies are not minor targets.
  if (!MINOR_COUNTRIES.includes(countryId as MinorCountry) && countryId !== "eastern-europe") return "Not a minor declaration target.";
  const country = countryId as CountryId;
  // Spec 15 R2: the scenario may prohibit declarations on neutrals.
  if (ctx.scenario.rules.some((r) => r.kind === "no-war-on-neutrals")) return "The scenario prohibits war on neutrals.";
  if (isConquered(state, country)) return "The country is conquered.";
  // Spec 15 R2 / MC21: the joint rules of 13.1 and the U.S.S.R. before war, ahead of the generic "already fighting" reasons.
  const joint = jointDeclarationProblem(ctx, state, by, country);
  if (joint) return joint;
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
