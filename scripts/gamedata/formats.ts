/**
 * Decoders for two small file formats of the original 1996 PC game, written from our own analysis
 * (see docs/GAME_DATA.md). They work on bytes only, so tests can check them on made-up input; the
 * game files themselves stay outside the repository and are read only by the scripts in this folder.
 */
import { DIRECTIONS, hex, hexId, hexsideId, neighbor, ROW_COUNT, type Direction, type Hex, type HexId, type HexsideId } from "../../src/engine/hex";

/** Bytes per row of a control bitmap: 56 bits, one per bitmap column. */
const BITMAP_ROW_BYTES = 7;
export const BITMAP_BYTES = ROW_COUNT * BITMAP_ROW_BYTES;

/**
 * Bitmap column to our hexrow number. The bitmap stores each lettered row left to right, so its
 * column is an offset coordinate; ours is axial (Ref 4.1: hexrows run down-right).
 */
export const columnToQ = (column: number, r: number) => column - Math.floor(r / 2) + 16;

function hexAt(column: number, r: number): Hex {
  if (r < 0 || r >= ROW_COUNT) throw new Error(`row index ${r} is off the map`);
  return { q: columnToQ(column, r), r };
}

/**
 * A control bitmap (`*.CON`): 40 rows of 7 bytes, most significant bit first; a set bit marks a hex.
 * Returns the marked hexes in file order.
 */
export function decodeBitmap(bytes: Uint8Array): HexId[] {
  if (bytes.length !== BITMAP_BYTES) throw new Error(`a control bitmap is ${BITMAP_BYTES} bytes, got ${bytes.length}`);
  const out: HexId[] = [];
  for (let r = 0; r < ROW_COUNT; r++) {
    for (let column = 0; column < BITMAP_ROW_BYTES * 8; column++) {
      const byte = bytes[r * BITMAP_ROW_BYTES + (column >> 3)]!;
      if ((byte >> (7 - (column & 7))) & 1) out.push(hexId(hexAt(column, r)));
    }
  }
  return out;
}

/**
 * Hexside mask bit to direction. Bits 0-5 go clockwise from north-east. Contiguity alone cannot
 * tell bits 3 and 4 (south-west, west) apart, and the Polish Partition Line uses neither. Of all
 * 720 ways to map the six bits to directions, this is the only one under which every line hexside
 * inside a country lies on the border between the two sides' zones (tests/gamedata.test.ts).
 */
export const MASK_DIRECTIONS: readonly Direction[] = ["NE", "E", "SE", "SW", "W", "NW"];

export interface LineEntry {
  hex: HexId;
  /** The hexsides of this hex the line runs along. */
  sides: readonly Direction[];
}

/**
 * A line file (`NSPPLINE.BIN`, `1942LINE.BIN`, `1944LINE.BIN`): a count byte, a zero byte, then
 * one 3-byte entry per hex (bitmap column, row index, mask of the hexsides the line runs along).
 */
export function decodeLine(bytes: Uint8Array): LineEntry[] {
  const count = bytes[0];
  if (count === undefined || bytes[1] !== 0 || bytes.length !== 2 + 3 * count) throw new Error("not a line file");
  const out: LineEntry[] = [];
  for (let i = 0; i < count; i++) {
    const [column, r, mask] = [bytes[2 + 3 * i]!, bytes[3 + 3 * i]!, bytes[4 + 3 * i]!];
    if (mask >> 6) throw new Error(`entry ${i}: mask ${mask} uses more than six hexsides`);
    out.push({ hex: hexId(hexAt(column, r)), sides: MASK_DIRECTIONS.filter((_, bit) => (mask >> bit) & 1) });
  }
  return out;
}

/**
 * The hexsides a decoded line runs along, as canonical ids, sorted and without repeats. `reading`
 * maps each stored side to the direction actually used, to try another bit order. Throws a clear
 * error if a side leads off the map, which only a wrong reading can do.
 */
export function lineHexsides(entries: readonly LineEntry[], reading: (d: Direction) => Direction = (d) => d): HexsideId[] {
  const out = new Set<HexsideId>();
  for (const e of entries) {
    const h = hex(e.hex);
    for (const side of e.sides) {
      const d = reading(side);
      const n = neighbor(h, d);
      if (n.q < 0 || n.r < 0 || n.r >= ROW_COUNT) throw new Error(`line entry ${e.hex}: its ${d} side leads off the map`);
      out.add(hexsideId(h, n));
    }
  }
  return [...out].sort();
}

/** Read mask bit i as `order[i]` instead of `MASK_DIRECTIONS[i]`. */
export const readingFor =
  (order: readonly Direction[]) =>
  (d: Direction): Direction =>
    order[MASK_DIRECTIONS.indexOf(d)]!;

/**
 * The loose ends of a set of hexsides: corners where exactly one of the hexsides meets. An unbroken
 * path has two; each extra segment adds two. A hexside's two corners are the points it shares
 * with the two hexes next to both of its hexes.
 */
export function lineEnds(hexsides: readonly HexsideId[]): number {
  const key = (h: Hex) => `${h.q},${h.r}`;
  const degree = new Map<string, number>();
  for (const id of hexsides) {
    const [a, b] = id.split("-").map(hex) as [Hex, Hex];
    const aroundA = new Set((Object.keys(DIRECTIONS) as Direction[]).map((d) => key(neighbor(a, d))));
    for (const d of Object.keys(DIRECTIONS) as Direction[]) {
      const c = neighbor(b, d);
      if (!aroundA.has(key(c))) continue;
      const corner = [key(a), key(b), key(c)].sort().join("|");
      degree.set(corner, (degree.get(corner) ?? 0) + 1);
    }
  }
  return [...degree.values()].filter((n) => n === 1).length;
}
