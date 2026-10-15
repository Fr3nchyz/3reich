import type { Action } from "../engine/actions";
import { attackTargets } from "./attackDraft";
import { attacking } from "./attackTap";
import type { MapView } from "./mapView";
import type { Session } from "./session";

/**
 * Brings the attack marks of the map in line with the session (spec 07, 07-5): at the player's step 7h every hex that can be attacked is dashed;
 * with the card open the chosen target is thick and the hexes of the chosen attackers are gold, changing as the chips do. Marks are cleared
 * everywhere else, so they never show on the computer's turn, in watch mode or at another step.
 */
export function syncAttackMarks(view: MapView, s: Session, actions: readonly Action[]): void {
  if (!attacking(s)) {
    view.clearAttackMarks();
    return;
  }
  const d = s.attack;
  const attackers = d ? d.units.flatMap((id) => s.state.units[id]?.at ?? []) : [];
  view.setAttackMarks({ targets: attackTargets(actions), chosen: d?.target ?? null, attackers });
  if (d?.focus) {
    d.focus = false; // once, when the card is opened from the list: the map shows the target and the units that attack it
    view.focus([d.target, ...attackers]);
  }
}
