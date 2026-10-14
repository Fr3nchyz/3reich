import type { Session } from "./session";
import type { MapView } from "./mapView";
import { overlayCells, overlayLegend, type OverlayCells } from "./overlayModel";
import type { Shell } from "./shell";

/** The button that shows or hides the control overlay (off by default) and the key under it. Holds only that one switch. */

export interface OverlayToggle {
  /** Redraws the overlay for the game as it now stands (call after each change); does nothing while it is off or while the position is the one already drawn. */
  refresh(s: Session): void;
}

export function bindOverlay(shell: Pick<Shell, "overlay" | "legend">, view: MapView, current: () => Session): OverlayToggle {
  let on = false;
  /** The cells now on the map, so an unchanged position is not drawn again (the computer plays in many small steps). */
  let drawn: OverlayCells | null = null;
  const refresh = (s: Session): void => {
    shell.overlay.setAttribute("aria-pressed", String(on));
    shell.legend.hidden = !on;
    if (!on) {
      if (drawn) { view.setOverlay(null); shell.legend.replaceChildren(); drawn = null; }
      return;
    }
    const cells = overlayCells(s.ctx, s.state);
    if (cells === drawn) return;
    drawn = cells;
    view.setOverlay(cells);
    shell.legend.replaceChildren(...overlayLegend(cells).map((line) => Object.assign(document.createElement("p"), { textContent: line })));
  };
  shell.overlay.addEventListener("click", () => { on = !on; refresh(current()); });
  return { refresh };
}
