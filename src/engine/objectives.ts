import { controllerOf, sideInWar } from "./control";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import type { ForceOwner, GameState, Side } from "./types";

/**
 * Who holds the 42 Objectives (spec 14 R1; Ref 2.0, 6.0, 35.0). An Objective is a hex with the map feature
 * "objective": capitals and ports are Objectives only when the map prints them red, so this never reads the
 * "capital" features (the computer's target list and the self-play tally do, and must not be used for the score).
 */

export interface ObjectiveStandings {
  axis: HexId[];
  allies: HexId[];
  nobody: HexId[];
}

/**
 * The side a hex controlled by `owner` counts for, or null for nobody (Ref 2.0):
 * - a Major Power or an active Minor-Ally counts for the side it fights on (`sideInWar`), and Poland and the Free French for the Allies;
 * - a neutral Italy still counts for the Axis and a neutral U.S.S.R. for the Allies;
 * - Vichy France counts for the Axis (Ref 35.0: Marseilles and Lyons, the only Objectives in the Vichy zone);
 * - an inactive Minor-Ally, a nation out of the scenario and a minor country never at war count for nobody.
 * TODO(verify) V2: land of an inactive Minor-Ally counts for neither side (the manual speaks of "minor countries never at war").
 */
export function objectiveSide(state: GameState, owner: ForceOwner): Side | null {
  if (owner === "vichy-france") return "axis";
  const side = sideInWar(state, owner);
  if (side !== null) return side;
  if (owner === "italy" && state.nations.italy.status === "neutral") return "axis";
  if (owner === "ussr" && state.nations.ussr.status === "neutral") return "allies";
  return null;
}

/** The Objective hexes of the map, in the map's order. */
export function objectiveHexes(ctx: GameContext): HexId[] {
  return Object.values(ctx.map.hexes).filter((h) => h.features.includes("objective")).map((h) => h.id);
}

/**
 * The three lists: Objectives the Axis holds, the Allies hold, and nobody holds.
 * The Objectives credited to the Allies for good by an accepted Russian surrender (R7c, `GameState.soviet.credited`) count for the Allies whoever controls them.
 */
export function objectiveStandings(ctx: GameContext, state: GameState): ObjectiveStandings {
  const out: ObjectiveStandings = { axis: [], allies: [], nobody: [] };
  const credited = new Set(state.soviet?.credited);
  for (const hex of objectiveHexes(ctx)) {
    if (credited.has(hex)) {
      out.allies.push(hex);
      continue;
    }
    const owner = controllerOf(ctx, state, hex);
    const side = owner === null ? null : objectiveSide(state, owner);
    out[side ?? "nobody"].push(hex);
  }
  return out;
}
