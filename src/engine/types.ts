import type { HexId } from "./hex";
import type { Front } from "./map";

export type PowerId = "germany" | "italy" | "ussr" | "britain" | "france" | "usa";

/** The game is played by two sides; each side takes one player turn per game turn. */
export type Side = "axis" | "allies";

/**
 * A major power's alignment. Italy, the USSR and the USA can start neutral. France is
 * "vichy" in the 1942 scenario; Italy and France are "out" of the 1944 scenario.
 */
export type NationStatus = "axis" | "allied" | "neutral" | "vichy" | "out";

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
 * Who owns a force pool: the six Major Powers, Poland (1939 and Campaign), the Free and
 * Vichy French (1942 and 1944), and the four Axis Minor-Allies that start active in 1942
 * and 1944. Minor countries that only appear when attacked use the Minor Country Forces
 * chart instead (tables.ts).
 */
export type ForceOwner = PowerId | "poland" | "free-france" | "vichy-france" | "finland" | "rumania" | "hungary" | "bulgaria";

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
  /** Allowable builds only: the first turn the counter may be built ("in/after Summer '42"). */
  from?: { year: number; season?: Season };
  /** Set when the counter belongs to another nation than the pool's owner (the Italian fleet Germany holds in 1944). */
  nationality?: ForceOwner;
}

/** What a nation may still bring into play: units in its pool and units it may yet build. */
export interface ForcePools {
  /** Counters available to set up at the start of the scenario. */
  forcePool: ForceEntry[];
  /** Counters that may still be constructed during the game (Ref 9.3, 11.5). */
  allowableBuilds: ForceEntry[];
}

/** A named piece of territory that the printed map does not outline, keyed by a scenario's `zones`. */
export type ZoneId = string;

/**
 * Territory the scenario pages name but the printed map card does not draw: the lines the
 * original program overlays at setup (the "scenario start line", the Polish Partition Line,
 * the Vichy zone), and small regions such as islands. `hexes` is null while the hexes are
 * not known; a test lists exactly which zones are still unresolved.
 */
export interface Zone {
  /** Map countries (ids from map.json) the zone lies in. */
  countries: string[];
  description: string;
  hexes: HexId[] | null;
}

/** Where a setup requirement applies. */
export type Area =
  /** Anywhere on that country's land, as named in map data (e.g. "egypt"). */
  | { country: string }
  /** One specific hex. */
  | { hex: HexId }
  /** Any port on that Front. */
  | { ports: Front }
  /** Any hex on that Front. */
  | { front: Front }
  /** An off-map box. */
  | { box: OffMapBox }
  /** A zone defined in the scenario's `zones`. */
  | { zone: ZoneId }
  /** Anywhere in the territory this owner controls at the start. */
  | { controlledBy: ForceOwner };

/** Opening-setup restriction from a scenario page (Ops 9.0). Checked when the player sets up. */
export type SetupRequirement =
  /**
   * At least `count` counters of this kind must be placed, in one of the areas (Ops 4.1:
   * more may go there unless prohibited). Leave `strength` out when any strength will do.
   */
  | { kind: "place"; type: UnitType; strength?: number; count: number; in: Area[] }
  /**
   * Every counter of these types (or of all types) must be placed in the areas. With
   * `nationality`, only counters of that nationality ("own" = the pool owner's).
   */
  | { kind: "all-in"; types: UnitType[] | "all"; nationality?: ForceOwner | "own"; in: Area[] }
  /** Every counter not placed by another requirement must go in these areas. */
  | { kind: "rest-in"; in: Area[] }
  /** At least this many ground and/or air factors on a Front (Ref 29.0 for Germany). */
  | { kind: "min-factors"; front: Front; min: number }
  /** At most this many ground and/or air factors in an area. */
  | { kind: "max-factors"; area: Area; max: number }
  /** At least this many ground factors in or adjacent to any of these hexes. */
  | { kind: "min-ground-factors-near"; hexes: HexId[]; min: number };

/** Extra places a nation's units may set up, beyond the territory it controls at the start. */
export interface SetupPermission {
  areas: Area[];
  /** Restricts the permission to these counter types. */
  types?: UnitType[];
  /** The hexes must also be Axis-controlled at the start (Ref 17.3 for Minor-Allies). */
  axisControlled?: boolean;
}

/** One side of a country-level setup: territory, setup rules and forces. */
export interface NationSetup extends ForcePools {
  /** Whole map countries (ids from src/data/map.json, plus "usa") controlled at the start. */
  controlledAtStart: string[];
  /** Parts of countries controlled at the start, defined in the scenario's `zones`. */
  controlledZones: ZoneId[];
  setup: SetupRequirement[];
  mayAlsoSetUpIn: SetupPermission[];
}

/** Scenario rules that are clear enough to apply by machine. Prose rules go in `notes`. */
export type ScenarioRule =
  /** A Major Power declares war automatically on a turn, paying the BRP cost. */
  | { kind: "automatic-declaration"; by: PowerId; on: ForceOwner; turn: GameTurn; side: Side; brpCost: number }
  /** A side may not attempt a Seaborne Invasion on that turn. */
  | { kind: "no-seaborne-invasion"; side: Side; turn: GameTurn }
  /** No BRP Base growth in the Year Start Sequence of this year. */
  | { kind: "no-brp-growth"; year: number }
  /** Neither side may declare war on a country that is neutral at the start of the scenario. */
  | { kind: "no-war-on-neutrals" }
  /** Units of `side` still in the zone are eliminated at the end of that side's player turn. */
  | { kind: "eliminate-in-zone"; zone: ZoneId; side: Side; turn: GameTurn };

/** Strategic Warfare factors a nation has already built (Ref 9.0, 11.5). */
export interface StrategicWarfare {
  submarines: number;
  /** Anti-submarine warfare factors. */
  asw: number;
  /** Strategic air command factors. */
  sac: number;
}

/** An Axis Minor-Ally of a Major Power, active or not (Ref 17.0). */
export interface MinorAlly {
  owner: ForceOwner;
  of: PowerId;
  active: boolean;
}

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
  pools: Partial<Record<ForceOwner, ForcePools>>;
  /** Pairs at war. Each pair is listed once, in the order the scenario gives it. */
  wars: [ForceOwner, ForceOwner][];
  /** Strategic Warfare factors each Major Power has built. */
  strategicWarfare: Record<PowerId, StrategicWarfare>;
  /** Minor-Allies and whether each is active. */
  minorAllies: MinorAlly[];
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
  /** Territory, setup requirements and forces for every owner that has a force pool (Ops 9.0). */
  forces: Partial<Record<ForceOwner, NationSetup>>;
  /** Order in which owners set up their forces ("Order of deployment"). */
  deploymentOrder: ForceOwner[];
  /** Wars already under way when the scenario starts ("Situation at start"). */
  warsAtStart: [ForceOwner, ForceOwner][];
  /** Axis Minor-Allies at the start. */
  minorAllies: MinorAlly[];
  /** Territory the pages name that the printed map does not outline. */
  zones: Record<ZoneId, Zone>;
  /** Whether the Year Start Sequence that precedes the scenario happens ("Year Start Sequence" entry). */
  startingYss: "none" | "sw-construction-only";
  /** Strategic Warfare factors already built when the scenario starts. */
  startingStrategicWarfare: Partial<Record<PowerId, StrategicWarfare>>;
  rules: ScenarioRule[];
  /** Rules from the manual that are not applied by machine yet, in our own words. */
  notes: string[];
}
