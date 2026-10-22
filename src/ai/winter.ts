import type { Action } from "../engine/actions";
import type { Decision } from "./types";

/**
 * The computer's answer to the Russian winter question at II.A (spec 14 part E; ticket 14-11 gives only this minimal answer, so the game cannot stall at the
 * new prompt; the full policy set is ticket 14-19). The Allies postpone whenever the dice allow it: the dice only allow it when few Axis units stand in
 * Russia, so the Axis cannot use the winter's gain yet, and a year more lets Russia build up. A policy of the computer, not a rule.
 * TODO(verify) V44: policy only; tune against the self-play results of ticket 14-19.
 */
export const WINTER_POSTPONE_WHEN_ALLOWED = true;

/** The CHOOSE_WINTER on the legal list that matches the policy, or null if the list has none (then the caller stops: nothing is asked). */
export function chooseWinter(legal: readonly Action[]): Decision | null {
  const action = legal.find((a) => a.type === "CHOOSE_WINTER" && a.postpone === WINTER_POSTPONE_WHEN_ALLOWED) ?? legal.find((a) => a.type === "CHOOSE_WINTER");
  if (!action) return null;
  const why = action.type === "CHOOSE_WINTER" && action.postpone ? "The dice allow it: the Allies put the Russian winter off a year." : "The Russian winter starts now.";
  return { action, why };
}
