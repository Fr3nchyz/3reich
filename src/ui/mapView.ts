import { hex } from "../engine/hex";
import type { MapData, MapHex } from "../engine/map";
import type { Unit } from "../engine/types";
import { attachGestures } from "./gestures";
import { highlightsMarkup, unitsMarkup } from "./mapCounters";
import { cornersOf, hexCenter, points } from "./mapGeometry";
import { overlayMarkup } from "./mapOverlay";
import type { AttackMarksInput } from "./attackMarks";
import { attackMarksMarkup } from "./mapMarks";
import type { OverlayCells } from "./overlayModel";
import { buildHexLayers, svgMarkup } from "./mapLayers";
import { createViewport, padBox, MAP_MARGIN } from "./viewport";

/**
 * Read-only SVG map. Drawn in our own style from the map data (no scanned artwork).
 * This file only wires the pieces together: mapLayers and mapCounters build the SVG text, viewport
 * holds pan and zoom, gestures turns pointer events into pans, zooms and taps.
 */

// Re-exported so that callers (main.ts, tests/map-view.test.ts) keep importing everything map-related from here.
export { baysBetweenLand, hexCenter, type Bay } from "./mapGeometry";
export { counterNumber } from "./mapStyle";

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
  /** Draw who holds each hex and the Zones of Control (see overlayModel.ts); null clears the overlay. */
  setOverlay(cells: OverlayCells | null): void;
  /** Mark the hexes of an attack (spec 07): dashed targets, one thick chosen target, solid gold attacker hexes. Pure data; the marks never take taps. */
  setAttackMarks(marks: AttackMarksInput): void;
  clearAttackMarks(): void;
  /** Zoom and pan to fit these hexes; with none, show the whole map. */
  focus(ids: Iterable<string>): void;
  /** Zoom by `factor` (above 1 shows more) about the middle of the map; returns the zoom level after (1 = the whole map just fits). */
  zoomBy(factor: number): number;
  /** Zoom and pan to fit the hexes now outlined (where the chosen stack or counter can go); false, and no change, when none are. */
  focusOutlined(): boolean;
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
  const overlayLayer = svg.querySelector<SVGGElement>("g.overlay")!;
  const highlightLayer = svg.querySelector<SVGGElement>("g.highlights")!;
  const marksLayer = svg.querySelector<SVGGElement>("g.attack-marks")!;
  /** Redrawn only when the marks change, so a repeated call costs no DOM work. */
  let marksDrawn = "";
  const drawMarks = (marks: AttackMarksInput | null): void => {
    const markup = attackMarksMarkup(map, marks);
    if (markup !== marksDrawn) { marksDrawn = markup; marksLayer.innerHTML = markup; }
  };
  // Test hook until the attack flow (07-6) calls the methods: an "attack-marks" event on the map whose detail is the marks, or null to clear.
  svg.addEventListener("attack-marks", (e) => drawMarks((e as CustomEvent<AttackMarksInput | null>).detail));

  const viewport = createViewport(svg, whole);
  let outlined: string[] = [];
  const centresOf = (ids: Iterable<string>) => [...ids].filter((id) => map.hexes[id]).map((id) => hexCenter(hex(id)));
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
    setHighlights: (ids) => { outlined = [...ids]; highlightLayer.innerHTML = highlightsMarkup(map, outlined); },
    setOverlay: (cells) => { overlayLayer.innerHTML = overlayMarkup(map, cells); },
    setAttackMarks: drawMarks,
    clearAttackMarks: () => drawMarks(null),
    focus: (ids) => viewport.focus(centresOf(ids)),
    zoomBy: (factor) => { viewport.zoomMiddle(factor); return viewport.level(); },
    focusOutlined: () => {
      const centres = centresOf(outlined);
      if (centres.length > 0) viewport.focus(centres);
      return centres.length > 0;
    },
  };
}
