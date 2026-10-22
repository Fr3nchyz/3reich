import type { Action, ActionResult } from "./action-types";
import type { GameContext } from "./context";
import { acceptSurrender, refuseSurrender } from "./soviet-surrender";
import { surrenderAsking } from "./soviet-record";
import type { GameState } from "./types";

/**
 * The action of the Russian surrender (spec 14 C3, R7b to R7d): at step 10a the Axis answers Russia's one-time offer. Legal only while the offer waits, and only for the
 * Axis (the Allied Player Turn is the active one, but the Allies are not asked; `sideToAct` says so). The answer leaves the game at step 10a with the offer settled;
 * `actions.ts` moves it on, as it does after `CHOOSE_WINTER`. Refusals name the reason, and bad input never throws.
 */

/** The two answers the Axis may give, accepting first. Empty when no offer waits. */
export function legalSurrenderActions(state: GameState): Action[] {
  return surrenderAsking(state) ? [{ type: "SURRENDER_ANSWER", side: "axis", accept: true }, { type: "SURRENDER_ANSWER", side: "axis", accept: false }] : [];
}

/** The Axis answers. The state returned is still at step 10a with nothing asked, and may have ended the game (a conquest that decides it). */
export function applySurrenderAnswer(ctx: GameContext, state: GameState, action: Extract<Action, { type: "SURRENDER_ANSWER" }>): ActionResult {
  if (!surrenderAsking(state)) return { ok: false, error: "No offer to surrender is waiting for an answer." };
  if (action.side !== "axis") return { ok: false, error: `The Axis answers Russia's offer to surrender, not the ${String(action.side)} side.` };
  if (typeof action.accept !== "boolean") return { ok: false, error: "Russia's offer to surrender is either accepted or refused." };
  const done = action.accept ? acceptSurrender(ctx, state) : refuseSurrender(state);
  return { ok: true, state: done.state, events: done.events };
}
