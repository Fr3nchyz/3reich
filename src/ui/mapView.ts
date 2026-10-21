import { hex } from "../engine/hex";
import type { MapData, MapHex } from "../engine/map";
import type { Unit } from "../engine/types";
import { attachGestures } from "./gestures";
import { highlightsMarkup, unitsMarkup } from "./mapCounters";
import { cornersOf, hexCenter, points } from "./mapGeometry";
import { overlayMarkup } from "./mapOverlay";
import type { AttackMarksInput } from "./attackMarks";
import type { UnitMarks } from "./moveMarks";
import { attackMarksMarkup } from "./mapMarks";
import { unitMarksMarkup } from "./mapUnitMarks";
import type { ObjectiveStandings } from "../engine/objectives";
import { markRadius, objectiveMarksMarkup } from "./mapCities";
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
  /** Draw the counters; `marks` (spec 10, 10-5) puts a ringed badge under each ticked counter and a dash under each left-behind one of the hex chosen to move from (own group above the counters). */
  setUnits(units: readonly Unit[], marks?: UnitMarks): void;
  /** Outline these hexes (places where the selected counter may go); `further` are drawn in a second shade (spec 10: where a faster unit alone could go). */
  setHighlights(ids: Iterable<string>, further?: Iterable<string>): void;
  /** Draw who holds each hex and the Zones of Control (see overlayModel.ts); null clears the overlay. */
  setOverlay(cells: OverlayCells | null): void;
  /** Mark the hexes of an attack (spec 07): dashed targets, one thick chosen target, solid gold attacker hexes. Pure data; the marks never take taps. */
  setAttackMarks(marks: AttackMarksInput): void;
  clearAttackMarks(): void;
  /** Mark who holds each Objective (spec 14, D1): a square for the Axis, a circle for the Allies, a dashed ring for nobody; null clears the marks. */
  setObjectiveMarks(standings: ObjectiveStandings | null): void;
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
  const unitMarksLayer = svg.querySelector<SVGGElement>("g.unit-marks")!;
  const overlayLayer = svg.querySelector<SVGGElement>("g.overlay")!;
  const highlightLayer = svg.querySelector<SVGGElement>("g.highlights")!;
  const marksLayer = svg.querySelector<SVGGElement>("g.attack-marks")!;
  const objectiveLayer = svg.querySelector<SVGGElement>("g.objective-marks")!;
  let objectivesDrawn = "";
  let objectiveStandings: ObjectiveStandings | null = null;
  /** Screen pixels per map unit as drawn now (0 while the map has no size). */
  const pxPerUnit = (): number => {
    const r = svg.getBoundingClientRect();
    const box = svg.viewBox.baseVal;
    return r.width > 0 && r.height > 0 && box.width > 0 && box.height > 0 ? Math.min(r.width / box.width, r.height / box.height) : 0;
  };
  /** The holder marks, at a size that can be read at this zoom; drawn again only when what is drawn would change (a pan changes nothing). */
  const drawObjectives = (): void => {
    const markup = objectiveMarksMarkup(map, objectiveStandings, markRadius(pxPerUnit()));
    if (markup !== objectivesDrawn) { objectivesDrawn = markup; objectiveLayer.innerHTML = markup; }
  };
  if (typeof MutationObserver !== "undefined") new MutationObserver(drawObjectives).observe(svg, { attributes: true, attributeFilter: ["viewBox"] });
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
    setUnits: (units, marks) => { unitLayer.innerHTML = unitsMarkup(map, units); unitMarksLayer.innerHTML = marks ? unitMarksMarkup(map, units, marks) : ""; },
    setHighlights: (ids, further) => { outlined = [...ids]; highlightLayer.innerHTML = highlightsMarkup(map, outlined, further); },
    setOverlay: (cells) => { overlayLayer.innerHTML = overlayMarkup(map, cells); },
    setAttackMarks: drawMarks,
    clearAttackMarks: () => drawMarks(null),
    setObjectiveMarks: (standings) => { objectiveStandings = standings; drawObjectives(); },
    focus: (ids) => viewport.focus(centresOf(ids)),
    zoomBy: (factor) => { viewport.zoomMiddle(factor); return viewport.level(); },
    focusOutlined: () => {
      const centres = centresOf(outlined);
      if (centres.length > 0) viewport.focus(centres);
      return centres.length > 0;
    },
  };
}
