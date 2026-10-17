import { cancelAirMove, chooseBase, joinPlanes, openPlacement, placeAt, splitPlane, stageTo, tickAllPlanes, tickNoPlanes, togglePlane, toggleRange } from "./airMoveTap";
import type { PowerId } from "../engine/types";
import type { Session } from "./session";

/** Click and key handlers for the planes list and card and the airbases airMoveView.ts draws. Each changes the session, then calls `redraw`. */

/** A key pressed inside the planes card or the airbase card: Escape throws the choice away. Returns whether the key was used (the caller then draws again). */
export function onPlaneKey(s: Session, key: string): boolean {
  if (key !== "Escape") return false;
  cancelAirMove(s);
  return true;
}

export function bindAirMove(root: HTMLElement, s: Session, redraw: () => void): void {
  const on = <T extends HTMLElement>(selector: string, handler: (el: T) => void) =>
    root.querySelectorAll<T>(selector).forEach((el) => el.addEventListener("click", () => { handler(el); redraw(); }));
  on<HTMLButtonElement>("button[data-planebase]", (b) => { if (s.airMove?.hex === b.dataset.planebase) cancelAirMove(s); else chooseBase(s, b.dataset.planebase!, true); });
  on<HTMLButtonElement>("button[data-pline]", (b) => togglePlane(s, b.dataset.pline!));
  on<HTMLButtonElement>("button[data-tobase]", (b) => stageTo(s, b.dataset.tobase!));
  on<HTMLButtonElement>("button[data-parts]", (b) => splitPlane(s, b.dataset.parts!.split(",").map(Number)));
  on<HTMLButtonElement>("button[data-airowner]", (b) => openPlacement(s, b.dataset.airowner as PowerId));
  on<HTMLButtonElement>("button[data-placehex]", (b) => placeAt(s, b.dataset.placehex!));
  on("#plane-all", () => tickAllPlanes(s));
  on("#plane-none", () => tickNoPlanes(s));
  on("#plane-range", () => toggleRange(s));
  on("#plane-join", () => joinPlanes(s));
  on("#plane-cancel", () => cancelAirMove(s));
  on("#airbase-cancel", () => cancelAirMove(s));
  for (const card of [".planecard", ".airbasecard"]) root.querySelector(card)?.addEventListener("keydown", (e) => { if (onPlaneKey(s, (e as KeyboardEvent).key)) redraw(); });
}
