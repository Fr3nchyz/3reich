import type { HexId } from "./hex";
import type { ForceOwner, GameState, OffMapBox, Season, Side, UnitType } from "./types";

/**
 * Everything a player (human or computer) can do is an Action. Actions are plain,
 * JSON-serializable objects; a game is fully described by its starting state, its context
 * (map and scenario) and the list of actions applied to it.
 */
export type Action =
  | { type: "END_PLAYER_TURN"; side: Side }
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
  | { type: "SETUP_OWNER_DONE"; owner: ForceOwner }
  | { type: "SETUP_COMPLETE" }
  | { type: "INITIATIVE_DETERMINED"; year: number; season: Season; firstSide: Side; axis: number; allies: number }
  | { type: "PLAYER_TURN_STARTED"; year: number; season: Season; side: Side }
  | { type: "GAME_OVER"; year: number; season: Season };

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };
