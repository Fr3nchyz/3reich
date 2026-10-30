import type { Action } from "../engine/actions";
import type { GameContext } from "../engine/context";
import { seaSupplyOptions } from "../engine/naval-supply-options";
import type { GameState } from "../engine/types";
import type { Decision } from "./types";

const byHex = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, i) => id === b[i]);

/** Sea-supply policy (spec 12 Part E, Release I; R6/R7): save most units, then the lowest receiving hex, origin and fleet ids.
 * Re-read after every action; return only an action from the supplied legal list. The caller ends the step when none saves a unit.
 */
export function chooseSeaSupply(ctx: GameContext, state: GameState, legal: readonly Action[]): Decision | undefined {
  const options = seaSupplyOptions(ctx, state, state.activeSide).filter((o) => o.saves > 0)
    .sort((a, b) => b.saves - a.saves || byHex(a.to, b.to) || byHex(a.from, b.from) || byHex(a.fleets.join("|"), b.fleets.join("|")));
  for (const proposal of options) {
    const action = legal.find((a) => a.type === "DESIGNATE_SEA_SUPPLY" && a.side === state.activeSide && a.to === proposal.to
      && same(a.fleets, proposal.fleets) && same(a.units, proposal.units));
    if (action) return { action, why: `Sea supply saves ${proposal.saves} cut-off unit${proposal.saves === 1 ? "" : "s"}.` };
  }
  return undefined;
}
