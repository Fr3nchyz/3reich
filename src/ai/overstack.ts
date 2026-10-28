import type { Action } from "../engine/actions";
import type { Decision } from "./types";

/**
 * Steps 6g and 9j (spec 16 R15, ticket 16-6): the computer settles its overstacks with the engine's default choice, the weakest units
 * first and no more than needed (`defaultElimination`, listed as the one ELIMINATE_OVERSTACK). Ticket 16-8 may refine which units go.
 */
export function chooseOverstack(legal: readonly Action[]): Decision | undefined {
  const action = legal.find((a) => a.type === "ELIMINATE_OVERSTACK");
  return action ? { action, why: "Overstacked: eliminates the weakest units that bring each hex within its limit." } : undefined;
}
