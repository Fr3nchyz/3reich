import { ownTurnMinor, atMinorTurn } from "../engine/minors-turn";
import { combatantName } from "../engine/nations";
import { sideInWar } from "../engine/control";
import type { Session } from "./session";
import { computerToMove } from "./computerPlay";

/**
 * Spec 15 R15 (ticket 15-18, slice B): step 4 is the own turn of the attacked minors. The move and attack taps of steps 6f and 7h work there for the minor's units
 * (the engine lists only those); this file says whose window it is. No rule here.
 */

/** Whether it is step 4 of a Player Turn the player plays (not watched, not the computer's). */
export const atMinorStep = (s: Session): boolean => atMinorTurn(s.state) && !s.watch && !computerToMove(s);

/** The minors whose own turn this window is: attacked, un-helped, unconquered, with a unit on the map for the side to move. */
export function minorWindowNames(s: Session): string[] {
  const owners = new Set(Object.values(s.state.units).filter((u) => sideInWar(s.state, u.owner) === s.state.activeSide && ownTurnMinor(s.state, u.owner)).map((u) => u.owner));
  return [...owners].map((o) => combatantName(o as never));
}

/** The first words of the bar at step 4: "Belgium's own turn." */
export const minorLead = (s: Session): string => {
  const names = minorWindowNames(s);
  return names.length === 0 ? "The attacked minors' own turn." : `${names.join(" and ")}: own turn.`;
};
