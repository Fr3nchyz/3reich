import { hex } from "../engine/hex";
import type { MapData } from "../engine/map";
import { citySymbol } from "./mapCities";
import { baysBetweenLand, fmt, hexCenter, hexCorners, midpoint, points, sideSegment, type Point } from "./mapGeometry";
import { FRONT_TINT, SEA, TERRAIN_FILL } from "./mapStyle";
import type { Box } from "./viewport";

/** The SVG text of each layer of the map, built once from the map data. */

/** The wave mark on a coastal hex: half-width, and how far below the centre it sits. */
const WAVE_HALF = 4;
const WAVE_DROP = 4;
/** How far the bay's curve is pulled beyond the notch's tip (2 = the curve itself reaches the tip). */
const BAY_CONTROL = 2;
/** Radius of the dot that marks a crossing arrow on a hexside. */
const ARROW_RADIUS = 2.6;

export interface HexLayers {
  hexes: string;
  fronts: string;
  cities: string;
  /** The box that holds every hex, before any margin. */
  bounds: Box;
}

/** The hexes, the front tint and the city symbols, plus the bounds of the map. */
export function buildHexLayers(map: MapData): HexLayers {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hexes = "", fronts = "", cities = "";
  for (const h of Object.values(map.hexes)) {
    const [cx, cy] = hexCenter(hex(h.id));
    const pts = hexCorners(cx, cy);
    for (const [x, y] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const fill = h.land ? TERRAIN_FILL[h.land] : SEA;
    hexes += `<polygon data-id="${h.id}" points="${points(pts)}" fill="${fill}"/>`;
    if (h.land && h.sea) {
      // Coastal hexes: a small wave mark keeps "part land, part sea" visible.
      hexes += `<path d="M${fmt(cx - WAVE_HALF)},${fmt(cy + WAVE_DROP)} q2,-1.5 4,0 t4,0" class="wave"/>`;
    }
    fronts += `<polygon points="${points(pts)}" fill="${FRONT_TINT[h.front]}"/>`;
    cities += citySymbol(h, cx, cy);
  }
  return { hexes, fronts, cities, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

/** Water notches cut into land hexes that meet across the sea, then the grid line along each such side. */
export function buildBays(map: MapData): string {
  const bays = baysBetweenLand(map);
  let out = "";
  for (const b of bays) {
    // A rounded scoop rather than a triangle: a quadratic curve whose control point is as far beyond the
    // notch's tip as the tip is from the side, so the curve itself reaches the tip.
    const [p1, p2, tip] = b.points as [Point, Point, Point];
    const [mx, my] = midpoint(p1, p2);
    out += `<path d="M${fmt(p1[0])},${fmt(p1[1])} Q${fmt(mx + BAY_CONTROL * (tip[0] - mx))},${fmt(my + BAY_CONTROL * (tip[1] - my))} ${fmt(p2[0])},${fmt(p2[1])} Z"/>`;
  }
  // The grid line along each such side stays visible on top of the water.
  for (const b of bays) out += `<line x1="${fmt(b.points[0]![0])}" y1="${fmt(b.points[0]![1])}" x2="${fmt(b.points[1]![0])}" y2="${fmt(b.points[1]![1])}"/>`;
  return out;
}

export interface SideLayers {
  rivers: string;
  borders: string;
  fronts: string;
  arrows: string;
  blocked: string;
}

/** The lines and dots drawn on hexsides: rivers, national borders, front boundaries, arrows, the Qattara barrier. */
export function buildSideLayers(map: MapData): SideLayers {
  const out: SideLayers = { rivers: "", borders: "", fronts: "", arrows: "", blocked: "" };
  for (const s of Object.values(map.hexsides)) {
    const [x1, y1, x2, y2] = sideSegment(s.id);
    const line = `x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}"`;
    if (s.river) out.rivers += `<line ${line}/>`;
    if (s.nationalBoundary) out.borders += `<line ${line}/>`;
    if (s.frontBoundary) out.fronts += `<line ${line}/>`;
    if (s.qattara) out.blocked += `<line ${line}/>`;
    if (s.crossingArrow) {
      const [mx, my] = midpoint([x1, y1], [x2, y2]);
      out.arrows += `<circle cx="${fmt(mx)}" cy="${fmt(my)}" r="${ARROW_RADIUS}"/>`;
    }
  }
  return out;
}

/** The whole <svg>: every layer in drawing order, then the empty layers the view fills in later. */
export function svgMarkup(map: MapData, box: Box, showFronts: boolean, hexLayers: HexLayers): string {
  const sides = buildSideLayers(map);
  return `
    <svg class="map" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" role="img" aria-label="Map of Europe">
      <g class="hexes">${hexLayers.hexes}</g>
      <g class="bays">${buildBays(map)}</g>
      <g class="front-tint" style="display:${showFronts ? "inline" : "none"}">${hexLayers.fronts}</g>
      <g class="rivers">${sides.rivers}</g>
      <g class="borders">${sides.borders}</g>
      <g class="fronts">${sides.fronts}</g>
      <g class="blocked">${sides.blocked}</g>
      <g class="arrows">${sides.arrows}</g>
      <g class="cities">${hexLayers.cities}</g>
      <g class="highlights"></g>
      <g class="units"></g>
      <polygon class="hover" points="" />
    </svg>`;
}
