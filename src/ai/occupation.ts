import type { Action } from "../engine/actions";
import type { Decision } from "./types";

/**
 * The computer's answer when the Axis Occupation Force is short at step 6h or 9k (spec 14 R7c; ticket 14-17): it hands back the first Objective on the legal list
 * (the engine lists them in hex order), so a game replays the same way. A policy of the computer, not a rule; a cleverer choice (the Objective least worth holding) is
 * ticket 14-21 (Release 1). TODO(verify) V21: policy only.
 */
export function chooseConcede(legal: readonly Action[]): Decision | null {
  const action = legal.find((a) => a.type === "OCCUPATION_CONCEDE");
  return action ? { action, why: "The Occupation Force in Russia is short: the Axis hand back an Objective and pay 15 BRPs." } : null;
}
