import type { Action, GameEvent } from "../engine/actions";
import { sideOfOwner } from "../engine/setup";
import type { GameState, Side } from "../engine/types";
import type { Session } from "./session";

/**
 * Which side each line of the activity log belongs to, for its colour (the owner's request: red for Axis, blue for Allies).
 * Kept beside the log, never in it: Session.log stays a list of strings, the saved game record and the engine are untouched, and
 * `Session.logSides` maps an entry's index to a side. An entry with no mark is plain, so a line pushed straight to `log` can
 * never put the two out of step.
 *
 * The rule (red = Axis, blue = Allies): a line takes the side it concerns: the side that owns the unit or nation it names (a unit
 * eliminated, a nation declaring war, building or paying BRPs), the side that moved or attacked, the side whose turn begins.
 * Only a line that names no owner takes the side of the action's actor. Lines about both sides or about the game itself stay plain.
 */

/** Adds a line to the log, marked with a side (or none, for system notes, setup notes and the start of a game). */
export function logLine(s: Pick<Session, "log" | "logSides">, text: string, side: Side | null = null): void {
  if (side) (s.logSides ??= new Map()).set(s.log.length, side);
  s.log.push(text);
}

/** The side that takes this action: the one in the action itself, or the side of the nation named in it. */
export function actorSide(a: Action): Side {
  switch (a.type) {
    case "DECLARE_WAR": return sideOfOwner(a.by);
    case "GRANT_BRPS": return sideOfOwner(a.from);
    case "BUILD":
    case "PLACE_AIRBASE":
    case "SETUP_PLACE":
    case "SETUP_REMOVE":
    case "SETUP_DONE": return sideOfOwner(a.owner);
    default: return a.side;
  }
}

/** The side the units named by id belong to in the position `before`, when they are all one side's; null when they are not known or are mixed. */
function sideOfUnits(ids: readonly string[], before: GameState | undefined): Side | null {
  const sides = new Set<Side>();
  for (const id of ids) {
    const unit = before?.units[id];
    if (!unit) return null;
    sides.add(sideOfOwner(unit.owner));
  }
  return sides.size === 1 ? [...sides][0]! : null;
}

/**
 * The side of a line written for this event of an action taken by `actor`: the side the line concerns, never just whoever's action
 * set it off (the U.S. joining in Spring 1942 is written while the Axis player turn ends; a defender's losses while the attacker attacks).
 * `before` is the position the action was made in, where a unit that moved or advanced is found by id. A line that is about both sides
 * or about the game itself is null (plain); a line that names no owner takes the actor's side.
 */
export function eventSide(e: GameEvent, actor: Side, before?: GameState): Side | null {
  switch (e.type) {
    case "INITIATIVE_DETERMINED":
    case "SETUP_COMPLETE":
    case "GAME_OVER":
    case "FORTRESS_CHANGED": return null; // spec 16 R31: fortress status news
    case "ATTRITION_RESOLVED": return e.side; // the roll is the Phasing side's
    case "ATTRITION_LOSSES_CHOSEN": return sideOfUnits(e.units, before) ?? actor; // the defender's losses
    case "ATTRITION_HEX_SELECTED":
    case "ATTRITION_HEX_OCCUPIED": return actor; // the Phasing side's choice
    case "UNIT_RETREATED": return sideOfUnits([e.unit], before) ?? actor;
    case "MINOR_DECLARATION_REVOKED":
    case "MINOR_GARRISONED": return sideOfOwner(e.by); // the garrisoning side
    case "MINOR_ALLY_WOKE": return sideOfOwner(e.of); // the side the ally joins
    case "MINOR_INTERVENED": return sideOfOwner(e.by); // the declarer's side; the helper's side
    case "PLAYER_TURN_STARTED":
    case "MINOR_FORCES_PLACED": // the side that set the army up
    case "FRONT_OPTION_SELECTED":
    case "LOSSES_CHOSEN": return e.side; // LOSSES_CHOSEN: the side that chose, who may be the defender
    case "COMBAT_RESOLVED": return e.side; // the attack is the attacker's
    case "BRPS_CHANGED": return sideOfOwner(e.nation); // a nation's own treasury, whoever's action moved it (a Year Start, say)
    case "WAR_DECLARED": return sideOfOwner(e.by); // also the scenario's own declaration, made as the other side's turn ends
    case "BRPS_GRANTED": return sideOfOwner(e.from);
    case "UNIT_BUILT":
    case "AIRBASE_PLACED":
    case "UNIT_PLACED":
    case "UNIT_REMOVED":
    case "FLEET_DISPLACED":
    case "AIR_DISPLACED":
    case "UNIT_ELIMINATED": // the side that owns the unit lost, not the side that attacked
    case "OVERSTACK_ELIMINATED":
    case "UNIT_RETURNED_TO_POOL": // where a lost unit went: the side that lost it
    case "UNIT_LOST_FOR_GOOD":
    case "SETUP_OWNER_DONE": return sideOfOwner(e.owner);
    case "HEX_CONTROL_CHANGED": return sideOfOwner(e.to);
    case "CAPITAL_LOST":
    case "CAPITAL_RETAKEN": return sideOfOwner(e.power); // the Power it is the capital of
    case "COUNTRY_CONQUERED": return sideOfOwner(e.by) === "axis" ? "allies" : "axis"; // the conquered country's side is the other from its conqueror's
    case "RUSSIA_BRPS_MOVED": return "axis"; // the Axis capture
    case "RUSSIA_OFFERS_SURRENDER":
    case "RUSSIA_SURRENDERED":
    case "OBJECTIVES_CREDITED": return "allies"; // Russia's offer, and what it gives the Allies
    case "SURRENDER_REFUSED": return "axis"; // the Axis' answer
    case "ITALIAN_FLEET_KEPT": return "axis"; // Italy's loss, at the end of the Axis Combat Phase
    case "VICHY_CREATED": return "allies"; // France's loss, like the fall it follows
    case "WINTER_ROLLED":
    case "WINTER_STARTED": return null; // the dice and the winter itself concern both sides
    case "WINTER_POSTPONED": return "allies"; // the Allies' choice
    case "SIBERIAN_TRANSFER_USED": return "allies"; // the Allies take the unit
    case "UNITS_REMOVED_BY_CONQUEST": // no line of their own
    case "CONTROL_PASSED": return null;
    case "UNITS_SWEPT": {
      const sides = new Set(e.units.map((u) => sideOfOwner(u.owner)));
      return sides.size === 1 ? [...sides][0]! : actor;
    }
    case "AIR_STAGED":
    case "UNITS_MOVED":
    case "UNITS_REDEPLOYED":
    case "UNITS_ADVANCED": return sideOfUnits(e.units, before) ?? actor;
    case "BREAKTHROUGH":
    case "EXPLOIT_MOVED":
    case "EXPLOITERS_PLACED": return e.side;
    case "AIR_MISSION_DESIGNATED": return sideOfUnits(e.units, before) ?? actor;
    case "FLEET_DESIGNATED_FOR_SUPPLY":
    case "SEA_SUPPLY_LAPSED": return sideOfUnits(e.fleets, before) ?? actor;
    case "GROUND_SUPPORT_LOST": return e.units[0] ? sideOfOwner(e.units[0].owner) : actor;
    case "AIR_RESHAPED": return sideOfUnits(e.before.map((b) => b.id), before) ?? actor;
    case "STEPS_PASSED": return actor;
  }
}

/** Replaces the whole log (a watched game's first line), clearing the sides kept beside it: they are indexed by position in the log. */
export function resetLog(s: Pick<Session, "log" | "logSides">, lines: string[]): void {
  s.log = lines;
  s.logSides = undefined;
}
