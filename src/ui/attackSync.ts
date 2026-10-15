import type { Action } from "../engine/actions";
import { attackTargets } from "./attackDraft";
import { attacking } from "./attackTap";
import type { MapView } from "./mapView";
import type { Session } from "./session";

/** Whether these hexes are all inside the visible map, clear of its edges and of the hex line over its bottom (true when there is no map to measure). */
export function shownOnMap(ids: readonly string[]): boolean {
  if (typeof document === "undefined") return true;
  const svg = document.querySelector("svg.map");
  if (!svg) return true;
  const box = svg.getBoundingClientRect();
  return ids.every((id) => {
    const p = svg.querySelector(`polygon[data-id="${id}"]`);
    if (!p) return true;
    const r = p.getBoundingClientRect();
    return r.left >= box.left + 8 && r.right <= box.right - 8 && r.top >= box.top + 8 && r.bottom <= box.bottom - 56;
  });
}

/**
 * Brings the attack marks of the map in line with the session (spec 07, 07-5): at the player's step 7h every hex that can be attacked is dashed;
 * with the card open the chosen target is thick and the hexes of the chosen attackers are gold, changing as the chips do. Marks are cleared
 * everywhere else, so they never show on the computer's turn, in watch mode or at another step.
 */
export function syncAttackMarks(view: MapView, s: Session, actions: readonly Action[], shown: (ids: readonly string[]) => boolean = shownOnMap): void {
  if (!attacking(s)) {
    view.clearAttackMarks();
    return;
  }
  const d = s.attack;
  const attackers = d ? d.units.flatMap((id) => s.state.units[id]?.at ?? []) : [];
  view.setAttackMarks({ targets: attackTargets(actions), chosen: d?.target ?? null, attackers });
  if (d?.focus) {
    d.focus = false; // once, when the card is opened from the list: the map moves only if the target or an attacker is out of sight
    const ids = [d.target, ...attackers];
    if (!shown(ids)) view.focus(ids);
  }
}
