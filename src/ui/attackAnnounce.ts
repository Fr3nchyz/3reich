import { airAnnouncement } from "./airCardView";
import { announcement } from "./attackText";
import { draftPreview } from "./attackView";
import { moveAnnouncement } from "./moveView";
import type { Session } from "./session";

/**
 * The polite live line for screen readers (spec 07, part D): one sentence after each change of the open attack card ("Odds 1-1: 7 against 4."),
 * nothing while there is no card or nothing changed (the Move card of step 6f speaks the same way, spec 10). The line is a node outside the redrawn status area, so that a redraw does not hide it.
 */
export function announceAttack(live: HTMLElement, s: Session): void {
  const p = draftPreview(s);
  const text = p ? `${p.targetName}. ${announcement(p)}` : airAnnouncement(s) || moveAnnouncement(s);
  if (live.textContent !== text) live.textContent = text;
}
