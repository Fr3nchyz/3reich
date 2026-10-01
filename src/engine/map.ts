import { hexId, hexsideId, neighbors, parseHexId, parseHexsideId, type Hex, type HexId, type HexsideId } from "./hex";
import type { HexFeature, LandTerrain } from "./terrain";

/**
 * Map data model. Source: Reference Manual 4.1-4.9.
 *
 * Unplayable hexes (Switzerland, solid black or grey areas; Ref 4.2-4.3) are simply
 * absent. Whether ground units or fleets can cross between two hexes is decided per
 * hexside (Ref 4.3), so every hexside between two playable hexes is listed.
 */

/** Hexes whose Fortress status depends on the scenario or the course of play (Ref 4.8). */
export type FortressKind =
  /** Malta and Gibraltar: always fortresses. */
  | "permanent"
  /** Lost permanently when first occupied by an enemy unit. */
  | "standard"
  /** Metz, Strasbourg, P25: also lost on the fall of France; not fortresses in 1942/1944. */
  | "maginot"
  /** Stuttgart, Frankfurt, Bonn, Essen: fortresses only from 1944, if Axis-controlled then. */
  | "west-wall"
  /** Fortress only while the USSR meets the supply conditions of Ref 4.8. */
  | "sevastopol";

export interface MapHex {
  id: HexId;
  /** Land terrain, or null for an all-sea hex. */
  land: LandTerrain | null;
  /** True if the hex contains ocean or lake water. */
  sea: boolean;
  features: readonly HexFeature[];
  /** Set on hexes that can be fortresses; current status lives in GameState.fortresses. */
  fortress?: FortressKind;
  /** Country the hex belongs to at the start of play (land hexes only), e.g. "france". */
  country?: string;
  /** City name printed on the map. */
  name?: string;
  /** Green-dot ocean hex usable for fleet movement to and from the US Box (Ref 4.3). */
  usBoxEntry?: boolean;
}

export interface MapHexside {
  id: HexsideId;
  /** Land on both sides: normal ground movement and combat may cross (Ref 4.3). */
  land: boolean;
  /** Blue (not just river) on both sides: naval movement may cross (Ref 4.3). */
  sea: boolean;
  /** Defence is tripled against attacks across it (Ref 4.51). */
  river?: boolean;
  /** Ground units may cross and attack across in both directions (Ref 4.6). */
  crossingArrow?: boolean;
  /** All-Qattara: no movement, combat or supply across (Ref 4.51). */
  qattara?: boolean;
  /** Fleets may cross only while the adjacent hexes are friendly-controlled (Ref 4.3). */
  suezCanal?: boolean;
  nationalBoundary?: boolean;
  frontBoundary?: boolean;
}

export interface MapData {
  hexes: Readonly<Record<HexId, MapHex>>;
  hexsides: Readonly<Record<HexsideId, MapHexside>>;
}

const NEEDS_LAND: readonly HexFeature[] = ["beach", "city", "port", "capital", "capital-port", "objective"];
const NEEDS_SEA: readonly HexFeature[] = ["beach", "port", "capital-port"];

/** Check the map's internal consistency. Returns a list of problems; empty means valid. */
export function validateMap(map: MapData): string[] {
  const errors: string[] = [];

  for (const [key, h] of Object.entries(map.hexes)) {
    const parsed = parseHexId(key);
    if (!parsed || hexId(parsed) !== key) errors.push(`${key}: invalid hex id`);
    if (h.id !== key) errors.push(`${key}: id field is ${h.id}`);
    if (h.land === null && !h.sea) errors.push(`${key}: neither land nor sea`);
    for (const f of h.features) {
      if (NEEDS_LAND.includes(f) && h.land === null) errors.push(`${key}: ${f} needs land`);
      if (NEEDS_SEA.includes(f) && !h.sea) errors.push(`${key}: ${f} needs sea`);
    }
    if (h.fortress && h.land === null) errors.push(`${key}: fortress needs land`);
    if (h.usBoxEntry && !h.sea) errors.push(`${key}: US Box entry needs sea`);
  }

  for (const [key, side] of Object.entries(map.hexsides)) {
    const pair = parseHexsideId(key);
    if (!pair) {
      errors.push(`${key}: invalid hexside id`);
      continue;
    }
    if (hexsideId(pair[0], pair[1]) !== key) errors.push(`${key}: not in canonical order`);
    if (side.id !== key) errors.push(`${key}: id field is ${side.id}`);
    const [a, b] = pair.map((p) => map.hexes[hexId(p)]);
    if (!a || !b) {
      errors.push(`${key}: joins a hex that is not on the map`);
      continue;
    }
    if (side.land && (a.land === null || b.land === null)) errors.push(`${key}: land hexside needs land on both sides`);
    if (side.sea && (!a.sea || !b.sea)) errors.push(`${key}: sea hexside needs sea on both sides`);
    if (side.crossingArrow && (a.land === null || b.land === null)) errors.push(`${key}: crossing arrow needs land on both sides`);
    if (side.qattara && side.land) errors.push(`${key}: Qattara hexside cannot be crossable by land`);
    if (side.river && !side.land) errors.push(`${key}: river hexside must be a land hexside`);
  }

  // Every pair of adjacent playable hexes must have a hexside record.
  for (const key of Object.keys(map.hexes)) {
    const h = parseHexId(key);
    if (!h) continue;
    for (const n of neighbors(h)) {
      const nid = idOrNull(n);
      if (nid && map.hexes[nid] && !map.hexsides[hexsideId(h, n)]) {
        errors.push(`${hexsideId(h, n)}: missing hexside between playable hexes`);
      }
    }
  }

  return [...new Set(errors)];
}

/** Id of a neighbouring coordinate, or null when it falls outside the grid. */
function idOrNull(h: Hex): HexId | null {
  try {
    return hexId(h);
  } catch {
    return null;
  }
}
