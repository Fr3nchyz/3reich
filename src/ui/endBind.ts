import type { MapView } from "./mapView";
import { objectiveStandings } from "../engine/objectives";
import type { Session } from "./session";

/** Click handlers, focus and map sync for the victory cards (spec 14, part D1, D2), in the style of statusBind.ts: each changes the session, then `redraw`. */

export interface EndOps {
  /** The title-screen "New game" button (the header's), pressed for the card. */
  newGame: () => void;
}

/** Keeps Tab inside an open dialog: from the last control to the first, and back. */
function trapTab(card: HTMLElement, e: KeyboardEvent): void {
  const items = Array.from(card.querySelectorAll<HTMLElement>("button, [tabindex='-1']")).filter((el) => !el.hasAttribute("disabled"));
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function bindEnd(root: HTMLElement, s: Session, redraw: () => void, ops: EndOps): void {
  const on = (selector: string, handler: (el: HTMLElement) => void, after?: string) =>
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => el.addEventListener("click", () => {
      handler(el);
      redraw();
      if (after) root.querySelector<HTMLElement>(after)?.focus();
    }));
  const toggle = () => { s.objectivesOpen = !s.objectivesOpen; s.objectivesFresh = s.objectivesOpen; };
  on("#obj-open", toggle);
  on("#obj-close", () => { s.objectivesOpen = false; }, "#obj-open");
  on("button[data-objhex]", (b) => { s.mapFocus = b.dataset.objhex!; });
  on("#end-look", () => { s.endDismissed = true; }, "#obj-open");
  on("#end-show", () => { s.endDismissed = false; s.endFresh = true; });
  on("#end-log", () => { s.endDismissed = true; }, ".log");
  on("#end-new", () => ops.newGame());
  root.querySelector(".objcard")?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") { s.objectivesOpen = false; redraw(); root.querySelector<HTMLElement>("#obj-open")?.focus(); }
  });
  root.querySelector<HTMLElement>(".endcard")?.addEventListener("keydown", (key) => {
    if (key.key === "Escape") { s.endDismissed = true; redraw(); root.querySelector<HTMLElement>("#obj-open")?.focus(); }
    else if (key.key === "Tab") trapTab(root.querySelector<HTMLElement>(".endcard")!, key);
  });
}

/** After a card opens: its heading takes the keyboard focus, once; the Objectives card is scrolled just far enough to be seen. */
export function revealEnd(root: HTMLElement, s: Session): void {
  if (s.state.phase === "game-over" && s.endDismissed !== true && s.endFresh !== false && !s.watch) {
    const heading = root.querySelector<HTMLElement>("#end-title");
    if (heading) { s.endFresh = false; heading.focus({ preventScroll: true }); }
  }
  if (s.objectivesFresh) {
    s.objectivesFresh = false;
    const heading = root.querySelector<HTMLElement>("#obj-title");
    if (heading) { heading.focus({ preventScroll: true }); heading.parentElement?.parentElement?.scrollIntoView({ block: "nearest" }); }
  }
}

/** The winter question (spec 14, D4): when its card first appears the heading takes the keyboard focus, once, and the card is scrolled into view; the game waits for the answer. The card that only tells (OK) takes nothing. */
export function revealWinter(root: HTMLElement, s: Session): void {
  const card = root.querySelector<HTMLElement>("#winter-card[data-kind='ask']");
  const key = `${s.state.year}-${s.state.season}`;
  if (!card) { if (s.winterFocused === key) s.winterFocused = undefined; return; }
  if (s.winterFocused === key) return;
  s.winterFocused = key;
  root.querySelector<HTMLElement>("#winter-title")?.focus({ preventScroll: true });
  card.scrollIntoView({ block: "nearest" });
}

/** The map follows the card: the Objective marks (a square, a circle or a dashed ring by holder) and, once, the centring a tap on a name asked for. Nothing during setup. */
export function syncObjectives(view: MapView, s: Session): void {
  view.setObjectiveMarks(s.state.phase === "setup" ? null : objectiveStandings(s.ctx, s.state));
  if (s.mapFocus) {
    view.focus([s.mapFocus]);
    s.mapFocus = null;
  }
}
