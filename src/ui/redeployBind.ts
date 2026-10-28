import { cancelRedeploy, changeDestination, chooseStack, confirmRedeploy, pickDestination, setWhereOpen, tickAll, tickNone, toggleTick } from "./redeployTap";
import { takeBackReason, takeBackRedeploy } from "./redeployUndo";
import type { Session } from "./session";

/** Click and key handlers for the panel redeployView.ts draws. Each changes the session, then calls `redraw`. */

/** A key pressed inside the card: Escape throws the choice away. Returns whether the key was used (the caller then draws again). */
export function onRedeployKey(s: Session, key: string): boolean {
  if (key !== "Escape" || !s.redeploy) return false;
  cancelRedeploy(s);
  return true;
}

export function bindRedeploy(root: HTMLElement, s: Session, redraw: () => void): void {
  const on = <T extends HTMLElement>(selector: string, handler: (el: T) => void) =>
    root.querySelectorAll<T>(selector).forEach((el) => el.addEventListener("click", () => { handler(el); redraw(); }));
  on<HTMLButtonElement>("button.sr-row", (b) => chooseStack(s, b.dataset.srstack!, true));
  on<HTMLButtonElement>("button.sr-line[data-srunit]", (b) => toggleTick(s, b.dataset.srunit!));
  on<HTMLButtonElement>("button.sr-dest", (b) => pickDestination(s, b.dataset.srdest!));
  root.querySelector<HTMLDetailsElement>("#sr-where")?.addEventListener("toggle", (ev) => setWhereOpen(s, (ev.currentTarget as HTMLDetailsElement).open)); // no redraw: the page already shows it
  on("#sr-all", () => tickAll(s));
  on("#sr-none", () => tickNone(s));
  on("#sr-cancel", () => cancelRedeploy(s));
  on("#sr-confirm", () => confirmRedeploy(s));
  on("#sr-change", () => changeDestination(s));
  on("#sr-undo", () => { if (takeBackReason(s) === null) takeBackRedeploy(s); }); // an unavailable button does nothing: its reason is already on the page
  root.querySelector(".srcard")?.addEventListener("keydown", (e) => { if (onRedeployKey(s, (e as KeyboardEvent).key)) redraw(); });
}

/** Escape while a choice is open cancels it wherever the focus is on the page. `session` is read at each key, since a new game replaces it. */
export function bindRedeployEscape(target: EventTarget, session: () => Session, redraw: () => void): void {
  target.addEventListener("keydown", (e) => {
    const k = e as KeyboardEvent;
    if (!k.defaultPrevented && onRedeployKey(session(), k.key)) redraw();
  });
}
