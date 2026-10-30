import type { Action } from "../engine/actions";
import { attritionOf } from "../engine/attrition-record";
import type { GameContext } from "../engine/context";
import type { GameState, Unit } from "../engine/types";
import { chooseAttritionHex, chooseAttritionLosses, chooseOccupiers, chooseRetreat } from "./attrition";
import type { Decision } from "./types";

/**
 * Steps 7a and 7p (spec 16 Part E, ticket 16-8): the computer resolves Attrition at 7p with every participant (at 7a it only ends the step, so the
 * Offensive Option's attacks come first), and answers each stage of a run with the choosers of attrition.ts: its losses, hexes, retreats and occupiers.
 * The action is built here and handed to the engine, which accepts any set that passes the rule's checks; the listed actions are the fallback
 * when a chooser has nothing (the first listed action of the stage, which keeps the run moving).
 */
export function chooseAttrition(ctx: GameContext, state: GameState, legal: readonly Action[], step: string): Decision | undefined {
  const run = attritionOf(state, state.attrition).run;
  const side = state.activeSide;
  const first = <T extends Action["type"]>(type: T) => legal.find((a): a is Extract<Action, { type: T }> => a.type === type);
  if (!run) {
    const resolve = step === "7p" ? first("RESOLVE_ATTRITION") : undefined;
    return resolve ? { action: resolve, why: `Resolves Attrition on the ${resolve.front} Front with every unit in contact.` } : undefined;
  }
  const participants: Unit[] = run.participants.flatMap((id) => (state.units[id] ? [state.units[id]] : []));
  switch (run.stage) {
    case "losses": {
      const units = chooseAttritionLosses(ctx, state, run.front, run.mustLose, participants);
      const action: Action = { type: "CHOOSE_ATTRITION_LOSSES", side: run.chooser, units };
      return { action, why: "Gives up Replacements first, then the weakest units, then those farthest from their capital." };
    }
    case "hex": {
      const hex = chooseAttritionHex(ctx, state, run.front, participants, run.hexesLeft);
      const take = hex === null ? undefined : legal.find((a) => a.type === "SELECT_ATTRITION_HEX" && a.hex === hex);
      if (take) return { action: take, why: "Takes the hex whose occupier would not end next to too many enemy factors, objectives and cities first." };
      const end = first("END_ATTRITION");
      return end ? { action: end, why: "No hex is both selectable and safe to occupy." } : undefined;
    }
    case "retreat": {
      for (const id of [...(run.retreating ?? [])].sort()) {
        const to = chooseRetreat(ctx, state, id);
        const pick = to === null ? undefined : legal.find((a) => a.type === "RETREAT_UNIT" && a.unit === id && a.to === to);
        if (pick) return { action: pick, why: "Retreats to the supplied hex next to the fewest enemy factors, nearest its capital." };
      }
      const any = first("RETREAT_UNIT");
      return any ? { action: any, why: "Retreats." } : undefined;
    }
    case "occupy": {
      const units = run.target ? chooseOccupiers(ctx, state, run.target, participants) : [];
      const action: Action = { type: "OCCUPY_ATTRITION_HEX", side, units };
      if (units.length > 0 && legal.some((a) => a.type === "OCCUPY_ATTRITION_HEX")) return { action, why: "Moves in with the smallest stack that is safe, armor and infantry first." };
      const any = first("OCCUPY_ATTRITION_HEX");
      return any ? { action: any, why: "Moves in: the hex must be occupied." } : undefined;
    }
  }
}
