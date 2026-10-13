import { createTapTracker } from "./tap";
import type { Viewport } from "./viewport";

/** Wheel, drag, pinch and tap on the map. Pointer events cover mouse and touch. */

/** One wheel notch zooms by this factor (out for a downward notch, in for an upward one). */
export const ZOOM_STEP = 1.15;

interface Pos {
  x: number;
  y: number;
}

/**
 * Wires the gestures on `svg` to the viewport. `onTap` gets the screen position of a tap (and is
 * never called for the end of a drag or pinch).
 */
export function attachGestures(svg: SVGSVGElement, viewport: Viewport, onTap?: (clientX: number, clientY: number) => void): void {
  svg.addEventListener("wheel", (e) => { e.preventDefault(); viewport.zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP); }, { passive: false });
  const pointers = new Map<number, Pos>();
  const tap = createTapTracker();
  let pinch = 0;
  svg.addEventListener("pointerdown", (e) => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tap.down(e.pointerId, e.clientX, e.clientY, pointers.size);
  });
  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = 0;
    if (tap.end(e.pointerId, e.type === "pointerup") && onTap) onTap(e.clientX, e.clientY);
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    tap.move(e.clientX, e.clientY, pointers.size);
    if (pointers.size === 1) viewport.panBy(e.clientX - prev.x, e.clientY - prev.y);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [Pos, Pos];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) viewport.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch / d);
      pinch = d;
    }
  });
}
