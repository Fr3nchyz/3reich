/**
 * Terrain effects, transcribed from the PC game's in-game Terrain Effects Chart.
 * Multipliers apply to the defender's strength. How multipliers combine when several
 * apply to one attack (e.g. a river in front of a mountain hex) is not on the chart:
 * TODO confirm in the Reference Manual before implementing combat.
 */
export type TerrainId =
  | "beach"
  | "capital"
  | "capital-port"
  | "city"
  | "fortress"
  | "lake"
  | "mountains"
  | "objective"
  | "ocean"
  | "plain"
  | "swamp"
  | "qattara-depression";

export interface TerrainEffect {
  /** Defender strength multiplier. */
  defense: number;
  /** Defense multiplier when attacked by Seaborne Invasion (beaches only). */
  defenseVsSeaborne?: number;
  /** Cannot be chosen for the attacker's Attrition advance after combat. */
  noAttritionAdvance?: boolean;
  /** Cannot be taken by Attrition or Isolation, and ZOC has no effect. */
  fortress?: boolean;
  /** Ground units may be landed here by Seaborne Invasion. */
  seaborneLanding?: boolean;
  /** Can be used as an air base. */
  airBase?: boolean;
  /** Can be used as a naval base. */
  navalBase?: boolean;
}

export const TERRAIN_EFFECTS: Record<TerrainId, TerrainEffect> = {
  beach: { defense: 2, defenseVsSeaborne: 3, seaborneLanding: true },
  capital: { defense: 1, noAttritionAdvance: true, airBase: true },
  "capital-port": { defense: 1, noAttritionAdvance: true, airBase: true, navalBase: true },
  city: { defense: 1, airBase: true },
  fortress: { defense: 4, fortress: true },
  lake: { defense: 1 },
  mountains: { defense: 3 },
  objective: { defense: 1, noAttritionAdvance: true, airBase: true },
  ocean: { defense: 1 },
  plain: { defense: 2 },
  swamp: { defense: 3 },
  "qattara-depression": { defense: 1 },
};

/** Defense multipliers for hexside features, applied to attacks across them. */
export const HEXSIDE_DEFENSE: Record<"river" | "crossing-arrow", number> = {
  river: 3,
  "crossing-arrow": 3,
};

/** Air units can cross ocean only if they can stage to another base within this many hexes. */
export const MAX_OCEAN_AIR_STAGE_HEXES = 8;
