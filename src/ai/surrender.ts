import type { Action } from "../engine/actions";
import type { Decision } from "./types";

/**
 * The computer's answer to Russia's offer to surrender at step 10a (spec 14 part E; ticket 14-15 gives only this minimal, constant answer, so the game cannot stall at the
 * new prompt; the full policy set is ticket 14-19, and the Axis computer that keeps its Occupation Force is ticket 14-21). The Axis accept: the war in the East
 * ends and Germany gets half of Russia's income (Q5 of the spec, recommended yes). A policy of the computer, not a rule.
 * TODO(verify) V52: policy only; tune against the self-play results of ticket 14-19.
 */
export const ACCEPT_SURRENDER = true;

/** The SURRENDER_ANSWER on the legal list that matches the policy, or null if the list has none (then the caller stops: nothing is asked). */
export function chooseSurrender(legal: readonly Action[]): Decision | null {
  const action = legal.find((a) => a.type === "SURRENDER_ANSWER" && a.accept === ACCEPT_SURRENDER) ?? legal.find((a) => a.type === "SURRENDER_ANSWER");
  if (!action) return null;
  const why = action.type === "SURRENDER_ANSWER" && action.accept ? "The Axis accept Russia's offer to surrender: the war in the East ends and Germany takes half of Russia's yearly income." : "The Axis refuse Russia's offer to surrender: the war in the East goes on.";
  return { action, why };
}
