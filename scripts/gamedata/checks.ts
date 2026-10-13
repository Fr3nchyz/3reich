/**
 * Checks shared by the extractor (on the decoded files) and the tests (on the committed zones).
 * Pure functions over our map data.
 */
import { hex, hexId, hexsideId, neighbors, ROW_COUNT, type HexId, type HexsideId } from "../../src/engine/hex";
import type { MapData } from "../../src/engine/map";

/** Neighbours of a hex that are on the map. */
export const around = (map: MapData, id: HexId): HexId[] =>
  neighbors(hex(id))
    .filter((n) => n.q >= 0 && n.r >= 0 && n.r < ROW_COUNT)
    .map(hexId)
    .filter((n) => map.hexes[n]);

export interface BorderCheck {
  /** Line hexsides inside the country that do not lie between the two sides. */
  offBorder: HexsideId[];
  /** Hexsides between the two sides that land units can cross on our map but the line leaves out. */
  undrawn: HexsideId[];
  /** Line hexsides inside the country. */
  inside: number;
}

/**
 * Does a line run exactly along the border between two parts of a country? Hexsides our map says
 * only water crosses (coasts, inlets) are not expected on the line.
 */
export function borderCheck(map: MapData, line: readonly HexsideId[], country: string, a: ReadonlySet<HexId>, b: ReadonlySet<HexId>): BorderCheck {
  const between = new Set<HexsideId>();
  for (const x of a) for (const y of around(map, x)) if (b.has(y)) between.add(hexsideId(hex(x), hex(y)));
  const isInside = (s: HexsideId) => s.split("-").every((h) => map.hexes[h]?.land && map.hexes[h].country === country);
  const drawn = new Set(line);
  const inside = line.filter(isInside);
  return {
    offBorder: inside.filter((s) => !between.has(s)),
    undrawn: [...between].filter((s) => map.hexsides[s]?.land && !drawn.has(s)).sort(),
    inside: inside.length,
  };
}
