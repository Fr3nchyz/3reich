/**
 * The two-finger gesture, as pure maths: a reading is where the fingers are (their middle and the gap), and a
 * step is what the map does between two readings. The first reading is taken the moment the second finger lands,
 * so nothing a finger does afterwards is lost.
 */

/** Fingers closer together than this (screen pixels) give no zoom: the gap would be about to cross zero. */
export const MIN_PINCH_GAP_PX = 4;

export interface Finger {
  x: number;
  y: number;
}

/** Where two fingers are: the middle between them and the gap. */
export interface Reading {
  mx: number;
  my: number;
  d: number;
}

export const readFingers = (a: Finger, b: Finger): Reading => ({ mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) });

/** What to do between two readings: drag the map by (panX, panY), then zoom about the new middle by `factor` (above 1 shows more). */
export interface Step {
  panX: number;
  panY: number;
  factor: number;
}

export function pinchStep(prev: Reading, next: Reading): Step {
  const usable = prev.d >= MIN_PINCH_GAP_PX && next.d >= MIN_PINCH_GAP_PX;
  return { panX: next.mx - prev.mx, panY: next.my - prev.my, factor: usable ? prev.d / next.d : 1 };
}
