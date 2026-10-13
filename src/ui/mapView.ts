import { hex } from "../engine/hex";
import type { MapData, MapHex } from "../engine/map";
import type { Unit } from "../engine/types";
import { attachGestures } from "./gestures";
import { highlightsMarkup, unitsMarkup } from "./mapCounters";
import { cornersOf, hexCenter, points } from "./mapGeometry";
import { buildHexLayers, svgMarkup } from "./mapLayers";
import { createViewport, padBox, MAP_MARGIN } from "./viewport";

/**
 * Read-only SVG map. Drawn in our own style from the map data (no scanned artwork).
 * This file only wires the pieces together: mapLayers and mapCounters build the SVG text, viewport
 * holds pan and zoom, gestures turns pointer events into pans, zooms and taps.
 */

// Re-exported so that callers (main.ts, tests/map-view.test.ts) keep importing everything map-related from here.
export { baysBetweenLand, hexCenter, type Bay } from "./mapGeometry";
export { counterLabel } from "./mapStyle";

export interface MapViewOptions {
  showFronts?: boolean;
  onHover?: (h: MapHex | null) => void;
  /** A tap or click on a hex (not the end of a drag or pinch). */
  onHexClick?: (h: MapHex) => void;
}

export interface MapView {
  setFronts(on: boolean): void;
  setUnits(units: readonly Unit[]): void;
  /** Outline these hexes (places where the selected counter may go). */
  setHighlights(ids: Iterable<string>): void;
  /** Zoom and pan to fit these hexes; with none, show the whole map. */
  focus(ids: Iterable<string>): void;
}

/** The map hex drawn under a screen point, if any. */
function hexAt(map: MapData, clientX: number, clientY: number): MapHex | undefined {
  const id = document.elementFromPoint(clientX, clientY)?.getAttribute?.("data-id");
  return id ? map.hexes[id] : undefined;
}

export function renderMap(container: HTMLElement, map: MapData, opts: MapViewOptions = {}): MapView {
  const layers = buildHexLayers(map);
  const whole = padBox(layers.bounds, MAP_MARGIN);
  container.innerHTML = svgMarkup(map, whole, !!opts.showFronts, layers);
  const svg = container.querySelector("svg")!;
  const hover = svg.querySelector<SVGPolygonElement>("polygon.hover")!;
  const tint = svg.querySelector<SVGGElement>("g.front-tint")!;
  const unitLayer = svg.querySelector<SVGGElement>("g.units")!;
  const highlightLayer = svg.querySelector<SVGGElement>("g.highlights")!;

  const viewport = createViewport(svg, whole);
  const { onHexClick } = opts;
  attachGestures(svg, viewport, onHexClick && ((x, y) => { const h = hexAt(map, x, y); if (h) onHexClick(h); }));
  svg.addEventListener("mouseover", (e) => {
    const id = (e.target as Element).getAttribute?.("data-id");
    const h = id ? map.hexes[id] ?? null : null;
    if (h) hover.setAttribute("points", points(cornersOf(h.id)));
    opts.onHover?.(h);
  });

  return {
    setFronts: (on) => { tint.style.display = on ? "inline" : "none"; },
    setUnits: (units) => { unitLayer.innerHTML = unitsMarkup(map, units); },
    setHighlights: (ids) => { highlightLayer.innerHTML = highlightsMarkup(map, ids); },
    focus: (ids) => {
      const centres = [...ids].filter((id) => map.hexes[id]).map((id) => hexCenter(hex(id)));
      viewport.focus(centres);
    },
  };
}
