import { SIZE, type Point } from "./mapGeometry";

/**
 * Pan and zoom by rewriting the SVG viewBox. The box maths is pure (and unit tested); createViewport
 * holds the current box and writes it to the <svg>.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  return {
    zoomAt(clientX, clientY, factor) {
      const r = svg.getBoundingClientRect();
      const mx = vb.x + ((clientX - r.left) / r.width) * vb.w;
      const my = vb.y + ((clientY - r.top) / r.height) * vb.h;
      vb = zoomBox(vb, whole, mx, my, factor);
      apply();
    },
    panBy(dx, dy) {
      const r = svg.getBoundingClientRect();
      vb = panBox(vb, dx, dy, r.width, r.height);
      apply();
    },
    focus(centres) {
      if (centres.length === 0) {
        vb = { ...whole };
      } else {
        const r = svg.getBoundingClientRect();
        vb = fitBox(centres, r.width > 0 && r.height > 0 ? r.width / r.height : whole.w / whole.h);
      }
      apply();
    },
  };
}
