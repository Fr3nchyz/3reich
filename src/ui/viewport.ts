import { SIZE, type Box, type Point } from "./mapGeometry";

/**
 * Pan and zoom by rewriting the SVG viewBox. The box maths is pure (and unit tested); createViewport
 * holds the current box and writes it to the <svg>.
 */

/** The map can be shown this much wider than the whole map (zoomed out) ... */
export const MAX_ZOOM_OUT = 1.2;
/** ... and down to this fraction of it (zoomed in). */
export const MAX_ZOOM_IN = 12;
/** Space left around the hexes when the whole map is shown. */
export const MAP_MARGIN = SIZE;
/** Space left around the hexes when the view is fitted to a few of them. */
export const FOCUS_MARGIN = SIZE * 3;

/** The box grown by `pad` on every side. */
export const padBox = (b: Box, pad: number): Box => ({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad });

/** The box zoomed by `factor` (above 1 shows more) about map point (mx, my), within the limits set by `whole`. */
export function zoomBox(vb: Box, whole: Box, mx: number, my: number, factor: number): Box {
  const w = Math.min(whole.w * MAX_ZOOM_OUT, Math.max(whole.w / MAX_ZOOM_IN, vb.w * factor));
  const k = w / vb.w;
  return { x: mx - (mx - vb.x) * k, y: my - (my - vb.y) * k, w, h: vb.h * k };
}

/** The box dragged by (dx, dy) screen pixels on a screen of width x height pixels. */
export const panBox = (vb: Box, dx: number, dy: number, width: number, height: number): Box => ({
  ...vb,
  x: vb.x - (dx / width) * vb.w,
  y: vb.y - (dy / height) * vb.h,
});

/** The box that fits these hex centres with a margin, in the shape of the screen (`aspect` = width / height) so nothing is letterboxed. */
export function fitBox(centres: readonly Point[], aspect: number, pad = FOCUS_MARGIN): Box {
  const xs = centres.map(([x]) => x), ys = centres.map(([, y]) => y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = Math.max(x1 - x0 + 2 * pad, (y1 - y0 + 2 * pad) * aspect);
  const h = w / aspect;
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
}

/** A size in screen pixels. */
export interface Size {
  w: number;
  h: number;
}

/** Pixels per map unit when `whole` is fitted to a screen of this size (the whole map just fits). */
const fitScale = (whole: Box, s: Size): number => Math.min(s.w / whole.w, s.h / whole.h);

/**
 * The box that shows the whole map on a screen of this size, with nothing letterboxed: `whole` grown on
 * one axis to the screen's shape, about its centre. Zoom limits are measured against it.
 */
export function wholeOnScreen(whole: Box, s: Size): Box {
  const k = fitScale(whole, s);
  const w = s.w / k, h = s.h / k;
  return { x: whole.x + whole.w / 2 - w / 2, y: whole.y + whole.h / 2 - h / 2, w, h };
}

/**
 * The box after the map's screen area changed from `from` to `to` (a window dragged across the two-column
 * breakpoint, browser zoom, a tablet turned over). The same map point stays at the centre and the same
 * share of the whole map stays in view (zoom measured against the whole map just fitting), and the box
 * takes the new screen's shape, so nothing is cropped or letterboxed and pan and zoom stay exact.
 */
export function refitBox(vb: Box, whole: Box, from: Size, to: Size): Box {
  const zoom = Math.min(from.w / vb.w, from.h / vb.h) / fitScale(whole, from);
  const scale = zoom * fitScale(whole, to);
  const w = to.w / scale, h = to.h / scale;
  return { x: vb.x + vb.w / 2 - w / 2, y: vb.y + vb.h / 2 - h / 2, w, h };
}

export interface Viewport {
  /** Zoom by `factor` (above 1 shows more) keeping the map point under screen point (clientX, clientY) in place. */
  zoomAt(clientX: number, clientY: number, factor: number): void;
  /** Drag the map by (dx, dy) screen pixels. */
  panBy(dx: number, dy: number): void;
  /** Fit the view to these hex centres; with none, show the whole map. */
  focus(centres: readonly Point[]): void;
}

export function createViewport(svg: SVGSVGElement, whole: Box): Viewport {
  let vb: Box = { ...whole };
  const apply = () => svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  /** Screen pixels per map unit as drawn (the viewBox is letterboxed if its shape differs from the element's). */
  const scaleOf = (r: DOMRect) => Math.min(r.width / vb.w, r.height / vb.h);
  const sizeOf = (r: DOMRect): Size => ({ w: r.width, h: r.height });
  /** The size of the box the current viewBox was last made for, so that a resize knows what it is changing from. */
  let last: Size | null = null;
  const refit = () => {
    const r = svg.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    vb = refitBox(vb, whole, last ?? sizeOf(r), sizeOf(r));
    last = sizeOf(r);
    apply();
  };
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(refit).observe(svg);
  return {
    zoomAt(clientX, clientY, factor) {
      const r = svg.getBoundingClientRect();
      last = sizeOf(r);
      const s = scaleOf(r);
      const mx = vb.x + vb.w / 2 + (clientX - (r.left + r.width / 2)) / s;
      const my = vb.y + vb.h / 2 + (clientY - (r.top + r.height / 2)) / s;
      vb = zoomBox(vb, r.width > 0 && r.height > 0 ? wholeOnScreen(whole, sizeOf(r)) : whole, mx, my, factor);
      apply();
    },
    panBy(dx, dy) {
      const r = svg.getBoundingClientRect();
      last = sizeOf(r);
      const s = scaleOf(r);
      vb = panBox(vb, dx, dy, vb.w * s, vb.h * s);
      apply();
    },
    focus(centres) {
      const r = svg.getBoundingClientRect();
      last = r.width > 0 && r.height > 0 ? sizeOf(r) : last;
      if (centres.length === 0) {
        vb = r.width > 0 && r.height > 0 ? wholeOnScreen(whole, sizeOf(r)) : { ...whole };
      } else {
        vb = fitBox(centres, r.width > 0 && r.height > 0 ? r.width / r.height : whole.w / whole.h);
      }
      apply();
    },
  };
}
