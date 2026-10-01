export type PowerId = "germany" | "italy" | "ussr" | "britain" | "france" | "usa";

export type UnitType = "infantry" | "armor" | "air" | "fleet";

export type Season = "spring" | "summer" | "fall" | "winter";

export interface Unit {
  id: string;
  owner: PowerId;
  type: UnitType;
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
  /** Index into the turn order of the power currently acting. */
  activePower: PowerId;
  regions: Record<string, Region>;
  units: Record<string, Unit>;
  /** Seed for the deterministic RNG; advanced on every roll. */
  rngState: number;
  log: string[];
}
