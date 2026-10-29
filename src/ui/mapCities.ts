import { hex } from "../engine/hex";
import type { MapData, MapHex } from "../engine/map";
import type { GameState } from "../engine/types";
import type { ObjectiveStandings } from "../engine/objectives";
import { FORTRESS_INSET, escape, fmt, hexCenter, hexCorners, points, type Point } from "./mapGeometry";

/** City, capital, port and fortress symbols, and the place name under them. */

/** Capitals are a star of this radius; the inner points sit at STAR_INNER of it. */
const STAR_RADIUS = 3.6;
const STAR_INNER = 0.45;
/** Radii of the other symbols: a port ring, a city dot, the ring around a capital that is also a port. */
const PORT_RADIUS = 2.4;
const CITY_RADIUS = 1.8;
const CAPITAL_PORT_RADIUS = 4.6;
/** Where the name sits below the centre of the hex. */
const NAME_OFFSET = 7.2;
const OBJECTIVE_COLOUR = "#b3202a";
const PLAIN_COLOUR = "#1d1d1d";

function star(cx: number, cy: number, r: number): string {
  const pts: Point[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * STAR_INNER;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return points(pts);
}

/** The dashed outline of a fortress: the hex pulled in toward its centre. */
export function fortressOutline(cx: number, cy: number): string {
  const inset = hexCorners(cx, cy).map(([x, y]) => [cx + (x - cx) * FORTRESS_INSET, cy + (y - cy) * FORTRESS_INSET] as Point);
  return `<polygon points="${points(inset)}" fill="none" stroke="#333" stroke-width="0.9" stroke-dasharray="1.2 1"/>`;
}

export function citySymbol(h: MapHex, cx: number, cy: number): string {
  const f = h.features;
  const objective = f.includes("objective");
  const colour = objective ? OBJECTIVE_COLOUR : PLAIN_COLOUR;
  const at = `cx="${fmt(cx)}" cy="${fmt(cy)}"`;
  let out = "";
  if (f.includes("capital") || f.includes("capital-port")) {
    out += `<polygon points="${star(cx, cy, STAR_RADIUS)}" fill="${colour}"/>`;
    if (f.includes("capital-port")) out += `<circle ${at} r="${CAPITAL_PORT_RADIUS}" fill="none" stroke="${colour}" stroke-width="0.8"/>`;
  } else if (f.includes("port")) {
    out += `<circle ${at} r="${PORT_RADIUS}" fill="#fff" stroke="${colour}" stroke-width="1"/>`;
  } else if (f.includes("city") || objective) {
    out += `<circle ${at} r="${CITY_RADIUS}" fill="${colour}"/>`;
  }
  if (h.name) out += `<text x="${fmt(cx)}" y="${fmt(cy + NAME_OFFSET)}" class="city${objective ? " objective" : ""}">${escape(h.name)}</text>`;
  return out;
}

/** The holder mark at the whole-map zoom's smallest: its radius in map units, and the radius it must keep on the screen, in CSS pixels, so the three shapes can be told apart. */
export const MARK_RADIUS = 1.9;
export const MARK_MIN_SCREEN_RADIUS = 3.5;
/** Half the width of a hex (a hex has corners at 10 map units): a mark is kept inside it. */
const HEX_HALF_WIDTH = 8.4;

/** The radius, in map units, of a holder mark where one map unit is drawn `pxPerUnit` screen pixels wide: the base size, or more when that would be too small to see (0 or less: not measured, the base size). */
export function markRadius(pxPerUnit: number): number {
  return pxPerUnit > 0 ? Math.max(MARK_RADIUS, MARK_MIN_SCREEN_RADIUS / pxPerUnit) : MARK_RADIUS;
}

/**
 * The mark of who holds each Objective (spec 14, D1; Ref 2.0): a square for the Axis, a circle for the Allies, a dashed ring for nobody, so the shape
 * says it and colour is only a help. Drawn in <g class="objective-marks"> above the cities; stroke widths and colours are in end.css. `radius` is in map
 * units (markRadius): the view redraws the marks when the zoom changes, so they never fall below a size that can be read. The mark sits up and to the
 * right of the city symbol, clear of its name below, and is pulled toward the centre as it grows so that it stays inside its hex.
 */
export function objectiveMarksMarkup(map: MapData, standings: ObjectiveStandings | null, radius = MARK_RADIUS): string {
  if (!standings) return "";
  const dx = Math.min(5.4, Math.max(3.2, HEX_HALF_WIDTH - radius));
  const mark = (id: string, shape: "axis" | "allies" | "nobody"): string => {
    if (!map.hexes[id]) return "";
    const [cx, cy] = hexCenter(hex(id));
    const x = cx + dx;
    const y = cy - dx * 0.85;
    const label = `data-objective="${id}" data-holder="${shape}"`;
    if (shape === "axis") return `<rect class="obj-mark axis" ${label} x="${fmt(x - radius)}" y="${fmt(y - radius)}" width="${fmt(radius * 2)}" height="${fmt(radius * 2)}"/>`;
    return `<circle class="obj-mark ${shape}" ${label} cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(radius)}"/>`;
  };
  return standings.axis.map((id) => mark(id, "axis")).join("") + standings.allies.map((id) => mark(id, "allies")).join("") + standings.nobody.map((id) => mark(id, "nobody")).join("");
}

/** Active outlines follow state rather than printed fortress kinds (spec 16 R31 / Q5). */
export function fortressOutlineHexes(state: Pick<GameState, "fortresses">): string[] {
  return Object.keys(state.fortresses).filter((id) => state.fortresses[id] === true).sort();
}

export function fortressMarkup(map: MapData, fortresses: GameState["fortresses"]): string {
  return fortressOutlineHexes({ fortresses }).filter((id) => map.hexes[id]).map((id) => {
    const [cx, cy] = hexCenter(hex(id));
    return `<g data-fortress="${escape(id)}">${fortressOutline(cx, cy)}</g>`;
  }).join("");
}
