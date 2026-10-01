export type PowerId = "germany" | "italy" | "ussr" | "britain" | "france" | "usa";

/** The game is played by two sides; each side takes one player turn per game turn. */
export type Side = "axis" | "allies";

/** A major power's alignment. USSR and USA start neutral and can join either side. */
export type NationStatus = "axis" | "allied" | "neutral";

/** Counter types shown on the PC game's Unit Types screen. */
export type UnitType =
  | "infantry"
  | "armor"
  | "airborne"
  | "replacement"
  | "air"
  | "fleet"
  | "airbase"
  | "bridgehead";

export type Season = "spring" | "summer" | "fall" | "winter";

export interface Nation {
  id: PowerId;
  status: NationStatus;
  /** Base Resource Points (BRPs) at the start of the scenario. */
  brpBase: number;
  /** Current BRP total. */
  brpTotal: number;
  /** Percent growth applied to the base (from the PC game's status screen). */
  growthRate: number;
}

export interface Unit {
  id: string;
  owner: PowerId;
  type: UnitType;
  /**
   * Ground units print "attack-and-defense factor / movement factor" (e.g. 3-4). Air units
   * print "air factor / movement factor"; fleets print a single combat factor.
   */
  strength: number;
  movement: number;
  /** Region id the unit currently occupies. */
  at: string;
}

export interface Region {
  id: string;
  name: string;
  /** Owning power, or null for neutral/minor countries. */
  owner: PowerId | null;
  /** Adjacent region ids. */
  neighbors: string[];
}

export interface GameState {
  /** Calendar year, e.g. 1939. */
  year: number;
  season: Season;
  /** Side that holds the initiative and moves first this game turn. */
  firstSide: Side;
  /** Side currently taking its player turn. */
  activeSide: Side;
  nations: Record<PowerId, Nation>;
  regions: Record<string, Region>;
  units: Record<string, Unit>;
  /** Seed for the deterministic RNG; advanced on every roll. */
  rngState: number;
  log: string[];
}
