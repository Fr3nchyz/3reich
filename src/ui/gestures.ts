import { pinchStep, readFingers, type Finger, type Reading } from "./pinch";
import { createTapTracker } from "./tap";
import type { Viewport } from "./viewport";

/** Wheel, drag, pinch and tap on the map. Pointer events cover mouse and touch. */

/** One wheel notch zooms by this factor (out for a downward notch, in for an upward one). */
export const ZOOM_STEP = 1.15;

/** Safari's own pinch event (not in the standard typings): `scale` is the size since the gesture began. */
interface GestureLike extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

/**
 * Wires the gestures on `svg` to the viewport. `onTap` gets the screen position of a tap (and is
 * never called for the end of a drag or pinch).
 */
export function attachGestures(svg: SVGSVGElement, viewport: Viewport, onTap?: (clientX: number, clientY: number) => void): void {
  svg.addEventListener("wheel", (e) => { e.preventDefault(); viewport.zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP); }, { passive: false });
  const pointers = new Map<number, Finger>();
  const tap = createTapTracker();
  /** The last reading of the two fingers, while exactly two are down. */
  let pinch: Reading | null = null;
  const twoFingers = (): Reading | null => (pointers.size === 2 ? readFingers(...([...pointers.values()] as [Finger, Finger])) : null);
  svg.addEventListener("pointerdown", (e) => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tap.down(e.pointerId, e.clientX, e.clientY, pointers.size);
    pinch = twoFingers();
  });
  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = twoFingers();
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
    const now = twoFingers();
    if (pinch && now) {
      const step = pinchStep(pinch, now);
      if (step.panX || step.panY) viewport.panBy(step.panX, step.panY);
      if (step.factor !== 1) viewport.zoomAt(now.mx, now.my, step.factor);
    }
    pinch = now;
  });

  // Safari. With two fingers down it may take the pinch for a zoom of the whole page; these keep it on the map.
  // (The CSS `touch-action: none` on the map does the same job where the browser honours it.)
  svg.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  let seen = 1;
  svg.addEventListener("gesturestart", (e) => { e.preventDefault(); seen = 1; });
  svg.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    const { scale, clientX, clientY } = e as GestureLike;
    // A trackpad pinch arrives only as this event; a touch pinch arrives as pointers too and is already handled above.
    if (pointers.size === 0 && scale > 0) viewport.zoomAt(clientX, clientY, seen / scale);
    seen = scale;
  });
  svg.addEventListener("gestureend", (e) => e.preventDefault());
}
