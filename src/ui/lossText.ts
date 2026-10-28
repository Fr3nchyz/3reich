import type { GameEvent, LostReason } from "../engine/action-types";
import type { GameContext } from "../engine/context";
import type { GameState, Unit } from "../engine/types";
import { OWNER_NAMES } from "../engine/nations";
import { factorsOf, nationAdjective, placeName } from "./names";

/**
 * The log lines for a unit that is lost and where it went (spec 17 R1, R4, 17-1's events), and for a counter bought back. Plain words for a
 * reader who does not know the manual. Text only: nothing here decides a rule.
 */

/** Why a unit is lost for good, in a few words that finish the sentence ("lost for good (minor country)"). */
export const LOST_REASON_WORDS: Readonly<Record<LostReason, string>> = {
  "out-of-game": "its nation is out of the game",
  "minor-country": "minor country",
  "not-in-pool": "this kind of counter cannot be rebuilt",
  "fleet-never-rebuilt": "that nation's fleets are never rebuilt",
  "partial-fleet": "only a whole 9-factor fleet can be rebuilt",
};

type LossEvent = Extract<GameEvent, { type: "UNIT_RETURNED_TO_POOL" | "UNIT_LOST_FOR_GOOD" }>;

/** "German 4-6 armor", from the counter as it stood before the action when it is known, else from the event ("Polish 1-factor infantry"). */
function lostName(e: LossEvent, before: GameState): string {
  const u: Pick<Unit, "owner" | "nationality" | "type" | "strength" | "movement"> | undefined = before.units[e.unitId];
  if (u) return `${nationAdjective(u)} ${factorsOf(u)} ${u.type}`;
  return `${OWNER_NAMES[e.owner]} ${e.strength}-factor ${e.unitType}`;
}

/**
 * One line for a lost unit and its fate. `unsupplied` is true when the unit was eliminated for lack of supply (the reason sits on the
 * UNIT_ELIMINATED event right before, whose own line is left out when this one follows it).
 */
export function lossLine(ctx: GameContext, before: GameState, e: LossEvent, unsupplied = false): string {
  const how = unsupplied ? "eliminated for lack of supply" : "destroyed";
  const head = `${lostName(e, before)} ${how} at ${placeName(ctx.map, e.at)}`;
  if (e.type === "UNIT_LOST_FOR_GOOD") return `${head}, lost for good (${LOST_REASON_WORDS[e.reason]}).`;
  return `${head}, back in the ${e.pool === "free-france" ? "Free French " : ""}pool.`;
}

/** The line for a counter built; one bought back from the pool says "rebuilds", and one from another nation's pool says whose it is. */
export function builtLine(e: Extract<GameEvent, { type: "UNIT_BUILT" }>, payer: string): string {
  const kind = e.pool && e.pool !== e.owner ? `${OWNER_NAMES[e.pool]} ${e.unitType}`.replace("Free France", "Free French") : e.unitType;
  return `${payer} ${e.returned ? "rebuilds" : "builds"} a ${e.strength}-factor ${kind} at ${e.at} (${e.cost} BRPs).`;
}
