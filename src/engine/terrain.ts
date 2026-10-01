/**
 * Terrain and its effect on defence. Source: PC Reference Manual 4.5-4.9 and the
 * Terrain Effects Chart (see docs/RULES.md).
 */

/**
 * Land terrain of a hex. A hex may also contain sea (Ref 4.3), which the map records
 * separately; all-sea hexes have no land terrain.
 */
export type LandTerrain = "plain" | "mountains" | "swamp" | "qattara-depression";

/**
 * Static features printed on the map. Fortress status changes during play (Ref 4.8),
 * so it is tracked in the game state, not here.
 */
export type HexFeature = "beach" | "city" | "port" | "capital" | "capital-port" | "objective";

export interface DefenseSituation {
  terrain: LandTerrain;
  features?: readonly HexFeature[];
  /** True when the hex currently has Fortress status (see GameState.fortresses). */
  fortress?: boolean;
  /**
   * True when the defender is behind a river or crossing arrow and every attacker is on
   * the far side. Any attacking ground unit (including airdropped) on the defender's
   * side cancels this.
   */
  behindRiverOrArrow?: boolean;
  /** True when the attack includes a Seaborne Invasion. */
  seaborneInvasion?: boolean;
}

/**
 * Multiplier applied to each defending ground unit. Defence is at least doubled in any
 * terrain; tripled in mountains, swamp, behind a river/crossing arrow, or on a beach
 * against Seaborne Invasion; quadrupled in a fortress. Benefits are not cumulative:
 * the single best applies (a unit on a mountain behind a river is only tripled).
 */
export function defenseMultiplier(s: DefenseSituation): number {
  const features = s.features ?? [];
  if (s.fortress) return 4;
  if (s.terrain === "mountains" || s.terrain === "swamp") return 3;
  if (s.behindRiverOrArrow) return 3;
  if (s.seaborneInvasion && features.includes("beach")) return 3;
  return 2;
}

/**
 * Hex features that can never be chosen for occupation after Attrition combat
 * (Ref 12.4). Fortress and Bridgehead hexes are also excluded; both are dynamic.
 */
export const NO_ATTRITION_OCCUPATION: readonly HexFeature[] = ["capital", "capital-port", "objective"];

/** Features that can base air units (every city type, per Reference Manual 4.7). */
export const AIR_BASE_FEATURES: readonly HexFeature[] = [
  "city",
  "port",
  "capital",
  "capital-port",
  "objective",
];

/** Features that can base fleets. */
export const NAVAL_BASE_FEATURES: readonly HexFeature[] = ["port", "capital-port"];

/** Air units cross ocean only if they can stage to another base within this many hexes. */
export const MAX_OCEAN_AIR_STAGE_HEXES = 8;
