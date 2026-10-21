import { hex } from "../engine/hex";
import type { MapData, MapHex } from "../engine/map";
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
function fortressOutline(cx: number, cy: number): string {
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
  if (h.fortress) out += fortressOutline(cx, cy);
  if (h.name) out += `<text x="${fmt(cx)}" y="${fmt(cy + NAME_OFFSET)}" class="city${objective ? " objective" : ""}">${escape(h.name)}</text>`;
  return out;
}

/** Where the holder mark of an Objective sits: up and to the right of the city symbol, clear of its name below. */
const MARK_DX = 5.4;
const MARK_DY = -4.6;
const MARK_RADIUS = 1.9;

/**
 * The mark of who holds each Objective (spec 14, D1; Ref 2.0): a square for the Axis, a circle for the Allies, a dashed ring for nobody, so the shape
 * says it and colour is only a help. Drawn in <g class="objective-marks"> above the cities; stroke widths and colours are in end.css.
 */
export function objectiveMarksMarkup(map: MapData, standings: ObjectiveStandings | null): string {
  if (!standings) return "";
  const mark = (id: string, shape: "axis" | "allies" | "nobody"): string => {
    if (!map.hexes[id]) return "";
    const [cx, cy] = hexCenter(hex(id));
    const x = cx + MARK_DX;
    const y = cy + MARK_DY;
    const label = `data-objective="${id}" data-holder="${shape}"`;
    if (shape === "axis") return `<rect class="obj-mark axis" ${label} x="${fmt(x - MARK_RADIUS)}" y="${fmt(y - MARK_RADIUS)}" width="${fmt(MARK_RADIUS * 2)}" height="${fmt(MARK_RADIUS * 2)}"/>`;
    return `<circle class="obj-mark ${shape}" ${label} cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(shape === "nobody" ? MARK_RADIUS + 0.3 : MARK_RADIUS)}"/>`;
  };
  return standings.axis.map((id) => mark(id, "axis")).join("") + standings.allies.map((id) => mark(id, "allies")).join("") + standings.nobody.map((id) => mark(id, "nobody")).join("");
}
