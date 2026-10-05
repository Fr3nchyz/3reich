import type { HexId } from "./hex";
import type { Front } from "./map";

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

/**
 * Who owns a force pool. The six Major Powers, plus Poland, whose forces the 1939 and
 * Campaign scenarios define. Later scenarios may add more minor countries.
 */
export type ForceOwner = PowerId | "poland";

/**
 * A stack of identical counters, as the scenario pages print them ("3-4 infantry x3").
 * Ground and air counters print strength then movement; fleets and replacements print a
 * single factor, so `movement` is left out.
 */
export interface ForceEntry {
  type: UnitType;
  strength: number;
  movement?: number;
  count: number;
}

/** What a nation may still bring into play: units in its pool and units it may yet build. */
export interface ForcePools {
  /** Counters available to set up at the start of the scenario. */
  forcePool: ForceEntry[];
  /** Counters that may still be constructed during the game (Ref 9.3, 11.5). */
  allowableBuilds: ForceEntry[];
}

/** Where a setup requirement applies. */
export type Area =
  /** Anywhere on that country's land, as named in map data (e.g. "egypt"). */
  | { country: string }
  /** One specific hex. */
  | { hex: HexId }
  /** Any port on that Front. */
  | { ports: Front }
  /** An off-map box. */
  | { box: OffMapBox };

/** Opening-setup restriction from a scenario page (Ops 9.0). Checked when the player sets up. */
export type SetupRequirement =
  /** Exactly `count` counters of this kind must be placed, in one of the areas. */
  | { kind: "place"; type: UnitType; strength: number; count: number; in: Area[] }
  /** Every counter of these types (or of all types) must be placed in the areas. */
  | { kind: "all-in"; types: UnitType[] | "all"; in: Area[] }
  /** At least this many ground and/or air factors on a Front (Ref 29.0 for Germany). */
  | { kind: "min-factors"; front: Front; min: number }
  /** At most this many ground and/or air factors in an area. */
  | { kind: "max-factors"; area: Area; max: number };

/** One side of a country-level setup: territory, setup rules and forces. */
export interface NationSetup extends ForcePools {
  /** Map countries (ids from src/data/map.json, plus "usa") controlled at the start. */
  controlledAtStart: string[];
  setup: SetupRequirement[];
}

/** Scenario rules that are clear enough to apply by machine. Prose rules go in `notes`. */
export type ScenarioRule =
  /** A Major Power declares war automatically on a turn, paying the BRP cost. */
  | { kind: "automatic-declaration"; by: PowerId; on: ForceOwner; turn: GameTurn; side: Side; brpCost: number }
  /** A side may not attempt a Seaborne Invasion on that turn. */
  | { kind: "no-seaborne-invasion"; side: Side; turn: GameTurn }
  /** No BRP Base growth in the Year Start Sequence of this year. */
  | { kind: "no-brp-growth"; year: number };

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
  /** Counters still in each owner's pool, and what each may still build. */
  pools: Record<ForceOwner, ForcePools>;
  /** Pairs at war. Each pair is listed once, in the order the scenario gives it. */
  wars: [ForceOwner, ForceOwner][];
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
  /** Territory, setup requirements and forces for every owner (Ops 9.0). */
  forces: Record<ForceOwner, NationSetup>;
  /** Order in which owners set up their forces ("Order of deployment"). */
  deploymentOrder: ForceOwner[];
  /** Wars already under way when the scenario starts ("Situation at start"). */
  warsAtStart: [ForceOwner, ForceOwner][];
  rules: ScenarioRule[];
  /** Rules from the manual that are not applied by machine yet, in our own words. */
  notes: string[];
}
