import type { MapData, MapHexside } from "../engine/map";
import { fmt, sideSegment } from "./mapGeometry";

/**
 * Hexsides between two land hexes that ground units cannot cross: a strait, a channel, a sound, an inlet.
 * The original prints these coasts inside the hexes, so the two land hexes touch and, drawn like any other
 * edge, look joined (Italy and Albania, Harwich and Calais). The map draws them as water edges instead.
 * Drawing only: the rules read the hexside data, not this.
 */

/** Both hexes are land and the hexside is not land-crossable (Ref 4.3). Crossing arrows are included: they are crossed by sea. */
export function isWaterEdge(map: MapData, s: MapHexside): boolean {
  if (s.land) return false;
  return s.id.split("-").every((id) => !!map.hexes[id]?.land);
}

/** Every water edge in the map data. */
export const waterEdges = (map: MapData): MapHexside[] => Object.values(map.hexsides).filter((s) => isWaterEdge(map, s));

/**
 * The edges to paint as water. The Qattara Depression's sides are dry (the all-Qattara barrier, drawn on its
 * own layer), so they are left out.
 */
export const paintedWaterEdges = (map: MapData): MapHexside[] => waterEdges(map).filter((s) => !s.qattara);

/** One path (a segment per edge) for the whole layer: the same shape serves the band and the ripple drawn along it. */
export function waterEdgePath(map: MapData): string {
  return paintedWaterEdges(map)
    .map((s) => {
      const [x1, y1, x2, y2] = sideSegment(s.id);
      return `M${fmt(x1)},${fmt(y1)}L${fmt(x2)},${fmt(y2)}`;
    })
    .join("");
}
