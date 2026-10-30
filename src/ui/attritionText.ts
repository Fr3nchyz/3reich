import type { Action, GameEvent } from "../engine/actions";
import type { GameContext } from "../engine/context";
import type { GameState } from "../engine/types";
import { unitsWhere } from "./actionLabels";
import { cap, sideName } from "./format";
import { placeName, stackSummary, unitsWithIds } from "./names";

/**
 * Plain words for Attrition (spec 16 C3, C4, D2): the buttons of steps 7a and 7p and the log lines of their events. The cards of ticket 16-7 are
 * not built; these are the fallback that keeps a human from being stuck, in the style of the Attack and Lose buttons.
 */

/** The button of an Attrition action, or null for any other action. */
export function attritionLabel(a: Action, ctx: GameContext, state: GameState): string | null {
  switch (a.type) {
    case "RESOLVE_ATTRITION":
      return `Resolve Attrition on the ${cap(a.front)} Front${a.units ? ` with ${a.units.length} unit${a.units.length === 1 ? "" : "s"}` : ""}`;
    case "CHOOSE_ATTRITION_LOSSES":
      return a.units.length === 0 ? "Lose no units to Attrition" : `Choose for me: lose ${unitsWhere(ctx, state, a.units)}`;
    case "SELECT_ATTRITION_HEX":
      return `Take ${placeName(ctx.map, a.hex)} by Attrition`;
    case "END_ATTRITION":
      return "No more hexes";
    case "RETREAT_UNIT":
      return `Retreat ${unitsWhere(ctx, state, [a.unit])} to ${placeName(ctx.map, a.to)}`;
    case "OCCUPY_ATTRITION_HEX":
      return `Move ${unitsWhere(ctx, state, a.units)} into the emptied hex`;
    default:
      return null;
  }
}

/** The log line of an Attrition event, or undefined for any other event. `before` is the position the action was made in. */
export function attritionLine(e: GameEvent, ctx: GameContext, before: GameState): string | undefined {
  switch (e.type) {
    case "ATTRITION_RESOLVED":
      return `Attrition on the ${cap(e.front)} Front (${sideName(e.side)}): ${e.factors} factors, ${e.column} column, die ${e.roll}: ${e.mustLose} unit${e.mustLose === 1 ? "" : "s"} lost, ${e.hexesLeft} hex${e.hexesLeft === 1 ? "" : "es"} may be taken.`;
    case "ATTRITION_LOSSES_CHOSEN":
      return `Attrition losses chosen: ${e.units.length === 0 ? "none" : stackSummary(unitsWithIds(before, e.units))}.`;
    case "ATTRITION_HEX_SELECTED":
      return `Attrition: ${placeName(ctx.map, e.hex)} must be given up.`;
    case "UNIT_RETREATED":
      return `${stackSummary(unitsWithIds(before, [e.unit]))} retreat from ${placeName(ctx.map, e.from)} to ${placeName(ctx.map, e.to)}.`;
    case "ATTRITION_HEX_OCCUPIED":
      return `${stackSummary(unitsWithIds(before, e.units))} move into ${placeName(ctx.map, e.hex)}.`;
    default:
      return undefined;
  }
}
