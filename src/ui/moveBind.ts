import { cancelMove, chooseStack, tickAll, tickNone, toggleTick } from "./moveTap";
import type { Session } from "./session";

/** Click and key handlers for the list and the Move card moveView.ts draws. Each changes the session, then calls `redraw`. */

/** A key pressed inside the Move card: Escape throws the choice away. Returns whether the key was used (the caller then draws again). */
export function onMoveKey(s: Session, key: string): boolean {
  if (key !== "Escape") return false;
  cancelMove(s);
  return true;
}

export function bindMove(root: HTMLElement, s: Session, redraw: () => void): void {
  const on = <T extends HTMLElement>(selector: string, handler: (el: T) => void) =>
    root.querySelectorAll<T>(selector).forEach((el) => el.addEventListener("click", () => { handler(el); redraw(); }));
  on<HTMLButtonElement>("button.stack-row", (b) => chooseStack(s, b.dataset.stack!, true));
  on<HTMLButtonElement>("button.mline[data-unit]", (b) => toggleTick(s, b.dataset.unit!));
  on("#move-all", () => tickAll(s));
  on("#move-none", () => tickNone(s));
  on("#move-cancel", () => cancelMove(s));
  root.querySelector(".movecard")?.addEventListener("keydown", (e) => { if (onMoveKey(s, (e as KeyboardEvent).key)) redraw(); });
}
