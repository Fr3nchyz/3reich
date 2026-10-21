import type { HexId } from "./hex";
import type { Front } from "./map";
import type { CombatRecord } from "./combat-record";
import type { MoveRecord } from "./move-record";
import type { AirFlown, AirState } from "./air-record";
import type { NavalState } from "./naval-record";
import type { Conquest } from "./conquest-record";
import type { SiberianRecord } from "./soviet-record";
import type { GameResult, VictoryRecord, VictoryRules } from "./victory-record";

/** Minor countries that can be attacked, each with forces on the Minor Country Forces chart (Ref 14.0). */
export type MinorCountry =
  | "arabia" | "belgium" | "bulgaria" | "denmark" | "finland" | "greece" | "hungary"
  | "ireland" | "luxembourg" | "netherlands" | "norway" | "persia" | "poland"
  | "portugal" | "rumania" | "spain" | "sweden" | "turkey" | "yugoslavia";

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
  /** Base Resource Points (BRPs): the printed Base at the start of the scenario, grown by each Year Start Sequence (Ref 9.2). */
  brpBase: number;
  /** Current BRP total. */
  brpTotal: number;
  /** Percent growth applied to unused BRPs at the Year Start Sequence (Ref 9.2). */
  growthRate: number;
  /**
   * Most the nation may spend in one Player Turn: half its total after the Year Start Sequence,
   * fractions rounded down, fixed for the year (Ref 10.0). It does not fall as the nation spends.
   */
  spendLimit: number;
  /** BRPs spent so far in the current Player Turn; reset when a Player Turn begins. */
  spent: number;
  /** BRPs this nation has granted in the current year; reset by the Year Start Sequence (Ref 11.71: at most half the yearly allotment). Absent means 0. */
  grantedThisYear?: number;
}

/** Off-map boxes printed on the map. */
export type OffMapBox = "us-box" | "murmansk-box";

export interface Unit {
  id: string;
  /** Who controls the counter: a Major Power, Minor-Ally or minor country. */
  owner: ForceOwner;
  /** Set when the counter belongs to another nation than its owner (the Italian fleet Germany holds in 1944). */
  nationality?: ForceOwner;
  type: UnitType;
  /**
   * Ground units print "attack-and-defense factor / movement factor" (e.g. 3-4). Air units
   * print "air factor / movement factor"; fleets print a single combat factor.
   */
  strength: number;
  /** Absent for fleets and replacements, which print a single factor. */
  movement?: number;
  /** Hex id (e.g. "K21") or an off-map box. */
  at: HexId | OffMapBox;
}

/**
 * Where the game is. "setup" is the opening deployment (Ops 4.0), "player-turn" the sequence
 * of play (see sequence.ts; the steps inside a player turn are added as their rules are
 * implemented, see docs/ROADMAP.md), "game-over" the end of the scenario.
 */
export type Phase = "setup" | "player-turn" | "game-over";

/**
 * Where in the Game Turn the game is (Ops 5.0): the Year Start Sequence, the Russian-Winter
 * roll (II.A), the order of the two sides (II.B), or a step of a Player Turn (`turn` 1 is the
 * side with the Initiative). The game-level parts are passed through at once today; they are
 * kept in the type so a saved game and later rules can name them.
 */
export type TurnPosition =
  | { part: "year-start" }
  | { part: "russian-winter" }
  | { part: "turn-order" }
  | { part: "player-turn"; turn: 1 | 2; step: string };

/** Opening deployment: each owner sets up in the scenario's order of deployment (Ops 4.1, 7.0). */
export interface SetupProgress {
  order: ForceOwner[];
  /** Index into `order` of the owner now setting up. */
  index: number;
}

/**
 * Who owns a force pool: the six Major Powers, Poland (1939 and Campaign), the Free and
 * Vichy French (1942 and 1944), and the four Axis Minor-Allies that start active in 1942
 * and 1944. Minor countries that only appear when attacked use the Minor Country Forces
 * chart instead (tables.ts).
 */
export type ForceOwner = PowerId | "poland" | "free-france" | "vichy-france" | "finland" | "rumania" | "hungary" | "bulgaria";

/** Anyone that can be at war: an owner of forces, or a minor country that has none in a scenario. */
export type Combatant = ForceOwner | MinorCountry;

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
  | { kind: "country"; id: string }
  /** One specific hex. */
  | { kind: "hex"; id: HexId }
  /** Any port on that Front. */
  | { kind: "ports"; front: Front }
  /** Any hex on that Front. */
  | { kind: "front"; front: Front }
  /** An off-map box. */
  | { kind: "box"; box: OffMapBox }
  /** A zone defined in the scenario's `zones`. */
  | { kind: "zone"; id: ZoneId }
  /** Anywhere in the territory this owner controls at the start. */
  | { kind: "controlled-by"; owner: ForceOwner };

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
  /**
   * At least this many ground and/or air factors on a Front (Ref 29.0 for Germany). Only the
   * owner's own units count. `alsoCountsAdjacentTo`: for the opening setup, units on the Western
   * Front next to this country's border count too; `excludeCountries`: units there do not count.
   */
  | { kind: "min-factors"; front: Front; min: number; alsoCountsAdjacentTo?: string; excludeCountries?: string[] }
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
  | { kind: "automatic-declaration"; by: PowerId; on: Combatant; turn: GameTurn; side: Side; brpCost: number }
  /** A side may not attempt a Seaborne Invasion on that turn. */
  | { kind: "no-seaborne-invasion"; side: Side; turn: GameTurn }
  /** No BRP Base growth in the Year Start Sequence of this year. */
  | { kind: "no-brp-growth"; year: number }
  /** Neither side may declare war on a country that is neutral at the start of the scenario. */
  | { kind: "no-war-on-neutrals" }
  /** Units of `side` still in the zone are eliminated at the end of that side's player turn. */
  | { kind: "eliminate-in-zone"; zone: ZoneId; side: Side; turn: GameTurn }
  /** `side` may choose this Option on this Front on that turn without paying (Ref 29.0 for Germany's opening Eastern Front Offensive Option). */
  | { kind: "free-front-option"; side: Side; front: Front; option: FrontOption; turn: GameTurn };

/**
 * What a side may do on a Front in its Player Turn (Ref 11.21): the Offensive Option costs BRPs
 * (BRP_COSTS.offensiveOption), the Attrition and Defensive Options cost nothing (spec 02).
 */
export type FrontOption = "offensive" | "attrition" | "defensive";

/** A Front Option chosen for the Player Turn in progress; `paidBy` is the Major Power that paid for an Offensive Option. */
export interface FrontChoice {
  option: FrontOption;
  paidBy?: PowerId;
}

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
  /** Null while `phase` is "setup"; otherwise where in the Game Turn the game stands. */
  position: TurnPosition | null;
  nations: Record<PowerId, Nation>;
  /** Counters still in each owner's pool, and what each may still build. */
  pools: Partial<Record<ForceOwner, ForcePools>>;
  /** Pairs at war. Each pair is listed once, in the order the scenario gives it. */
  wars: [Combatant, Combatant][];
  /** Strategic Warfare factors each Major Power has built. */
  strategicWarfare: Record<PowerId, StrategicWarfare>;
  /** Minor-Allies and whether each is active. */
  minorAllies: MinorAlly[];
  /** Present while `phase` is "setup"; null once play has begun. */
  setup: SetupProgress | null;
  units: Record<string, Unit>;
  /** Next number to use in a unit id ("u1", "u2", ...). */
  nextUnitId: number;
  /** BRP grants made in the current Player Turn (Ref 11.71); cleared when a Player Turn begins. */
  grants: { from: PowerId; to: PowerId; amount: number }[];
  /** [giver, receiver] pairs that may not grant: whoever received a grant may not grant back to the giver (Ref 11.71). */
  noGrants: [PowerId, PowerId][];
  /** Front Options the side to move has chosen this Player Turn (Ref 11.21); cleared when a Player Turn begins. A Front not listed has no choice yet. */
  frontOptions: Partial<Record<Front, FrontChoice>>;
  /** Hexes that currently have Fortress status (Ref 4.8). */
  fortresses: Record<HexId, boolean>;
  /** Ids of the side-to-move's ground units that were out of supply when its Player Turn began (Ref 19.4, 12.21); they cannot move or advance, and are eliminated at the end of the turn if still cut off. Absent: none. */
  unsuppliedAtStart?: string[];
  /** Ground combat so far in the current Player Turn (step 7h); absent until the first attack. */
  combat?: CombatRecord;
  /** What the air rules have recorded this Player Turn (spec 09); absent in an older saved game. */
  air?: AirState;
  /** How many movable airbases each Major Power has set down in the whole game, destroyed ones included (Ref 20.1: three each); absent means none. */
  airbasesPlaced?: Partial<Record<PowerId, number>>;
  /** The air units that have used their mission this Game Turn (spec 09 R5); absent in an older saved game. */
  airFlown?: AirFlown;
  /** What the fleet rules have recorded (spec 12): fleets used this Game Turn, and this Player Turn's lists; absent in an older saved game. */
  naval?: NavalState;
  /** Units that have moved in the current Player Turn (step 6f); absent until the first move. */
  moves?: MoveRecord;
  /** Countries that have been conquered, in order (spec 14); absent in an older saved game, and until the conquest rules are built: nobody has been conquered. */
  conquests?: Conquest[];
  /** The Free Siberian Transfer so far (spec 14 R11); `used` switches the victory tables. Absent: not used. */
  siberian?: SiberianRecord;
  /** What the victory rules remember during play (spec 14): the Campaign's Winter 1943 Objective count. Absent: nothing yet. */
  victory?: VictoryRecord;
  /** Who won, set once, together with the phase "game-over" (spec 14 R3). Absent while the game is on, and in a game over saved before this existed. */
  result?: GameResult;
  /**
   * Hexes whose controller differs from the scenario's "controlled at start" territory (Ref 7.0;
   * see control.ts). Empty at the start: read control through `controllerOf`, not this record.
   */
  control: Record<HexId, ForceOwner>;
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
  warsAtStart: [Combatant, Combatant][];
  /** Axis Minor-Allies at the start. */
  minorAllies: MinorAlly[];
  /** Territory the pages name that the printed map does not outline. */
  zones: Record<ZoneId, Zone>;
  /** Whether the Year Start Sequence that precedes the scenario happens ("Year Start Sequence" entry). */
  startingYss: "none" | "sw-construction-only";
  /** Strategic Warfare factors already built when the scenario starts. */
  startingStrategicWarfare: Partial<Record<PowerId, StrategicWarfare>>;
  rules: ScenarioRule[];
  /** How the scenario is won (Ref 2.1 to 2.4; data in src/data/victory.ts). */
  victory: VictoryRules;
  /** Rules from the manual that are not applied by machine yet, in our own words. */
  notes: string[];
}
