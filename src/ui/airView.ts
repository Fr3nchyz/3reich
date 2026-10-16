import type { Action } from "../engine/actions";
import { airOf } from "../engine/air-record";
import { committedAt } from "../engine/air-support";
import { combatOf } from "../engine/combat-record";
import { placeName } from "./names";
import { escape } from "./mapGeometry";
import type { Session } from "./session";

/**
 * The words around air support (spec 09 part D2): the note at step 7b that explains the buttons, and the warning at step 7h about a hex that air
 * is committed to and that has not been attacked yet. No rule here: the buttons are the engine's `DESIGNATE_AIR` actions, and the hexes come from
 * the air record.
 */

/** The note above the air-support buttons of step 7b; empty when the engine lists none. */
export function airPromptHtml(actions: readonly Action[]): string {
  if (!actions.some((a) => a.type === "DESIGNATE_AIR")) return "";
  return `<p class="note air-note">Air support (step 7b): each button commits planes that can reach that hex. Their factors are added to your attack on it, up to three times the ground factors, and a plane flies one mission each turn. A hex you commit planes to must be attacked this turn or the planes are lost, and a commitment cannot be taken back. Press "Done with step 7b" to commit nothing.</p>`;
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
