import { cancelMove, chooseStack, goTo, setWhereOpen, tickAll, tickNone, toggleTick } from "./moveTap";
import { takeBack, takeBackReason } from "./moveUndo";
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
  on<HTMLButtonElement>("button.dest-row", (b) => goTo(s, b.dataset.dest!));
  root.querySelector<HTMLDetailsElement>("#move-where")?.addEventListener("toggle", (ev) => setWhereOpen(s, (ev.currentTarget as HTMLDetailsElement).open)); // no redraw: the page already shows it
  on("#move-all", () => tickAll(s));
  on("#move-none", () => tickNone(s));
  on("#move-cancel", () => cancelMove(s));
  on("#move-undo", () => { if (takeBackReason(s) === null) takeBack(s); }); // an unavailable button does nothing: its reason is already on the page
  root.querySelector(".movecard")?.addEventListener("keydown", (e) => { if (onMoveKey(s, (e as KeyboardEvent).key)) redraw(); });
}

/**
 * Escape while a choice is open cancels it wherever the focus is on the page (a tap elsewhere on the map may have moved the focus out of the card).
 * `session` is read at each key, since a new game replaces it. Listens on `target` (the document); `redraw` draws again when the key was used.
 */
export function bindMoveEscape(target: EventTarget, session: () => Session, redraw: () => void): void {
  target.addEventListener("keydown", (e) => {
    const k = e as KeyboardEvent;
    const s = session();
    if (!k.defaultPrevented && s.moveChosen && onMoveKey(s, k.key)) redraw();
  });
}
