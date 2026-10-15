import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { destinations, resolveUnits } from "./move-action";
import { endProblem, reachableHexes, stackMovement } from "./movement";
import type { GameState, Unit } from "./types";
import { enemyZocFor } from "./zoc";

/**
 * Where any chosen part of a stack can go (spec 10, ticket 10-1): a read-only query for the screen's Move card. It asks the
 * same two questions legalMoves asks, with the same helpers (reachableHexes for the slowest unit's reach, endProblem for
 * where all of them may end), so for the whole movable stack of a hex, or for one unit, it lists exactly the MOVE actions
 * legalActions lists; it also answers for the sets in between, which legalActions leaves out to stay short (Ref 5.45f, 5.0, 6.0).
 * It never changes a state and reads no dice.
 */

export interface MoveDestination {
  /** The hex where the whole group ends. */
  to: HexId;
  /** The hexes entered, start excluded: a path `applyAction` accepts as MOVE `path`. */
  path: HexId[];
}

export type MoveOptions =
  | {
      ok: true;
      /** The units, in id order (the order legalMoves names them in). */
      units: Unit[];
      from: HexId;
      /** The movement points the group moves with: the slowest unit's (`stackMovement`). */
      points: number;
      /** Where all of the units can end together, in hex order. */
      destinations: MoveDestination[];
      /** Hexes within the group's reach where it may not all end (stacking, Ref 5.0, 26.0) though the path is open, in hex order. */
      tooFull: HexId[];
    }
  | { ok: false; error: string };

const idOrder = (u: Unit): number => Number(u.id.replace(/\D/g, ""));

/**
 * The places this chosen set of units, all standing in one hex and all able to move now, can go together, each with its path.
 * `unitIds` may be any non-empty subset of the movable units of one hex, in any order. Anything else (a unit that cannot move,
 * units in different hexes, an unknown or repeated id) gives `ok: false` with the engine's own reason (which names ids: the
 * screen words its own sentences).
 */
export function moveOptionsFor(ctx: GameContext, state: GameState, unitIds: readonly string[]): MoveOptions {
  const found = resolveUnits(ctx, state, unitIds);
  if ("error" in found) return { ok: false, error: found.error };
  const units = [...found.units].sort((a, b) => idOrder(a) - idOrder(b));
  const zoc = enemyZocFor(ctx, state, state.activeSide);
  const reach = reachableHexes(ctx, state, units, zoc);
  return {
    ok: true,
    units,
    from: units[0]!.at,
    points: stackMovement(units),
    destinations: destinations(ctx, state, units, zoc).map(([to, path]) => ({ to, path })),
    tooFull: [...reach.keys()].filter((hex) => endProblem(ctx, state, units, hex) !== null).sort(),
  };
}
