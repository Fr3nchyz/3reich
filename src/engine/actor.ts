import { combatOf } from "./combat-record";
import type { GameState, Side } from "./types";
import { winterAsking } from "./winter-record";

/**
 * The side that has to act now. Usually the side whose Player Turn it is; two other cases exist today: the side that must choose the losses of an Exchange
 * (step 7h, `PendingLosses.chooser`, Ref 12.2), who can be the defender, and the Allies at step II.A, who answer the Russian winter question whoever played
 * last (spec 14 R10, C6). The browser's `computerToMove` and the computer's `chooseAction` both ask this, so there is no special case in either. Specs 09, 12,
 * 15 and 16 add their own cases (the non-active side at 7d and 6c, step 2, Attrition) here when they are built.
 */
export function sideToAct(state: GameState): Side {
  if (winterAsking(state)) return "allies";
  return combatOf(state).pending?.chooser ?? state.activeSide;
}
