import type { HexId } from "./hex";
import type { CombatRound } from "./combat";
import type { Front } from "./map";
import type { Combatant, ForceOwner, FrontOption, GameState, OffMapBox, PowerId, Season, Side, UnitType } from "./types";

/**
 * Everything a player (human or computer) can do is an Action. Actions are plain,
 * JSON-serializable objects; a game is fully described by its starting state, its context
 * (map and scenario) and the list of actions applied to it.
 */
export type Action =
  /** Done with the Player Turn; legal only at its last step (10b). */
  | { type: "END_PLAYER_TURN"; side: Side }
  /** Done with a step that has rules built; `step` is the step being left, so a stale action is refused. */
  | { type: "END_STEP"; side: Side; step: string }
  /** Step 1: a Major Power declares war on another Major Power (35 BRPs) or a minor country (10). */
  | { type: "DECLARE_WAR"; by: PowerId; on: Combatant }
  /** Step 3: the side to move chooses its Option on one Front (Ref 11.21); `payer` is the Major Power that pays for an Offensive Option, left out when it is free. */
  | { type: "SELECT_FRONT_OPTION"; side: Side; front: Front; option: FrontOption; payer?: PowerId }
  /** Step 8b: build one counter from the nation's Allowable Builds, paying for it, and place it. */
  | { type: "BUILD"; owner: PowerId; unit: { type: UnitType; strength: number }; at: HexId | OffMapBox }
  /** Step 9a: grant BRPs to an allied Major Power. */
  | { type: "GRANT_BRPS"; from: PowerId; to: PowerId; amount: number }
  /** Step 7h: ground units attack an adjacent enemy hex (Ref 12.1; each unit attacks one hex, PC README 14.23). */
  | { type: "ATTACK"; side: Side; units: string[]; target: HexId }
  /** Step 7h: the side that must lose factors after an Exchange chooses which of its units go (Ref 12.2). */
  | { type: "ALLOCATE_LOSSES"; side: Side; units: string[] }
  /** Step 7h: attackers advance into the hex the defenders left (TODO(verify) in attack.ts). */
  | { type: "ADVANCE"; side: Side; units: string[]; to: HexId }
  /** Step 6f: a unit, or units standing together, move along a path of adjacent hexes (start excluded; Ref 5.45f). */
  | { type: "MOVE"; side: Side; units: string[]; path: HexId[] }
  /** Step 6f or opening setup: a Major Power sets one of its three movable airbases down in a hex its side controls and supplies (Ref 20.1, 11.3). */
  | { type: "PLACE_AIRBASE"; owner: PowerId; at: HexId }
  /** Step 6f: air units standing together change base, up to 8 hexes, to a base the side held at the start of its turn (Ref 20.2). */
  | { type: "STAGE_AIR"; side: Side; units: string[]; to: HexId }
  /** Step 6f (or 7b): one air unit is split into smaller counters, factors conserved (Ref 20.6). */
  | { type: "SPLIT_AIR"; side: Side; unit: string; parts: number[] }
  /** Step 6f (or 7b): air units of one nationality in one hex are combined into one counter (Ref 20.6). */
  | { type: "COMBINE_AIR"; side: Side; units: string[] }
  /** Step 6e or 9f: fleets of one port carry supply to a port or island for units cut off from their sources (Ref 19.31); `from` is where the fleets stand. */
  | { type: "DESIGNATE_SEA_SUPPLY"; side: Side; fleets: string[]; to: HexId; units: string[] }
  /** Step 7b: air units are committed to ground support of a hex that will be attacked (Ref 20.41). */
  | { type: "DESIGNATE_AIR"; side: Side; mission: "ground-support"; units: string[]; target: HexId }
  /** Opening setup: set up one counter from the owner's Force Pool (Ops 4.1). */
  | { type: "SETUP_PLACE"; owner: ForceOwner; unit: { type: UnitType; strength: number; nationality?: ForceOwner }; at: HexId | OffMapBox }
  /** Opening setup: take a counter back off the map into the Force Pool. */
  | { type: "SETUP_REMOVE"; owner: ForceOwner; unitId: string }
  /** Opening setup: this owner has finished placing its forces ("Done"). */
  | { type: "SETUP_DONE"; owner: ForceOwner };

/** What happened as a result of an action, for the UI and the log. */
export type GameEvent =
  | { type: "UNIT_PLACED"; unitId: string; owner: ForceOwner; at: HexId | OffMapBox }
  | { type: "UNIT_REMOVED"; unitId: string; owner: ForceOwner }
  | { type: "AIRBASE_PLACED"; unitId: string; owner: PowerId; at: HexId }
  /** Step 7b: air units were committed to ground support of a hex (Ref 20.41); they have flown their mission for the Game Turn. */
  | { type: "AIR_MISSION_DESIGNATED"; mission: "ground-support"; units: string[]; target: HexId }
  /** Step 7h ended and the hex was not attacked: its committed ground support is eliminated (Ref 20.41). Each unit also has a UNIT_ELIMINATED event. */
  | { type: "GROUND_SUPPORT_LOST"; hex: HexId; units: { id: string; owner: ForceOwner; strength: number }[] }
  /** Air counters were split or combined: the counters before and after, in one hex (Ref 20.6). */
  | { type: "AIR_RESHAPED"; at: HexId; before: { id: string; strength: number }[]; after: { id: string; strength: number }[] }
  /** Step 6f: air units changed base (a straight move of counters; no control changes). */
  | { type: "AIR_STAGED"; units: string[]; from: HexId; to: HexId }
  /** Step 6e or 9f: fleets were named to carry supply from their port to a place for these units (Ref 19.31); the fleets have used their Game Turn. */
  | { type: "FLEET_DESIGNATED_FOR_SUPPLY"; fleets: string[]; from: HexId; to: HexId; units: string[] }
  /** A Player Turn ended and a sea supply named in it no longer holds (a fleet lost, the port cut off, the place taken, a unit gone); `reason` is the rule it now breaks. */
  | { type: "SEA_SUPPLY_LAPSED"; fleets: string[]; from: HexId; to: HexId; units: string[]; reason: string }
  /** Ref 7.0: a hex changed hands because a ground unit entered it. */
  | { type: "HEX_CONTROL_CHANGED"; hex: HexId; from: ForceOwner | null; to: ForceOwner; unitId: string }
  /** Ops 5.45g, 5.48j: a unit the owner chose was eliminated because its hex was overstacked. */
  | { type: "OVERSTACK_ELIMINATED"; unitId: string; owner: ForceOwner; at: HexId }
  | { type: "SETUP_OWNER_DONE"; owner: ForceOwner }
  | { type: "SETUP_COMPLETE" }
  | { type: "INITIATIVE_DETERMINED"; year: number; season: Season; firstSide: Side; axis: number; allies: number }
  | { type: "PLAYER_TURN_STARTED"; year: number; season: Season; side: Side }
  /** Steps with no rules built yet that the engine passed without asking (ids as on the card). */
  | { type: "STEPS_PASSED"; steps: string[] }
  /** A nation's BRP total changed; `delta` is negative for spending. */
  | { type: "BRPS_CHANGED"; nation: PowerId; delta: number; total: number; reason: string }
  | { type: "FRONT_OPTION_SELECTED"; side: Side; front: Front; option: FrontOption; cost: number }
  | { type: "WAR_DECLARED"; by: PowerId; on: Combatant; cost: number }
  | { type: "UNIT_BUILT"; unitId: string; owner: PowerId; unitType: UnitType; strength: number; at: HexId | OffMapBox; cost: number }
  | { type: "BRPS_GRANTED"; from: PowerId; to: PowerId; amount: number }
  /** One ground attack resolved: the odds, every die roll and how it ended (Ref 12.1-12.2). */
  | { type: "COMBAT_RESOLVED"; side: Side; target: HexId; attackers: string[]; attackFactors: number; defenseFactors: number; multiplier: number; rounds: CombatRound[]; outcome: "attacker-eliminated" | "defender-eliminated" | "exchange"; sweep?: true; /** Air factors of ground support inside `attackFactors`. */ airFactors?: number }
  /** Counters that cannot defend on the ground (air units, fleets...) were destroyed alone in a hex (ALONE_NONGROUND_DESTROYED, attack-rules.ts). Each also has a UNIT_ELIMINATED event. */
  | { type: "UNITS_SWEPT"; hex: HexId; units: { id: string; owner: ForceOwner; type: UnitType; strength: number }[] }
  | { type: "UNIT_ELIMINATED"; unitId: string; owner: ForceOwner; at: HexId; reason?: "unsupplied" }
  | { type: "LOSSES_CHOSEN"; side: Side; units: string[] }
  /** Step 6f: units moved along a path (the hexes entered, in order). */
  | { type: "UNITS_MOVED"; units: string[]; from: HexId; to: HexId; path: HexId[] }
  | { type: "UNITS_ADVANCED"; units: string[]; from: HexId[]; to: HexId }
  | { type: "GAME_OVER"; year: number; season: Season };

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };
