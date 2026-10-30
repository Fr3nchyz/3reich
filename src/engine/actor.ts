import { attritionOf } from "./attrition-record";
import { combatOf } from "./combat-record";
import type { GameState, Side } from "./types";
import { surrenderAsking } from "./soviet-record";
import { placingSide } from "./minors-step";
import { winterAsking } from "./winter-record";

/**
 * The side that has to act now. Usually the side whose Player Turn it is; three other cases exist today: the side that must choose the losses of an Exchange
 * (step 7h, `PendingLosses.chooser`, Ref 12.2), who can be the defender, the Allies at step II.A, who answer the Russian winter question whoever played
 * last (spec 14 R10, C6), and the Axis at step 10a, who answer Russia's offer to surrender in the middle of the Allied Player Turn (spec 14 R7b). The browser's `computerToMove` and `computerSide` ask this, so there is no special case there; the computer's `chooseAction` does not call it, it plays the legal list of the state it is given. Step 2 is the side that places an attacked minor's army (spec 15 C5). Specs 09 and 12
 * add their own cases (the non-active side at 7d and 6c) here when they are built.
 */
export function sideToAct(state: GameState): Side {
  if (winterAsking(state)) return "allies";
  if (surrenderAsking(state)) return "axis"; // step 10a: the Allied Player Turn is the active one, but the Axis answers Russia's offer to surrender (spec 14 R7b)
  if (state.phase === "player-turn" && state.position?.part === "player-turn" && state.position.step === "2") { // step 2: the side that did not declare sets up the minor's army (spec 15 C5, R3)
    const placing = placingSide(state);
    if (placing) return placing;
  }
  return combatOf(state).pending?.chooser ?? attritionOf(state, state.attrition).run?.chooser ?? state.activeSide; // an open Attrition run names its own chooser (spec 16 C6)
}
