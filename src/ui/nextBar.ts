import type { Action } from "../engine/actions";
import { attackTargets } from "./attackDraft";
import { planeBases } from "./airMove";
import { airbaseOwners, airMoveNow } from "./airMoveTap";
import * as A from "./airMoveText";
import { atStep7b } from "./airView";
import { atStep7h, attacking } from "./attackTap";
import { openOffers } from "./choiceTap";
import { atStep6f, selectionNow } from "./moveTap";
import * as T from "./moveText";
import { ownPending } from "./lossOptions";
import { placeName } from "./names";
import type { Session } from "./session";

/**
 * The "Next:" bar of step 7h (spec 07, State 3 and 4): one short line that says what the game waits for, and the step's own buttons, in a bar that
 * sticks to the top of the status column. The choice, the result and the list sit right under it, so after each press the next thing to do is in view
 * and "Done with step 7h" never scrolls out of reach. No rule here: every sentence reads what the engine offers (legal actions, the pending Exchange).
 */

/** Whether the bar and the cards lead the status column: the player may attack now, a battle result is still shown (step 7h), the player moves (step 6f, spec 10) or commits air (step 7b, spec 09). */
export const leadsStatus = (s: Session): boolean => attacking(s) || (atStep7h(s) && !!s.battle) || atStep6f(s) || atStep7b(s);

/** The bar's sentence at step 6f: choose a stack, or tick the units and tap a yellow hex. */
function moveNext(s: Session, actions: readonly Action[]): string {
  const sel = selectionNow(s);
  if (sel) return T.nextTick(sel.ticked.length);
  if (s.airbase) return A.NEXT_PLACE;
  const card = airMoveNow(s);
  if (card) return card.ticked.length === 0 ? A.nextTickPlanes(0) : card.bases.length === 0 ? A.NEXT_NO_BASE : A.nextTickPlanes(card.ticked.length);
  const air = planeBases(s.ctx, s.state).length > 0 || airbaseOwners(s).length > 0;
  if (actions.some((a) => a.type === "MOVE")) return T.NEXT_CHOOSE;
  return air ? A.NEXT_AIR_ONLY : T.NEXT_NOTHING_TO_MOVE;
}

/** What the game waits for, in one sentence. */
export function nextText(s: Session, actions: readonly Action[]): string {
  if (atStep6f(s)) return moveNext(s, actions);
  if (atStep7b(s)) return s.airDraft ? "Next: check the planes, then commit them." : actions.some((a) => a.type === "DESIGNATE_AIR") ? "Next: choose planes for a hex you will attack, or finish step 7b." : "Next: finish step 7b.";
  if (!attacking(s)) return "Waiting for the computer to choose its losses.";
  if (ownPending(s.state, s.humanSide)) return "Next: choose your losses.";
  const offers = openOffers(s, actions);
  if (offers.length > 0) return `Next: advance into ${placeName(s.ctx.map, offers[0]!)}, or stay.`;
  if (s.attack) return "Next: check the odds, then attack.";
  if (attackTargets(actions).length > 0) return "Next: attack a red hex, or finish.";
  return "Next: finish step 7h.";
}

/** The bar: the sentence and the buttons that move the game on (`buttons` is their HTML, from statusView). */
export const nextBarHtml = (s: Session, actions: readonly Action[], buttons: string): string =>
  `<div class="actions controls nextbar" role="group" aria-label="Next step"><p class="next-text">${nextText(s, actions)}</p>${buttons}</div>`;
