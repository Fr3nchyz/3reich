import { cancelAttack, closeResult, confirmAttack, openAttack, toggleAttacker } from "./attackTap";
import type { Session } from "./session";

/** Click and key handlers for the attack list, card and result card attackView.ts and resultView.ts draw. Each changes the session, then calls `redraw`. */

export function bindAttack(root: HTMLElement, s: Session, redraw: () => void): void {
  const on = <T extends HTMLElement>(selector: string, handler: (el: T) => void) =>
    root.querySelectorAll<T>(selector).forEach((el) => el.addEventListener("click", () => { handler(el); redraw(); }));
  on<HTMLButtonElement>("button.attack-row", (b) => { if (s.attack?.target === b.dataset.target) cancelAttack(s); else openAttack(s, b.dataset.target!, true); });
  on<HTMLButtonElement>("button.chip[data-unit]", (b) => toggleAttacker(s, b.dataset.unit!));
  on("#attack-cancel", () => cancelAttack(s));
  on("#attack-go", () => confirmAttack(s));
  on("#result-close", () => closeResult(s));
  root.querySelector(".attackcard")?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") { cancelAttack(s); redraw(); }
  });
  root.querySelector(".resultcard")?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") { closeResult(s); redraw(); }
  });
}
