import { computerToMove } from "./computerPlay";
import type { MapView } from "./mapView";
import { placeName } from "./names";
import { setupView, type Session } from "./session";
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
/** Watching: there are no counters of yours to choose, but a tapped hex is shown on the hex card and the button zooms to it. */
export const NOTHING_SELECTED_WATCHING = "Nothing is selected. Tap a hex to look at it, then press this again.";
/** Setup: the hex card is not shown, so a tap on a hex only places a counter; what the button can zoom to is the chosen counter's places. */
export const NOTHING_SELECTED_SETUP = "Nothing is selected. Pick a counter to place first.";
/** The computer's Player Turn (or its Exchange losses): the player has nothing to choose, but a tapped hex is still looked at. */
export const NOTHING_SELECTED_COMPUTER = "It is the computer's turn. Tap a hex to look at it.";
/** Step 3 (Front Options): the options are chosen on their card, not on the map; a tapped hex is still looked at. */
export const NOTHING_SELECTED_STEP3 = "Nothing to select at this step. Tap a hex to look at it.";

/** The words for pressing the target button with nothing to zoom to, true for what the game is doing now (setup, watching, the computer's turn, step 3, else playing). */
export function nothingSelectedText(s: Session): string {
  if (s.state.phase === "setup") return NOTHING_SELECTED_SETUP;
  if (s.watch) return NOTHING_SELECTED_WATCHING;
  if (computerToMove(s)) return NOTHING_SELECTED_COMPUTER;
  if (s.state.position?.part === "player-turn" && s.state.position.step === "3") return NOTHING_SELECTED_STEP3;
  return NOTHING_SELECTED;
}

/**
 * Whether the player can choose a stack now (a map tap or this button has something to pick): step 6f of their own Player Turn, or setting up
 * (the human's own counter to place). Only then is "nothing is selected" worth a line over the map; on the computer's turn, at step 3, in a watched game and
 * at the other steps the line would only cover the map's refused-move line, so it is spoken (the status line) but not shown.
 */
export function canChooseStack(s: Session): boolean {
  if (s.state.phase === "setup") return !s.watch && setupView(s) !== null; // the human's own placing, not a watched game or the computer's
  // No other step chooses a stack: step 7h and 7b pick hexes and units through their cards and buttons, and the rest have no map choice.
  const at = s.state.position;
  return s.state.phase === "player-turn" && !s.watch && !computerToMove(s) && at?.part === "player-turn" && (at.step === "6f" || at.step === "9e");
}

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
  nothing: () => string = () => NOTHING_SELECTED,
  showNote: () => boolean = () => true,
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
  let nothingSaid = "";
  const selected = (): string => {
    const look = looked();
    const target = zoomToSelection(view, look);
    if (target === "none") return (nothingSaid = nothing());
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
    note(said === nothingSaid && showNote() ? said : "");
  });
}
