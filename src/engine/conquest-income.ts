import { capitalOf } from "./capital";
import { controllingSide } from "./control";
import type { GameContext } from "./context";
import { sideOfOwner } from "./setup";
import type { ForceOwner, GameState, PowerId } from "./types";
import { isMajorPower } from "./war";

/**
 * The BRPs a conquered Major Power pays its conqueror (spec 14 R4; Ref 9.2, 18.1): in every Year Start Sequence the conqueror gets half, rounded
 * down, of what the conquered Power began the scenario with, while it still holds the capital. The Conquest record says when the conquest completed, so
 * a capital that fell in the second Player Turn of a Winter Game Turn (its owner's Combat Phase comes after the Year Start Sequence) pays one
 * sequence later with no rule of its own.
 */

/** The Major Power that receives what a conquest pays: the conqueror itself if it is one. */
export function conquestRecipient(state: GameState, by: ForceOwner): PowerId {
  if (isMajorPower(by)) return by;
  // TODO(verify) V31: when the unit in the capital is not a Major Power's, the half-BRPs go to the Major Power it fights for: a Minor-Ally's
  // protector, Germany for Vichy France, Britain for the Free French and Poland.
  const ally = state.minorAllies.find((m) => m.owner === by);
  if (ally) return ally.of;
  return by === "vichy-france" ? "germany" : "britain";
}

/** Half of the starting BRPs of each Major Power `id` conquered and whose capital its side still holds; 0 if there is none. */
export function conquestIncome(ctx: GameContext, state: GameState, id: PowerId): number {
  let total = 0;
  for (const c of state.conquests ?? []) {
    if (c.startingBrps === undefined || c.country === "eastern-europe" || !isMajorPower(c.country) || conquestRecipient(state, c.by) !== id) continue;
    const capital = capitalOf(ctx, c.country);
    // TODO(verify) V31: "while it still holds the capital" is read as: the side of the conqueror controls the capital hex.
    if (capital !== null && controllingSide(ctx, state, capital) === sideOfOwner(c.by)) total += Math.floor(c.startingBrps / 2);
  }
  return total;
}
