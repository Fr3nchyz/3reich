import type { HexId } from "../engine/hex";
import type { Side } from "../engine/types";

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
  /** Per owner and set of enemy-held objectives: the ground distance to the nearest one and which it is, kept for the same Game Turn. */
  nearest: Map<string, { dist: Map<HexId, number>; from: Map<HexId, HexId> }>;
  /** The same for the waiting places of units with no way to an enemy objective (see `stagingTargets` in geo.ts). */
  staging: Map<string, { dist: Map<HexId, number>; from: Map<HexId, HexId> }>;
  /** The Game Turn index `distances`, `nearest` and `staging` belong to. */
  distancesTurn: number;
  /** Per side, the Game Turn index of its last real ground attack (or the first turn it was asked to choose one): how long it has been quiet. */
  quietSince: Partial<Record<Side, number>>;
  /** Per side, the Game Turn index in which the stall rule lifted the Exchange limit (it stays lifted for that whole turn). */
  stallTurn: Partial<Record<Side, number>>;
}

export const createMemory = (): AiMemory => ({ targets: new Map(), left: new Map(), distances: new Map(), nearest: new Map(), staging: new Map(), distancesTurn: -1, quietSince: {}, stallTurn: {} });

/** Plain save data for persistent policy memory (spec 11 part B, ticket 11-3). */
export interface SavedMemory {
  targets: [string, HexId][];
  left: [string, { hex: HexId; turn: number }[]][];
  quietSince: Partial<Record<Side, number>>;
  stallTurn: Partial<Record<Side, number>>;
}

/** Copy policy state without the derived distance caches (spec 11 part B, E5). */
export function exportMemory(memory: AiMemory): SavedMemory {
  return {
    targets: [...memory.targets],
    left: [...memory.left].map(([unit, visits]) => [unit, visits.map((visit) => ({ ...visit }))]),
    quietSince: { ...memory.quietSince },
    stallTurn: { ...memory.stallTurn },
  };
}

/** Restore validated save data, or fresh memory when absent (spec 11 part B, E5). */
export function importMemory(saved?: SavedMemory): AiMemory {
  const memory = createMemory();
  if (!saved) return memory;
  memory.targets = new Map(saved.targets);
  memory.left = new Map(saved.left.map(([unit, visits]) => [unit, visits.map((visit) => ({ ...visit }))]));
  memory.quietSince = { ...saved.quietSince };
  memory.stallTurn = { ...saved.stallTurn };
  return memory;
}
