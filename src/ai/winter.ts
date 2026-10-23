import type { Action } from "../engine/actions";
import type { Decision } from "./types";
import { WINTER_POSTPONE_WHEN_ALLOWED } from "./policies";

export { WINTER_POSTPONE_WHEN_ALLOWED };
/**
 * The computer's answer to the Russian winter question at II.A (spec 14 part E; tickets 14-11 and 14-19). The policy is the constant `WINTER_POSTPONE_WHEN_ALLOWED`
 * in `policies.ts`, with its reason; this file only picks the matching action from the legal list.
 */

/** The CHOOSE_WINTER on the legal list that matches the policy, or null if the list has none (then the caller stops: nothing is asked). */
export function chooseWinter(legal: readonly Action[]): Decision | null {
  const action = legal.find((a) => a.type === "CHOOSE_WINTER" && a.postpone === WINTER_POSTPONE_WHEN_ALLOWED) ?? legal.find((a) => a.type === "CHOOSE_WINTER");
  if (!action) return null;
  const why = action.type === "CHOOSE_WINTER" && action.postpone ? "The dice allow it: the Allies put the Russian winter off a year." : "The Russian winter starts now.";
  return { action, why };
}
