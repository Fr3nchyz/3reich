/**
 * Hex grid coordinates. Source: Reference Manual 4.1 and the printed map.
 *
 * Hexes sit in horizontal rows lettered A-Z then AA, BB ... NN (40 rows, top to
 * bottom). Numbered hexrows run diagonally from northwest to southeast (Ref 4.1), so a
 * hex keeps its number as you step down-right. A hex id is row letters + number,
 * e.g. "K21" (Plymouth) or "AA25" (Brindisi).
 *
 * This is the standard axial system with q = hexrow number and r = row index
 * (A = 0 ... Z = 25, AA = 26 ... NN = 39). Board coordinates only: converting to
 * screen pixels belongs to the UI.
 */

export type HexId = string;

export interface Hex {
  /** Numbered (diagonal) hexrow. */
  q: number;
  /** Lettered row index: A = 0 ... Z = 25, AA = 26 ... NN = 39. */
  r: number;
}

/** Rows A..NN. */
export const ROW_COUNT = 40;

const A = "A".charCodeAt(0);

export function rowLabel(r: number): string {
  if (!Number.isInteger(r) || r < 0 || r >= ROW_COUNT) throw new Error(`Invalid row index: ${r}`);
  const letter = String.fromCharCode(A + (r % 26));
  return r < 26 ? letter : letter + letter;
}

export function hexId(h: Hex): HexId {
  if (!Number.isInteger(h.q) || h.q < 0) throw new Error(`Invalid hexrow number: ${h.q}`);
  return `${rowLabel(h.r)}${h.q}`;
}

const HEX_ID = /^([A-Z])(\1?)(0|[1-9]\d*)$/;

/** Parse "K21" or "AA25"; returns null for anything that is not a valid id. */
export function parseHexId(id: string): Hex | null {
  const m = HEX_ID.exec(id);
  if (!m) return null;
  const letter = m[1]!.charCodeAt(0) - A;
  const r = m[2] ? 26 + letter : letter;
  if (r >= ROW_COUNT) return null;
  return { q: Number(m[3]), r };
}

/** Parse an id that is known to be valid; throws otherwise. */
export function hex(id: string): Hex {
  const h = parseHexId(id);
  if (!h) throw new Error(`Invalid hex id: ${id}`);
  return h;
}

export type Direction = "E" | "W" | "NE" | "NW" | "SE" | "SW";

/** Axial offsets. Moving down a row keeps q when going SE and decreases it going SW. */
export const DIRECTIONS: Readonly<Record<Direction, Readonly<Hex>>> = {
  E: { q: 1, r: 0 },
  W: { q: -1, r: 0 },
  NE: { q: 1, r: -1 },
  NW: { q: 0, r: -1 },
  SE: { q: 0, r: 1 },
  SW: { q: -1, r: 1 },
};

export function neighbor(h: Hex, d: Direction): Hex {
  return { q: h.q + DIRECTIONS[d].q, r: h.r + DIRECTIONS[d].r };
}

/**
 * The six neighbouring coordinates. Some may lie off the map or be unplayable; the
 * map data decides which exist.
 */
export function neighbors(h: Hex): Hex[] {
  return (Object.keys(DIRECTIONS) as Direction[]).map((d) => neighbor(h, d));
}

export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

export function adjacent(a: Hex, b: Hex): boolean {
  return distance(a, b) === 1;
}

export type HexsideId = string;

/**
 * Canonical id of the hexside between two adjacent hexes, written as the manual does
 * ("MM26-NN26"): the hex in the higher row (or, in the same row, the lower number)
 * comes first.
 */
export function hexsideId(a: Hex, b: Hex): HexsideId {
  if (!adjacent(a, b)) throw new Error(`Not adjacent: ${hexId(a)} and ${hexId(b)}`);
  const [first, second] = a.r < b.r || (a.r === b.r && a.q < b.q) ? [a, b] : [b, a];
  return `${hexId(first)}-${hexId(second)}`;
}

/** Parse "MM26-NN26" into its two hexes; null if malformed or not adjacent. */
export function parseHexsideId(id: string): [Hex, Hex] | null {
  const parts = id.split("-");
  if (parts.length !== 2) return null;
  const a = parseHexId(parts[0]!);
  const b = parseHexId(parts[1]!);
  if (!a || !b || !adjacent(a, b)) return null;
  return [a, b];
}
