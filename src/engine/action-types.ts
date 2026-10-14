import type { HexId } from "./hex";
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
  | { type: "GAME_OVER"; year: number; season: Season };

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };
