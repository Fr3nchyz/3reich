import type { Session } from "./session";
import type { MapView } from "./mapView";
import { overlayCells, overlayLegend } from "./overlayModel";
import type { Shell } from "./shell";

/** The button that shows or hides the control overlay (off by default) and the key under it. Holds only that one switch. */

const TEXT = { off: "Show control and zones", on: "Hide control and zones" };

export interface OverlayToggle {
  /** Redraws the overlay for the game as it now stands (call after each change); does nothing while it is off. */
  refresh(s: Session): void;
}

export function bindOverlay(shell: Pick<Shell, "overlay" | "legend">, view: MapView, current: () => Session): OverlayToggle {
  let on = false;
  const refresh = (s: Session): void => {
    shell.overlay.setAttribute("aria-pressed", String(on));
    shell.overlay.textContent = on ? TEXT.on : TEXT.off;
    shell.legend.hidden = !on;
    if (!on) {
      view.setOverlay(null);
      shell.legend.replaceChildren();
      return;
    }
    const cells = overlayCells(s.ctx, s.state);
    view.setOverlay(cells);
    shell.legend.replaceChildren(...overlayLegend(cells).map((line) => Object.assign(document.createElement("p"), { textContent: line })));
  };
  shell.overlay.addEventListener("click", () => { on = !on; refresh(current()); });
  return { refresh };
}
