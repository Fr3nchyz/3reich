import type { PowerId } from "./types";

/** Charts from the PC reference map and Reference Manual. See docs/RULES.md. */

export const BRP_COSTS = {
  declareWarOnMajorPower: 35,
  declareWarOnMinorCountry: 10,
  offensiveOption: 15,
} as const;

/** BRPs per factor built. */
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
 * intercepting fleet's base. Distance 1 is automatic. The printed table shows "25-30"
 * and "30+"; 30 is treated as 25-30 here. TODO(verify) the 30-hex boundary.
 */
export function interceptionRolls(distance: number): number[] | "automatic" {
  if (distance <= 1) return "automatic";
  if (distance <= 10) return [1, 2, 3, 4, 5];
  if (distance <= 18) return [1, 2, 3, 4];
  if (distance <= 24) return [1, 2, 3];
  if (distance <= 30) return [1, 2];
  return [1];
}

/** Naval advantage DRM from the ratio of friendly to enemy naval factors. */
export function navalAdvantageDrm(friendly: number, enemy: number): number {
  if (enemy <= 0) return 5;
  // Integer comparisons avoid floating-point error at the 1.33:1 and 1.67:1 boundaries.
  if (friendly >= 4 * enemy) return 5;
  if (friendly >= 3 * enemy) return 4;
  if (friendly >= 2 * enemy) return 3;
  if (3 * friendly >= 5 * enemy) return 2;
  if (3 * friendly >= 4 * enemy) return 1;
  return 0;
}

export type NavalNation = PowerId | "sweden" | "turkey" | "spain" | "vichy-france" | "free-france";

/**
 * Naval nationality DRM. Italy is -1 for battles in or south of map row N, -2 north
 * of it. Nations not listed on the chart get -2. TODO(verify) unlisted nations.
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
    default:
      return -2;
  }
}

/** Air advantage: the side with more air factors gets +1 per factor of excess. */
export function airAdvantageDrm(friendly: number, enemy: number): number {
  return Math.max(0, friendly - enemy);
}

/** Air force nationality DRM: 0 Germany/USA/Britain, -1 USSR/Italy/France, -2 others. */
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
 * TODO(verify) that entries count counters rather than factors.
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
