import type { Action, GameEvent } from "../engine/actions";
import { sideOfOwner } from "../engine/setup";
import type { Side } from "../engine/types";
import type { Session } from "./session";

/**
 * Which side each line of the activity log belongs to, for its colour (the owner's request: red for Axis, blue for Allies).
 * Kept beside the log, never in it: Session.log stays a list of strings, the saved game record and the engine are untouched, and
 * `Session.logSides` maps an entry's index to a side. An entry with no mark is plain, so a line pushed straight to `log` can
 * never put the two out of step.
 *
 * The rule: a line belongs to the side whose action produced it (the side that moved, attacked, built, chose losses, set up, or
 * whose computer opponent wrote the line). Where the line is not about the actor, it takes the side it names: a player turn
 * beginning, a nation's treasury changing. Lines about both sides or about the game itself stay plain.
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
    case "SETUP_PLACE":
    case "SETUP_REMOVE":
    case "SETUP_DONE": return sideOfOwner(a.owner);
    default: return a.side;
  }
}

/** The side of a line written for this event of an action taken by `actor`; null for a line that is about both sides or about the game. */
export function eventSide(e: GameEvent, actor: Side): Side | null {
  switch (e.type) {
    case "INITIATIVE_DETERMINED":
    case "SETUP_COMPLETE":
    case "GAME_OVER": return null;
    case "PLAYER_TURN_STARTED":
    case "FRONT_OPTION_SELECTED":
    case "LOSSES_CHOSEN": return e.side; // LOSSES_CHOSEN: the side that chose, who may be the defender
    case "BRPS_CHANGED": return sideOfOwner(e.nation); // a nation's own treasury, whoever's action moved it (a Year Start, say)
    default: return actor;
  }
}
