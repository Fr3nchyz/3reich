import type { HexId } from "../engine/hex";

/**
 * What the computer remembers during one game, so that its movement does not dither (computer policy, spec 05). The caller
 * keeps one object per game and passes it in `AiConfig.memory`; a game replayed from its recorded actions needs none.
 */
export interface AiMemory {
  /** The enemy objective each unit is heading for: kept until the unit reaches it or the enemy loses it. */
  targets: Map<string, HexId>;
  /** Hexes each unit left, with the Game Turn index, so that it does not go straight back (see MOVE_NO_RETURN_TURNS in move.ts). */
  left: Map<string, { hex: HexId; turn: number }[]>;
  /** Ground distances to one target for one owner, kept for the Game Turn they were made in. */
  distances: Map<string, Map<HexId, number>>;
  /** The Game Turn index `distances` belongs to. */
  distancesTurn: number;
}

export const createMemory = (): AiMemory => ({ targets: new Map(), left: new Map(), distances: new Map(), distancesTurn: -1 });
