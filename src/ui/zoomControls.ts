import type { MapView } from "./mapView";
import { placeName } from "./names";
import type { Session } from "./session";
import type { Shell } from "./shell";
import { BUTTON_ZOOM_STEP, MAX_ZOOM_IN, MAX_ZOOM_OUT } from "./viewport";

/**
 * The four zoom buttons over the map (spec 08): zoom in, zoom out, show the whole map, zoom to what is selected
 * (the outlined hexes, else the hex shown on the hex card, else a message you can see for a few seconds).
 * Each is a real button of at least 44 px with a name for screen readers; a press says in words what it did.
 */

const icon = (path: string) => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const button = (action: string, label: string, face: string) =>
  `<button type="button" data-zoom="${action}" aria-label="${label}" title="${label}">${face}</button>`;

const SELECTED_LABEL = "Zoom to the selected hex or counter";

/** The buttons' markup, top to bottom. The + and - are drawn as lines so they look the same everywhere. */
export const ZOOM_BUTTONS = [
  button("in", "Zoom in", icon('<path d="M12 5v14M5 12h14"/>')),
  button("out", "Zoom out", icon('<path d="M5 12h14"/>')),
  button("whole", "Show the whole map", icon('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')),
  button("selected", SELECTED_LABEL, icon('<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>')),
].join("");

/** What a screen reader hears after a press, from the zoom level reached (1 = the whole map just fits). */
export function zoomSaid(level: number): string {
  if (level >= MAX_ZOOM_IN - 0.01) return "Zoomed in as far as it goes";
  if (level <= 1 / MAX_ZOOM_OUT + 0.01) return "Zoomed out as far as it goes";
  const n = Math.round(level * 10) / 10;
  if (n < 1) return "Zoomed out a little past the whole map";
  return n === 1 ? "Zoom 1 time" : `Zoom ${String(n)} times`;
}

/** Wait before a spoken line is set again, so that the same words twice are two changes to the status line and are read twice. */
export const REPEAT_GAP_MS = 60;

export const NOTHING_SELECTED = "Nothing is selected. Choose one of your counters first.";

/** How long the message for "nothing is selected" stays on the map before it goes by itself. */
export const NOTE_MS = 4000;

/** The hex shown on the hex card (spec 07, part A), with its name; null during setup, where the card is not shown, and when none is. */
export interface Looked { id: string; name: string }
export function lookedHex(s: Session): Looked | null {
  return s.state.phase === "setup" || !s.lookedAt ? null : { id: s.lookedAt, name: placeName(s.ctx.map, s.lookedAt) };
}

/** What the target button zooms to, in order: the outlined hexes (a chosen stack's or counter's places), then the hex on the hex card, else nothing. */
export type ZoomTarget = "outlined" | "hex" | "none";
export function zoomToSelection(view: Pick<MapView, "focusOutlined" | "focus">, looked: Looked | null): ZoomTarget {
  if (view.focusOutlined()) return "outlined";
  if (!looked) return "none";
  view.focus([looked.id]); // centred, with a few hexes around it, and held inside the zoom limits like any fit
  return "hex";
}

type Timer = (run: () => void, ms: number) => void;

export function bindZoom(
  shell: Pick<Shell, "zoom" | "zoomSay" | "zoomNote">,
  view: MapView,
  looked: () => Looked | null,
  later: (run: () => void) => void = (run) => { setTimeout(run, REPEAT_GAP_MS); },
  after: Timer = (run, ms) => { setTimeout(run, ms); },
): void {
  let turn = 0;
  let noteTurn = 0;
  /** Clears the status line, then sets the words a moment later: a screen reader only speaks a change, and a second press at a limit says the same words. */
  const say = (text: string) => {
    const mine = ++turn;
    shell.zoomSay.textContent = "";
    later(() => { if (mine === turn) shell.zoomSay.textContent = text; });
  };
  /** The same words where a sighted player sees them, for NOTE_MS; every press replaces or clears the last one. */
  const note = (text: string) => {
    const mine = ++noteTurn;
    shell.zoomNote.textContent = text;
    if (text) after(() => { if (mine === noteTurn) shell.zoomNote.textContent = ""; }, NOTE_MS);
  };
  const selected = (): string => {
    const look = looked();
    const target = zoomToSelection(view, look);
    if (target === "none") return NOTHING_SELECTED;
    return target === "hex" ? `Zoomed to the hex ${look!.name}` : "Zoomed to the selected counter";
  };
  const actions: Record<string, () => string> = {
    in: () => zoomSaid(view.zoomBy(1 / BUTTON_ZOOM_STEP)),
    out: () => zoomSaid(view.zoomBy(BUTTON_ZOOM_STEP)),
    whole: () => { view.focus([]); return "Showing the whole map"; },
    selected,
  };
  shell.zoom.addEventListener("click", (e) => {
    const action = (e.target as Element).closest<HTMLElement>("button[data-zoom]")?.dataset.zoom;
    if (!action) return;
    const said = actions[action]!();
    say(said);
    note(said === NOTHING_SELECTED ? said : "");
  });
}
