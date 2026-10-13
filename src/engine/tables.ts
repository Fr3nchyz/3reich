import type { PowerId } from "./types";

/**
 * Charts from the PC reference map and Reference Manual. See docs/RULES.md. Each chart
 * here was also checked against the game's own chart screens (TABLE*.TAB) and, where the
 * executable holds the rule, against 3R2.EXE; see docs/GAME_DATA.md, "Rule tables".
 */

/** Matches the game's BRP costs chart screen (TABLE3.TAB). */
export const BRP_COSTS = {
  declareWarOnMajorPower: 35,
  declareWarOnMinorCountry: 10,
  offensiveOption: 15,
} as const;

/** BRPs per factor built. Matches the game's BRP costs chart screen (TABLE3.TAB). */
export const BUILD_COST_PER_FACTOR = {
  air: 3,
  airborne: 3,
  armor: 2,
  asw: 3,
  infantry: 1,
  interceptorFlak: 2,
  naval: 3,
  replacement: 1,
  sac: 3,
  submarine: 2,
} as const;

/** Basic ground-unit stacking limit (exceptions: London 3 British, Bridgehead 5, airborne free). */
export const STACKING_LIMIT = 2;
export const STACKING_LIMIT_LONDON_BRITISH = 3;
export const STACKING_LIMIT_BRIDGEHEAD = 5;
/** Ref 5.0: at most 5 air factors on each airbase or city (double cities are not marked on the map yet). */
export const AIR_FACTOR_STACKING_LIMIT = 5;
/** Ref 5.0: up to 36 naval factors in one port. */
export const NAVAL_FACTOR_STACKING_LIMIT = 36;

/**
 * Interception table: die rolls (1-6) that allow interception, by distance from the
 * intercepting fleet's base. Distance 1 is automatic. The printed table (and the game's
 * own chart screen, TABLE7.TAB) shows "25-30" and "30+"; the game's interception routine
 * in 3R2.EXE settles it: 30 hexes still succeeds on 1 or 2, and only 31 or more needs a 1.
 */
export function interceptionRolls(distance: number): number[] | "automatic" {
  if (distance <= 1) return "automatic";
  if (distance <= 10) return [1, 2, 3, 4, 5];
  if (distance <= 18) return [1, 2, 3, 4];
  if (distance <= 24) return [1, 2, 3];
  if (distance <= 30) return [1, 2];
  return [1];
}

/**
 * Naval advantage DRM from the ratio of friendly to enemy naval factors: +1 from 1.33:1,
 * +2 from 1.67:1, +3 from 2:1, +4 from 3:1, +5 from 4:1 (the side with fewer factors gets 0).
 *
 * The chart's 1.33 and 1.67 are taken literally, as the game does: its naval combat
 * routine in 3R2.EXE compares the single-precision ratio with the decimals 1.33 and 1.67,
 * not with 4/3 and 5/3. So 5 factors against 3 (1.666...) is only +1. And because 1.67 in
 * single precision is just below 1.67, exactly 1.67:1 (167 against 100) is also +1. The
 * integer tests below give the game's result for any factor totals under 100,000.
 * Evidence: the game's naval chart screen (TABLE10.TAB) prints 1.33:1 and 1.67:1, and the
 * routine uses those decimals (docs/GAME_DATA.md, "Rule tables").
 */
export function navalAdvantageDrm(friendly: number, enemy: number): number {
  if (enemy <= 0) return 5;
  if (friendly >= 4 * enemy) return 5;
  if (friendly >= 3 * enemy) return 4;
  if (friendly >= 2 * enemy) return 3;
  if (100 * friendly > 167 * enemy) return 2;
  if (100 * friendly >= 133 * enemy) return 1;
  return 0;
}

export type NavalNation = PowerId | "sweden" | "turkey" | "spain" | "vichy-france" | "free-france";

/**
 * Naval nationality DRM. Italy is -1 for battles in or south of map row N, -2 north
 * of it. Every nation that can own a fleet is on the chart: the Minor Country Forces
 * chart gives fleets only to Spain, Sweden and Turkey. The game's naval routine
 * (3R2.EXE) gives the same values, with -2 for any nation it does not name, and tests
 * the battle's row against N the same way (GAME_DATA.md, "Rule tables").
 *
 * TODO(verify) Vichy and Free French fleets: the chart (TABLE10.TAB and the map card)
 * gives them 0, the same as France, but the routine names only nation
 * number 1 (France), so a fleet carrying Vichy's or Free France's own nation numbers
 * (40, 41) would get -2. Which number those fleets carry is not known yet; the chart
 * value is kept.
 */
export function navalNationalityDrm(nation: NavalNation, battleNorthOfRowN = false): number {
  switch (nation) {
    case "germany":
      return 2;
    case "usa":
    case "britain":
    case "sweden":
      return 1;
    case "france":
    case "vichy-france":
    case "free-france":
      return 0;
    case "italy":
      return battleNorthOfRowN ? -2 : -1;
    case "ussr":
    case "turkey":
    case "spain":
      return -2;
  }
}

/**
 * Air advantage: the side with more air factors gets +1 per factor of excess. Matches the
 * game's air chart screen (TABLE1.TAB).
 */
export function airAdvantageDrm(friendly: number, enemy: number): number {
  return Math.max(0, friendly - enemy);
}

/**
 * Air force nationality DRM: 0 Germany/USA/Britain, -1 USSR/Italy/France, -2 all others.
 * Matches the game's air chart screen (TABLE1.TAB) and its air routine in 3R2.EXE.
 */
export function airNationalityDrm(nation: PowerId | "other"): number {
  if (nation === "germany" || nation === "usa" || nation === "britain") return 0;
  if (nation === "ussr" || nation === "italy" || nation === "france") return -1;
  return -2;
}

export type MinorCountry =
  | "arabia" | "belgium" | "bulgaria" | "denmark" | "finland" | "greece" | "hungary"
  | "ireland" | "luxembourg" | "netherlands" | "norway" | "persia" | "poland"
  | "portugal" | "rumania" | "spain" | "sweden" | "turkey" | "yugoslavia";

/**
 * Minor Country Forces: number of counters of each type when a minor is attacked or
 * activated. Keys are counter values: inf1_3 = 1-3 infantry, inf2_3 = 2-3 infantry,
 * arm2_5 = 2-5 armor, air1_4 / air2_4 = air units, fleet2 = 2-factor fleet.
 *
 * The entries count counters, not factors: on the game's chart screen (TABLE9.TAB) each
 * column is headed by a counter picture, and several entries are odd numbers in columns
 * of 2-factor counters (one 2-5 armor for Spain, one 2-3 infantry for Belgium), which
 * could not be factor totals. The scenario pages' Minor-Ally and Polish force pools,
 * read counter by counter, also equal these rows (tests/scenario-data.test.ts). All 114
 * entries match the chart screen.
 */
export interface MinorForces {
  inf1_3: number;
  inf2_3: number;
  arm2_5: number;
  air1_4: number;
  air2_4: number;
  fleet2: number;
}

const f = (inf1_3: number, inf2_3: number, arm2_5: number, air1_4: number, air2_4: number, fleet2: number): MinorForces =>
  ({ inf1_3, inf2_3, arm2_5, air1_4, air2_4, fleet2 });

export const MINOR_COUNTRY_FORCES: Record<MinorCountry, MinorForces> = {
  arabia: f(0, 0, 0, 0, 0, 0),
  belgium: f(3, 1, 0, 1, 0, 0),
  bulgaria: f(4, 0, 0, 1, 0, 0),
  denmark: f(1, 0, 0, 1, 0, 0),
  finland: f(0, 5, 0, 1, 0, 0),
  greece: f(0, 4, 0, 1, 0, 0),
  hungary: f(6, 1, 0, 1, 0, 0),
  ireland: f(0, 0, 0, 0, 0, 0),
  luxembourg: f(0, 0, 0, 0, 0, 0),
  netherlands: f(0, 1, 0, 1, 0, 0),
  norway: f(2, 0, 0, 0, 0, 0),
  persia: f(0, 0, 0, 0, 0, 0),
  poland: f(7, 3, 0, 2, 0, 0),
  portugal: f(0, 0, 0, 0, 0, 0),
  rumania: f(6, 2, 0, 1, 0, 0),
  spain: f(0, 7, 1, 0, 3, 4),
  sweden: f(0, 5, 0, 1, 0, 2),
  turkey: f(0, 7, 2, 0, 2, 3),
  yugoslavia: f(0, 5, 0, 2, 0, 0),
};
