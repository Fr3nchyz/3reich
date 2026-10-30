import type { Action } from "../engine/actions";
import type { Decision } from "./types";

/** Step 2: the engine lists one PLACE_MINOR_FORCES, the suggested placement of spec 15 R16 (`suggestMinorPlacement`); the computer plays it as listed. */
export function choosePlacement(legal: readonly Action[]): Decision | null {
  const action = legal.find((a) => a.type === "PLACE_MINOR_FORCES");
  return action ? { action, why: "Sets up the minor country's army: the capital first, then Objectives, then nearest the attacker." } : null;
}
