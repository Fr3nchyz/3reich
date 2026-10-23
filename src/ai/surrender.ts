import type { Action } from "../engine/actions";
import type { Decision } from "./types";
import { ACCEPT_SURRENDER } from "./policies";

export { ACCEPT_SURRENDER };
/**
 * The computer's answer to Russia's offer to surrender at step 10a (spec 14 part E; tickets 14-15 and 14-19). The policy is the constant `ACCEPT_SURRENDER` in
 * `policies.ts`, with its reason; this file only picks the matching action from the legal list.
 */

/** The SURRENDER_ANSWER on the legal list that matches the policy, or null if the list has none (then the caller stops: nothing is asked). */
export function chooseSurrender(legal: readonly Action[]): Decision | null {
  const action = legal.find((a) => a.type === "SURRENDER_ANSWER" && a.accept === ACCEPT_SURRENDER) ?? legal.find((a) => a.type === "SURRENDER_ANSWER");
  if (!action) return null;
  const why = action.type === "SURRENDER_ANSWER" && action.accept ? "The Axis accept Russia's offer to surrender: the war in the East ends and Germany takes half of Russia's yearly income." : "The Axis refuse Russia's offer to surrender: the war in the East goes on.";
  return { action, why };
}
