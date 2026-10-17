import { cancelAir, confirmAir, openAir, toggleAir } from "./airTap";
import type { Session } from "./session";

/** Click and key handlers for the air list and card airCardView.ts draws. Each changes the session, then calls `redraw`. */

/** A key pressed inside the air card: Escape throws the draft away. Returns whether the key was used (the caller then draws again). */
export function onAirKey(s: Session, key: string): boolean {
  if (key !== "Escape") return false;
  cancelAir(s);
  return true;
}

export function bindAir(root: HTMLElement, s: Session, redraw: () => void): void {
  const on = <T extends HTMLElement>(selector: string, handler: (el: T) => void) =>
    root.querySelectorAll<T>(selector).forEach((el) => el.addEventListener("click", () => { handler(el); redraw(); }));
  on<HTMLButtonElement>("button.air-row", (b) => { if (s.airDraft?.target === b.dataset.airtarget) cancelAir(s); else openAir(s, b.dataset.airtarget!, true); });
  on<HTMLButtonElement>("button.chip[data-plane]", (b) => toggleAir(s, b.dataset.plane!));
  on("#air-cancel", () => cancelAir(s));
  on("#air-go", () => confirmAir(s));
  root.querySelector(".aircard")?.addEventListener("keydown", (e) => { if (onAirKey(s, (e as KeyboardEvent).key)) redraw(); });
}
