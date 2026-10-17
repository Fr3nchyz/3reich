import { airOf } from "../engine/air-record";
import { committedAt } from "../engine/air-support";
import { combatOf } from "../engine/combat-record";
import { computerToMove } from "./computerPlay";
import { placeName } from "./names";
import { escape } from "./mapGeometry";
import type { Session } from "./session";

/**
 * The words around air support (spec 09 part D2) that are not the air card (airCardView.ts): whether it is step 7b, and the warning at step 7h about
 * a hex that air is committed to and that has not been attacked yet. No rule here: the hexes come from the air record.
 */

/** Whether it is step 7b of a game the player plays (not watched) and the player's turn: the step that waits for the air buttons. */
export function atStep7b(s: Session): boolean {
  const p = s.state.position;
  return s.state.phase === "player-turn" && p?.part === "player-turn" && p.step === "7b" && !s.watch && !computerToMove(s);
}

/** The hexes air is committed to and not attacked yet (an Exchange still waiting for its losses counts as attacked), in id order. */
export function committedHexes(s: Session): string[] {
  const attacked = combatOf(s.state).targets;
  return Object.keys(airOf(s.state).groundSupport)
    .filter((hex) => committedAt(s.state, hex).length > 0 && !attacked.includes(hex))
    .sort();
}

/** The warning of step 7h: attack these hexes or their planes are lost; empty when none is committed. */
export function airWarningHtml(s: Session): string {
  const hexes = committedHexes(s);
  if (hexes.length === 0) return "";
  const names = hexes.map((h) => placeName(s.ctx.map, h));
  return `<p class="warn air-warn" role="status">Air is committed to ${escape(names.join(" and "))}: ${hexes.length === 1 ? "attack that hex" : "attack those hexes"} before you finish step 7h, or the planes are lost.</p>`;
}
