import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { isConquered } from "./conquest-record";
import { sideInWar } from "./control";
import type { HexId } from "./hex";
import { eliminateUnits } from "./losses";
import { AXIS_MINOR_ALLIES } from "./minors-ids";
import type { CountryId } from "./minors-record";
import { factorsOf } from "./placement";
import type { ForceOwner, GameState, MinorCountry, Unit } from "./types";
import { atWar } from "./war";

/**
 * Spec 15 R10 (Ref 17.2 to 17.4; Peele's errata on 25.6; audit item 9): Germany walks into a sleeping Axis Minor-Ally with no declaration,
 * a Garrison there revokes an Allied declaration on it, and German units there are the Axis' own ground for supply. Pure functions over the state.
 */

/**
 * TODO(verify) MC10, spec 15 R10: only German units may enter a sleeping ally (R10: "other nations, the Allies and, reading, Italy may not").
 * Off: Italian units may walk in too.
 */
export const MC10_ONLY_GERMANY_ENTERS = true;

/**
 * TODO(verify) MC10, spec 15 R10: a sleeping ally's capital is a supply source for the Axis while it sleeps (19.2: the capital of a minor with an army;
 * 17.3 makes the land German). Its land counts as Axis ground for supply tracing; control of the hexes is not changed (no Objective counts for Germany). Off: neither.
 */
export const MC10_SLEEPING_LAND_SUPPLIES = true;

/** TODO(verify) MC11, spec 15 R10: a Garrison removes the army the attacker's declaration called up. BRPs are not refunded (no code: the 10 BRPs stay spent). */
export const MC11_GARRISON_REMOVES_ARMY = true;

/** TODO(verify) MC11, spec 15 R10: the ban on the attacker declaring on that country again is permanent (`closedTo`). Off: the revocation leaves no ban. */
export const MC11_GARRISON_BAN_PERMANENT = true;

/** TODO(verify) MC22, spec 15 R10 / errata: after the opening setup the only limit on a Garrison is five factors in Finland. */
export const MC22_FINLAND_GARRISON_MAX_FACTORS = 5;

/** TODO(verify) MC22, spec 15 R10, Ref 29.0: no German Garrison in Bessarabia (the Rumanian hexes of Eastern Europe) unless Germany is at war with the U.S.S.R. Off: no ban. */
export const MC22_BESSARABIA_BAN = true;

const isOwner = (o: ForceOwner): boolean => o === "germany" || (!MC10_ONLY_GERMANY_ENTERS && o === "italy");

/**
 * Whether the country is a sleeping Axis Minor-Ally: one of the four, inactive, not conquered, and not declared on by the Axis (R9: if Germany or Italy
 * declares on a possible ally it can never be an Axis ally). Attacked by an Allied power it still sleeps (R10).
 */
export function sleepingAlly(state: GameState, country: string | undefined): country is MinorCountry {
  if (country === undefined || !(AXIS_MINOR_ALLIES as readonly string[]).includes(country)) return false;
  const entry = state.minorAllies.find((m) => m.owner === country);
  if (!entry || entry.active || isConquered(state, country as CountryId)) return false;
  const attacker = state.countries?.[country as MinorCountry]?.attacker;
  return !(attacker !== undefined && sideInWar(state, attacker) === "axis");
}

/** Bessarabia (Ref 29.0): the five Rumanian hexes of EASTEURP.CON, east of the Partition Line. A local list, as the engine may not import the data files; tests/minors-axis.test.ts checks it against them. */
export const BESSARABIA_HEXES: readonly HexId[] = ["R35", "R36", "S36", "T36", "U36"];
const bessarabia = (hex: HexId): boolean => BESSARABIA_HEXES.includes(hex);

/**
 * The sleeping ally whose land this hex is, or null. Bessarabia stops being Rumanian once Eastern Europe is created (Ref 29.0; 15-11 creates the record).
 */
export function sleepingAllyOfHex(ctx: GameContext, state: GameState, hex: HexId): MinorCountry | null {
  const h = ctx.map.hexes[hex];
  const country = h?.land ? h.country : undefined;
  if (!sleepingAlly(state, country)) return null;
  return state.countries?.["eastern-europe"] && bessarabia(hex) ? null : country;
}

/** Whether a unit of the power that declared on a sleeping ally stands in it (then a German entry would be an Intervention, 15-8, not a Garrison). */
const attackerInside = (ctx: GameContext, state: GameState, country: MinorCountry): boolean => {
  const attacker = state.countries?.[country]?.attacker;
  return attacker !== undefined && Object.values(state.units).some((u) => u.owner === attacker && ctx.map.hexes[u.at]?.country === country);
};

/** R10 / MC22: why a German Garrison may not be in this hex of a sleeping ally (Bessarabia without war on the U.S.S.R.), or null. */
export function garrisonBanProblem(ctx: GameContext, state: GameState, owners: readonly ForceOwner[], hex: HexId): string | null {
  if (!MC22_BESSARABIA_BAN || !owners.some(isOwner) || sleepingAllyOfHex(ctx, state, hex) === null || !bessarabia(hex) || atWar(state, "germany", "ussr")) return null;
  return `${hex} is in Bessarabia: Germany may not Garrison it without being at war with the U.S.S.R. (R10, Ref 29.0).`;
}

/**
 * R10 (Ref 17.2): whether this owner may enter the hex as a Garrison with no declaration and no Intervention: a German unit, a sleeping ally's land, and (if an Allied power
 * declared on the ally) that power has no unit inside.
 */
export function garrisonMayEnter(ctx: GameContext, state: GameState, owner: ForceOwner, hex: HexId): boolean {
  const country = sleepingAllyOfHex(ctx, state, hex);
  return country !== null && isOwner(owner) && !attackerInside(ctx, state, country) && garrisonBanProblem(ctx, state, [owner], hex) === null;
}

/** R10 / MC22 (errata): German units may not make a Garrison in Finland of more than five factors. Units already there count, the moving units do not count twice. */
export function garrisonLimitProblem(ctx: GameContext, state: GameState, units: readonly Unit[], to: HexId): string | null {
  if (ctx.map.hexes[to]?.country !== "finland" || sleepingAllyOfHex(ctx, state, to) === null) return null;
  const moving = new Set(units.map((u) => u.id));
  const germans = (u: Pick<Unit, "owner">) => u.owner === "germany";
  const there = Object.values(state.units).filter((u) => germans(u) && !moving.has(u.id) && ctx.map.hexes[u.at]?.country === "finland").reduce((n, u) => n + factorsOf(u), 0);
  const added = units.filter(germans).reduce((n, u) => n + factorsOf(u), 0);
  return added > 0 && there + added > MC22_FINLAND_GARRISON_MAX_FACTORS ? `At most ${MC22_FINLAND_GARRISON_MAX_FACTORS} German factors may garrison Finland (R10, errata); this would make ${there + added}.` : null;
}

/**
 * R10: German ground units that end or pass a move in a sleeping ally on which an Allied power has declared, while that power has no unit inside, are a Garrison:
 * the declaration is revoked (war pair ended, status neutral, the army it called up removed, MC11), the attacker may not declare on it again (MC11) and the ally does NOT wake.
 * Without a declaration a Garrison changes nothing. Called with every hex entered, like `noteMinorEntry`.
 */
export function noteGarrison(ctx: GameContext, state: GameState, units: readonly { owner: ForceOwner }[], hexes: readonly HexId[]): { state: GameState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  if (!state.countries || !units.some((u) => isOwner(u.owner))) return { state, events };
  for (const country of new Set(hexes.map((h) => sleepingAllyOfHex(ctx, state, h)))) {
    const record = country === null ? undefined : next.countries?.[country];
    if (!country || record?.status !== "attacked" || !record.attacker || attackerInside(ctx, next, country)) continue;
    const by = record.attacker;
    const gone = MC11_GARRISON_REMOVES_ARMY ? eliminateUnits(next, Object.values(next.units).filter((u) => u.owner === country).map((u) => u.id)) : { state: next, events: [], removed: [] as Unit[] };
    const { duty: _duty, attacker: _by, toPlace: _place, helpers: _helpers, ...kept } = record;
    next = {
      ...gone.state,
      wars: gone.state.wars.filter(([a, b]) => !((a === by && b === country) || (b === by && a === country))),
      countries: { ...gone.state.countries, [country]: { ...kept, status: "neutral" as const, ...(MC11_GARRISON_BAN_PERMANENT ? { closedTo: [...(kept.closedTo ?? []), by] } : {}) } },
    };
    events.push(...gone.events, { type: "MINOR_GARRISONED", minor: country, by: "germany", revoked: by, removed: gone.removed.map((u) => u.id) });
  }
  return { state: next, events };
}
