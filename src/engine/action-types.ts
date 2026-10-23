import type { HexId } from "./hex";
import type { CombatRound } from "./combat";
import type { Front } from "./map";
import type { Conquest } from "./conquest-record";
import type { SovietCity } from "./soviet-record";
import type { GameResult } from "./victory-record";
import type { Combatant, ForceOwner, FrontOption, GameState, GameTurn, OffMapBox, PowerId, Season, Side, UnitType } from "./types";

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
  /**
   * Step 8b: build one counter from the nation's Allowable Builds, paying for it, and place it. `unit.returned` picks a counter that came back to the pool
   * after it was lost (spec 17 R2), rather than one of the scenario's builds of the same kind; `pool` names the pool it comes from when that is not the
   * builder's own (Britain builds the Free French losses, TODO(verify) RB10), and the counter built is that pool's.
   */
  | { type: "BUILD"; owner: PowerId; pool?: ForceOwner; unit: { type: UnitType; strength: number; returned?: true }; at: HexId | OffMapBox }
  /** Step 9a: grant BRPs to an allied Major Power. */
  | { type: "GRANT_BRPS"; from: PowerId; to: PowerId; amount: number }
  /** Step II.A: the Allies decide whether the Russian winter waits for next year (`postpone`) or starts now; legal only when the dice allowed it (spec 14 R10; Ref 28.0). */
  | { type: "CHOOSE_WINTER"; side: "allies"; postpone: boolean }
  /** Step 8a: the Allies take one infantry or armor counter from the Russian Force Pool, free of charge, and place it in a Russian city (the Free Siberian Transfer, spec 14 R11; Ref 11.63). */
  | { type: "SIBERIAN_TRANSFER"; side: "allies"; unit: { type: UnitType; strength: number }; at: HexId }
  /** Step 10a: the Axis answers Russia's one-time offer to surrender, accepting it or refusing it (spec 14 R7b to R7d; Ref 11.8, 18.41). Legal only while the offer waits, and only for the Axis. */
  | { type: "SURRENDER_ANSWER"; side: "axis"; accept: boolean }
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
  /** Step 6g or 9j: the side settles every overstacked hex of its own, choosing the units to eliminate hex by hex, no more than needed (spec 16 R15; Ops 5.45g, 5.48j). */
  | { type: "ELIMINATE_OVERSTACK"; side: Side; choices: Record<HexId, string[]> }
  /** Step 9e: ground units and Replacements are redeployed to a hex of their region, one use of their nation's allowance each (Ref 11.72; spec 16 R18 to R20). `escort` (a Sea Escort fleet) is ticket 16-21 and is refused until then. */
  | { type: "SR_UNITS"; side: Side; units: string[]; to: HexId; escort?: string }
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
  /** A fleet left alone in a port that was taken moved to the nearest friendly port with room (`to`), or was eliminated because there was none (`to` null) (spec 12 R9). */
  | { type: "FLEET_DISPLACED"; unitId: string; owner: ForceOwner; from: HexId; to: HexId | null }
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
  /** `owner` paid; `returned` marks a counter bought back from the pool (spec 17 R2), `pool` the pool it came from when it is not the payer's (RB10). */
  | { type: "UNIT_BUILT"; unitId: string; owner: PowerId; unitType: UnitType; strength: number; at: HexId | OffMapBox; cost: number; returned?: true; pool?: ForceOwner }
  | { type: "BRPS_GRANTED"; from: PowerId; to: PowerId; amount: number }
  /** One ground attack resolved: the odds, every die roll and how it ended (Ref 12.1-12.2). */
  | { type: "COMBAT_RESOLVED"; side: Side; target: HexId; attackers: string[]; attackFactors: number; defenseFactors: number; multiplier: number; rounds: CombatRound[]; outcome: "attacker-eliminated" | "defender-eliminated" | "exchange"; sweep?: true; /** Air factors of ground support inside `attackFactors`. */ airFactors?: number }
  /** Counters that cannot defend on the ground (air units, airbases...) were destroyed alone in a hex (ALONE_NONGROUND_DESTROYED, attack-rules.ts). Each also has a UNIT_ELIMINATED event. Fleets alone in the hex are not in this list: they are displaced (FLEET_DISPLACED), unless FLEETS_DISPLACED_ON_CAPTURE is off. */
  | { type: "UNITS_SWEPT"; hex: HexId; units: { id: string; owner: ForceOwner; type: UnitType; strength: number }[] }
  | { type: "UNIT_ELIMINATED"; unitId: string; owner: ForceOwner; at: HexId; reason?: "unsupplied" }
  /** A unit just eliminated (the UNIT_ELIMINATED, OVERSTACK_ELIMINATED or FLEET_DISPLACED event before it) went back to the Force Pool `pool`, to be built again (spec 17 R1; losses.ts). */
  | { type: "UNIT_RETURNED_TO_POOL"; unitId: string; owner: ForceOwner; unitType: UnitType; strength: number; at: HexId | OffMapBox; pool: ForceOwner }
  /** A unit just eliminated is out of the game for good, and why (spec 17 R4; losses.ts). Units removed by a conquest have UNITS_REMOVED_BY_CONQUEST instead. */
  | { type: "UNIT_LOST_FOR_GOOD"; unitId: string; owner: ForceOwner; unitType: UnitType; strength: number; at: HexId | OffMapBox; reason: LostReason }
  | { type: "LOSSES_CHOSEN"; side: Side; units: string[] }
  /** Step 6f: units moved along a path (the hexes entered, in order). */
  | { type: "UNITS_MOVED"; units: string[]; from: HexId; to: HexId; path: HexId[] }
  /** Step 9e: units of one nation left one hex for another by Strategic Redeployment; `left` is what the nation's allowance has left (spec 16 C4). */
  | { type: "UNITS_REDEPLOYED"; units: string[]; from: HexId; to: HexId; nation: PowerId; left: number; escort?: string }
  | { type: "UNITS_ADVANCED"; units: string[]; from: HexId[]; to: HexId }
  /** Spec 14 R4: an enemy ground unit took a Major Power's capital. The Power falls at the end of its own next Combat Phase unless it takes the capital back. */
  | { type: "CAPITAL_LOST"; power: PowerId; capital: HexId; by: ForceOwner }
  /** The Axis took Moscow or Leningrad for the first time (spec 14 R7a): Germany gains `amount` BRPs and the U.S.S.R. loses `lost` (less than `amount` when it had less). */
  | { type: "RUSSIA_BRPS_MOVED"; city: SovietCity; amount: number; lost: number }
  /** The Power took its capital back (or its side did), so it does not fall. */
  | { type: "CAPITAL_RETAKEN"; power: PowerId; capital: HexId }
  /** A country was conquered (spec 14 R4, C8): `unitsRemoved` left the game, `hexesPassed` hexes went to `by`. */
  | { type: "COUNTRY_CONQUERED"; country: Conquest["country"]; by: ForceOwner; how: Conquest["how"]; unitsRemoved: number; hexesPassed: number }
  /** The units that left the game with a conquered country, in one event (like UNITS_SWEPT, but with no UNIT_ELIMINATED for each). */
  | { type: "UNITS_REMOVED_BY_CONQUEST"; country: Conquest["country"]; units: { id: string; owner: ForceOwner; type: UnitType; strength: number }[] }
  /** Hexes of a conquered country changed control in one go: to the conqueror, or (`to` null) to nobody until a ground unit enters. */
  | { type: "CONTROL_PASSED"; country: Conquest["country"]; to: ForceOwner | null; hexes: HexId[] }
  /**
   * France fell and Vichy France was created (spec 14 R5, ticket 14-7; Ref 35.0), written after the fall's own events: `halved` counts the French units of European
   * France that became Vichy (`kept`) and those that were lost with France (`lost`); `colonies` gives the die of each colony, even (Vichy) or odd (Free French);
   * `britishEliminated` counts the British units that stood in Vichy territory. The hexes that became Vichy or Free French are in CONTROL_PASSED events of their own.
   */
  | { type: "VICHY_CREATED"; halved: { kept: number; lost: number }; colonies: { colony: "lebanon-syria" | "north-africa"; die: number; becomes: "vichy" | "free-french" }[]; britishEliminated: number }
  /** Step II.A: four dice were rolled and the Axis ground units east of the Russian border counted (spec 14 R10); `mayPostpone` is `axisUnits < total`. */
  | { type: "WINTER_ROLLED"; dice: number[]; total: number; axisUnits: number; mayPostpone: boolean }
  /** The Allies put the Russian winter off to the next Winter Game Turn. */
  | { type: "WINTER_POSTPONED"; turn: GameTurn }
  /** The Russian winter is in force from this Game Turn: `postponedFrom` is the turn it was put off from, `early` that the U.S.S.R. declared war on Germany in this Winter turn. */
  | { type: "WINTER_STARTED"; turn: GameTurn; postponedFrom?: GameTurn; early?: true }
  /** Step 10a: Russia offers to surrender (spec 14 R7b): `russian` ground and air factors on the map against `axis` Axis factors inside Russia. The Axis answers (SURRENDER_ANSWER). */
  | { type: "RUSSIA_OFFERS_SURRENDER"; russian: number; axis: number }
  /** The Axis accepted: the U.S.S.R. leaves the war (spec 14 R7c). Its conquest and the credited Objectives are written after it. */
  | { type: "RUSSIA_SURRENDERED" }
  /** The Axis refused; the offer is not made again, and Russia is conquered when its last factor inside Russia is gone (spec 14 R7d). */
  | { type: "SURRENDER_REFUSED" }
  /** After a surrender these Objectives count for the Allies for good (spec 14 R7c, R1). */
  | { type: "OBJECTIVES_CREDITED"; hexes: HexId[] }
  /** Step 8a: the Allies took a unit in the Free Siberian Transfer (spec 14 R11): `left` units may still be taken this Game Turn; `firstUse` marks the unit that switched the victory tables (the Allied targets are one Objective higher from then on). */
  | { type: "SIBERIAN_TRANSFER_USED"; unitId: string; unitType: UnitType; strength: number; at: HexId; left: number; firstUse: boolean }
  /** The game is over: the scenario has ended after this Game Turn, or (`result.early`) a conquest decided it at once; `result` is who won (spec 14 R3). */
  | { type: "GAME_OVER"; year: number; season: Season; result: GameResult };

/**
 * Why a lost unit does not go back to a pool (spec 17 R4; losses.ts): its nation is out of the game or has no pool (RB14); it belongs to a minor country that is
 * not an active Minor-Ally (RB9); it is a counter no pool holds, an airbase or a bridgehead (RB15); its nation's fleets are never rebuilt (Ref 11.62); it is a
 * partial fleet (RB5).
 */
export type LostReason = "out-of-game" | "minor-country" | "not-in-pool" | "fleet-never-rebuilt" | "partial-fleet";

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };
