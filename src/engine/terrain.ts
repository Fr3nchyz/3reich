/**
 * Terrain and its effect on defence. Source: PC Reference Manual 4.5-4.9 and the
 * Terrain Effects Chart (see docs/RULES.md).
 */

/** Base terrain of a hex. Cities, ports, beaches etc. are features on top of it. */
export type TerrainId = "plain" | "mountains" | "swamp" | "qattara-depression" | "ocean" | "lake";

export type HexFeature =
  | "beach"
  | "city"
  | "port"
  | "capital"
  | "capital-port"
  | "objective"
  | "fortress";

export type HexsideFeature =
  | "river"
  | "crossing-arrow"
  /** Hexes touching only along coastline: no movement or combat across. */
  | "coastline-only"
  /** All-water (lake/ocean) hexside: no ground movement or combat across. */
  | "all-water"
  /** All-Qattara hexside: no movement, combat or supply across. */
  | "qattara"
  | "national-boundary"
  | "front-boundary";

export interface DefenseSituation {
  terrain: TerrainId;
  features?: readonly HexFeature[];
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
  if (features.includes("fortress")) return 4;
  if (s.terrain === "mountains" || s.terrain === "swamp") return 3;
  if (s.behindRiverOrArrow) return 3;
  if (s.seaborneInvasion && features.includes("beach")) return 3;
  return 2;
}

/** Hex features that can never be chosen for occupation after Attrition combat. */
export const NO_ATTRITION_OCCUPATION: readonly HexFeature[] = [
  "capital",
  "capital-port",
  "objective",
  "fortress",
];

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
