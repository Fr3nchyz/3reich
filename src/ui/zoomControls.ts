import type { MapView } from "./mapView";
import type { Shell } from "./shell";
import { BUTTON_ZOOM_STEP, MAX_ZOOM_IN, MAX_ZOOM_OUT } from "./viewport";

/**
 * The four zoom buttons over the map (spec 08): zoom in, zoom out, show the whole map, zoom to what is selected.
 * Each is a real button of at least 44 px with a name for screen readers; a press says in words what it did.
 */

const icon = (path: string) => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const button = (action: string, label: string, face: string) =>
  `<button type="button" data-zoom="${action}" aria-label="${label}" title="${label}">${face}</button>`;

/** The buttons' markup, top to bottom. The + and - are drawn as lines so they look the same everywhere. */
export const ZOOM_BUTTONS = [
  button("in", "Zoom in", icon('<path d="M12 5v14M5 12h14"/>')),
  button("out", "Zoom out", icon('<path d="M5 12h14"/>')),
  button("whole", "Show the whole map", icon('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')),
  button("selected", "Zoom to the selected counter", icon('<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>')),
].join("");

/** What a screen reader hears after a press, from the zoom level reached (1 = the whole map just fits). */
export function zoomSaid(level: number): string {
  if (level >= MAX_ZOOM_IN - 0.01) return "Zoomed in as far as it goes";
  if (level <= 1 / MAX_ZOOM_OUT + 0.01) return "Zoomed out as far as it goes";
  return `Zoom ${String(Math.round(level * 10) / 10)} times`;
}

export const NOTHING_SELECTED = "Nothing is selected. Choose one of your counters first.";

export function bindZoom(shell: Pick<Shell, "zoom" | "zoomSay">, view: MapView): void {
  const say = (text: string) => { shell.zoomSay.textContent = text; };
  const actions: Record<string, () => string> = {
    in: () => zoomSaid(view.zoomBy(1 / BUTTON_ZOOM_STEP)),
    out: () => zoomSaid(view.zoomBy(BUTTON_ZOOM_STEP)),
    whole: () => { view.focus([]); return "Showing the whole map"; },
    selected: () => (view.focusOutlined() ? "Zoomed to the selected counter" : NOTHING_SELECTED),
  };
  shell.zoom.addEventListener("click", (e) => {
    const action = (e.target as Element).closest<HTMLElement>("button[data-zoom]")?.dataset.zoom;
    if (action) say(actions[action]!());
  });
}
