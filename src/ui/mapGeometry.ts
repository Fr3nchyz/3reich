import { hex, type Hex } from "../engine/hex";
import type { MapData } from "../engine/map";

/**
 * Hex geometry for the SVG map: pointy-top hexes, axial (q, r) from engine/hex.ts.
 * Pure functions only; nothing here touches the DOM.
 */

/** Corner-to-centre distance of one hex, in SVG units. */
export const SIZE = 10;
const SQRT3 = Math.sqrt(3);
/** How far a bay's notch reaches toward the hex centre (0 = none, 1 = all the way). */
export const BAY_DEPTH = 0.62;
/** The fortress outline is the hex shrunk to this share of its size. */
export const FORTRESS_INSET = 0.78;

export type Point = [number, number];

export function hexCenter(h: Hex): Point {
  return [SIZE * SQRT3 * (h.q + h.r / 2), SIZE * 1.5 * h.r];
}

/** Corner k of a pointy-top hex, k = 0 at the top, clockwise. */
export function corner(cx: number, cy: number, k: number): Point {
  const a = (Math.PI / 180) * (60 * k - 90);
  return [cx + SIZE * Math.cos(a), cy + SIZE * Math.sin(a)];
}

/** The six corners of the hex around (cx, cy). */
export const hexCorners = (cx: number, cy: number): Point[] => [0, 1, 2, 3, 4, 5].map((k) => corner(cx, cy, k));

/** The six corners of the hex with this id. */
export const cornersOf = (id: string): Point[] => hexCorners(...hexCenter(hex(id)));

/** Corner indices bounding the side shared with the neighbour at (dq, dr). */
const SIDE_CORNERS: Record<string, [number, number]> = {
  "1,-1": [0, 1], "1,0": [1, 2], "0,1": [2, 3], "-1,1": [3, 4], "-1,0": [4, 5], "0,-1": [5, 0],
};

/** The two corners of `from` that bound its side facing `to`. */
function sideCorners(from: Hex, to: Hex): [Point, Point] {
  const [cx, cy] = hexCenter(from);
  const [k1, k2] = SIDE_CORNERS[`${to.q - from.q},${to.r - from.r}`]!;
  return [corner(cx, cy, k1), corner(cx, cy, k2)];
}

/** The line segment (x1, y1, x2, y2) of a hexside id such as "L23-L24". */
export function sideSegment(id: string): [number, number, number, number] {
  const [aId, bId] = id.split("-") as [string, string];
  const [[x1, y1], [x2, y2]] = sideCorners(hex(aId), hex(bId));
  return [x1, y1, x2, y2];
}

/** The mid-point of two points. */
export const midpoint = ([x1, y1]: Point, [x2, y2]: Point): Point => [(x1 + x2) / 2, (y1 + y2) / 2];

/** A shape drawn on the SVG as text: one decimal is all the eye can tell apart at these sizes. */
export const fmt = (n: number) => n.toFixed(1);
export const points = (pts: Point[]) => pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
export const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Water drawn into a land hex along one of its sides. */
export interface Bay {
  hex: string;
  /** The land hex on the other side of the water. */
  toward: string;
  points: Point[];
}

/**
 * The original map draws its coastlines inside the hexes, so where two land hexes meet across
 * the sea (Britain and France, Denmark and Sweden, the Danish islands) the water lies inside both
 * hexes and the hexes themselves touch. Painting those hexes solid green would join the coasts, so
 * each such side gets a notch of water cut into the hex on both sides of it. `depth` is how far
 * the notch reaches toward the hex centre (0 = none, 1 = all the way).
 */
export function baysBetweenLand(map: MapData, depth = BAY_DEPTH): Bay[] {
  const out: Bay[] = [];
  for (const s of Object.values(map.hexsides)) {
    if (!s.sea || s.land) continue; // only sides that are ocean and nothing else
    const [aId, bId] = s.id.split("-") as [string, string];
    if (!map.hexes[aId]?.land || !map.hexes[bId]?.land) continue;
    for (const [from, to] of [[aId, bId], [bId, aId]] as const) {
      const [cx, cy] = hexCenter(hex(from));
      const [p1, p2] = sideCorners(hex(from), hex(to));
      const [mx, my] = midpoint(p1, p2);
      out.push({ hex: from, toward: to, points: [p1, p2, [mx + (cx - mx) * depth, my + (cy - my) * depth]] });
    }
  }
  return out;
}
