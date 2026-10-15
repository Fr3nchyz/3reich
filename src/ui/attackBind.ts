import { cancelAttack, closeResult, confirmAttack, openAttack, toggleAttacker } from "./attackTap";
import type { Session } from "./session";

/** Click and key handlers for the attack list, card and result card attackView.ts and resultView.ts draw. Each changes the session, then calls `redraw`. */

/** A key pressed inside the attack card or the result card: Escape throws the draft away, or closes the result. Returns whether the key was used (the caller then draws again). */
export function onCardKey(s: Session, card: "attack" | "result", key: string): boolean {
  if (key !== "Escape") return false;
  if (card === "attack") cancelAttack(s);
  else closeResult(s);
  return true;
}

export function bindAttack(root: HTMLElement, s: Session, redraw: () => void): void {
  const on = <T extends HTMLElement>(selector: string, handler: (el: T) => void) =>
    root.querySelectorAll<T>(selector).forEach((el) => el.addEventListener("click", () => { handler(el); redraw(); }));
  on<HTMLButtonElement>("button.attack-row", (b) => { if (s.attack?.target === b.dataset.target) cancelAttack(s); else openAttack(s, b.dataset.target!, true); });
  on<HTMLButtonElement>("button.chip[data-unit]", (b) => toggleAttacker(s, b.dataset.unit!));
  on("#attack-cancel", () => cancelAttack(s));
  on("#attack-go", () => confirmAttack(s));
  on("#result-close", () => closeResult(s));
  for (const card of ["attack", "result"] as const) {
    root.querySelector(`.${card}card`)?.addEventListener("keydown", (e) => { if (onCardKey(s, card, (e as KeyboardEvent).key)) redraw(); });
  }
}
