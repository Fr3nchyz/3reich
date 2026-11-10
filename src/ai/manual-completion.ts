import type { Action } from "../engine/actions";
import type { GameState } from "../engine/types";
import type { Decision } from "./types";

/** Spec 09 AER116: finish existing manual work without enabling mission policies.
 * Optional movement, drops, DAS and interception declarations use the ordinary END_STEP fallback.
 */
export function chooseManualCompletion(state: GameState, legal: readonly Action[]): Decision | undefined {
  const action = legal.find(a =>
    (state.naval?.manualFleetMove === true && (a.type === "PASS_INTERCEPT"
      || a.type === "RESOLVE_INTERCEPTIONS" || a.type === "RESOLVE_SEA_AIR"))
    || (state.air?.manualDas === true && (a.type === "RESOLVE_COUNTER_AIR" || a.type === "RESOLVE_PORT_ATTACKS")));
  return action ? { action, why: "Complete the pending manual procedure." } : undefined;
}
