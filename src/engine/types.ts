import type { HexId } from "./hex";

export type PowerId = "germany" | "italy" | "ussr" | "britain" | "france" | "usa";

/** The game is played by two sides; each side takes one player turn per game turn. */
export type Side = "axis" | "allies";

/** A major power's alignment. Italy, the USSR and the USA can start neutral. */
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

export interface GameTurn {
  year: number;
  season: Season;
}

export interface Nation {
  id: PowerId;
  status: NationStatus;
  /** Base Resource Points (BRPs) at the start of the scenario. */
  brpBase: number;
  /** Current BRP total. */
  brpTotal: number;
  /** Percent growth applied to unused BRPs at the Year Start Sequence (Ref 9.2). */
  growthRate: number;
}

/** Off-map boxes printed on the map. */
export type OffMapBox = "us-box" | "murmansk-box";

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
  /** Hex id (e.g. "K21") or an off-map box. */
  at: HexId | OffMapBox;
}

/**
 * Where the game is in the sequence of play. Steps inside a player turn (declarations
 * of war, front options, movement, combat, construction, redeployment) are added with
 * the phase machine; see docs/ROADMAP.md.
 */
export type Phase = "player-turn" | "game-over";

/** Complete, JSON-serializable game state. Engine functions never mutate it. */
export interface GameState {
  scenarioId: string;
  year: number;
  season: Season;
  /** Last Game Turn of the scenario (inclusive). */
  lastTurn: GameTurn;
  /** Side holding the Initiative: it takes the first Player Turn of this Game Turn (Ref 11.1). */
  firstSide: Side;
  /** Side currently taking its Player Turn. */
  activeSide: Side;
  phase: Phase;
  nations: Record<PowerId, Nation>;
  units: Record<string, Unit>;
  /** Hexes that currently have Fortress status (Ref 4.8). */
  fortresses: Record<HexId, boolean>;
  /** Deterministic RNG state; advanced on every roll. */
  rngState: number;
}

/** Static definition of a scenario (Ops 9.0). */
export interface Scenario {
  id: string;
  name: string;
  start: GameTurn;
  end: GameTurn;
  /** Side that moves first in the opening Game Turn ("Situation at start"). */
  firstSide: Side;
  nations: Record<PowerId, Nation>;
}
