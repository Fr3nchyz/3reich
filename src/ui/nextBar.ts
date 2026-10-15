import type { Action } from "../engine/actions";
import { attackTargets } from "./attackDraft";
import { atStep7h, attacking } from "./attackTap";
import { openOffers } from "./choiceTap";
import { ownPending } from "./lossOptions";
import { placeName } from "./names";
import type { Session } from "./session";

/**
 * The "Next:" bar of step 7h (spec 07, State 3 and 4): one short line that says what the game waits for, and the step's own buttons, in a bar that
 * sticks to the top of the status column. The choice, the result and the list sit right under it, so after each press the next thing to do is in view
 * and "Done with step 7h" never scrolls out of reach. No rule here: every sentence reads what the engine offers (legal actions, the pending Exchange).
 */

/** Whether the bar and the cards of step 7h lead the status column: the player may attack now, or a battle result is still shown. */
export const leadsStatus = (s: Session): boolean => attacking(s) || (atStep7h(s) && !!s.battle);

/** What the game waits for, in one sentence. */
export function nextText(s: Session, actions: readonly Action[]): string {
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
