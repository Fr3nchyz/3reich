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
  /**
   * True when the Russian winter is on and the defenders are Axis units (not only Finns) east of the original Russian border (`winterDefence`, winter-effects.ts): the
   * plain doubling is lost, and nothing else (Ref 28.0, spec 14 R10).
   */
  winter?: boolean;
}

/** Why a defence is multiplied the way it is: the single best benefit that applies (they never add up). */
export type DefenseBasis = "fortress" | "mountains" | "swamp" | "river-or-arrow" | "beach-invasion" | "winter" | "plain";

/**
 * Multiplier applied to each defending ground unit, with the reason. Defence is at least doubled in any
 * terrain (once, not at all for Axis defenders in Russia in the winter: `winter`); tripled in mountains, swamp, behind a river/crossing arrow, or on a beach
 * against Seaborne Invasion; quadrupled in a fortress. Benefits are not cumulative:
 * the single best applies (a unit on a mountain behind a river is only tripled).
 * The multipliers match the game's own terrain effects chart screen (TABLE11.TAB); the
 * chart does not mention cumulation, which comes from the Reference Manual.
 * The order below is the order of priority; `defenseMultiplier` returns this function's number, so there is one source of truth.
 */
export function defenseBasis(s: DefenseSituation): { multiplier: number; basis: DefenseBasis } {
  const features = s.features ?? [];
  if (s.fortress) return { multiplier: 4, basis: "fortress" };
  if (s.terrain === "mountains") return { multiplier: 3, basis: "mountains" };
  if (s.terrain === "swamp") return { multiplier: 3, basis: "swamp" };
  if (s.behindRiverOrArrow) return { multiplier: 3, basis: "river-or-arrow" };
  if (s.seaborneInvasion && features.includes("beach")) return { multiplier: 3, basis: "beach-invasion" };
  // The Russian winter takes away only the plain "times two" (Ref 28.0, TODO(verify) V23: whether a Fortress keeps its fourfold; read as yes, like the triples).
  if (s.winter) return { multiplier: 1, basis: "winter" };
  return { multiplier: 2, basis: "plain" };
}

/** Multiplier applied to each defending ground unit (see `defenseBasis` for the rule and the reason). */
export const defenseMultiplier = (s: DefenseSituation): number => defenseBasis(s).multiplier;

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
