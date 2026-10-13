/**
 * Decoder for the original game's map file (BINMAP.BIN) and a comparison with our map.
 *
 * Pure functions only, so tests can run them on made-up bytes; the command-line runner that
 * reads the game folder is scripts/gamedata/map.ts. The format is described in our own words in
 * docs/GAME_DATA.md, and the results of the comparison in docs/MAP_COMPARISON.md.
 */
import type { Direction, HexId, HexsideId } from "../../src/engine/hex";
import type { MapData } from "../../src/engine/map";

/** One record per hex, 22 bytes each, stored column by column: 51 columns of 40 rows. */
export const RECORD_BYTES = 22;
export const COLUMNS = 51;
export const ROWS = 40;
export const BINMAP_BYTES = RECORD_BYTES * COLUMNS * ROWS;

/** Hexside mask bit order, clockwise from north-east (bit 0) to north-west (bit 5). */
export const SIDE_BITS: readonly Direction[] = ["NE", "E", "SE", "SW", "W", "NW"];

/** Front bits of the land and sea front fields. */
export const FRONT_BITS = { western: 1, eastern: 2, mediterranean: 4 } as const;
/** Extra bit set on the sea front of Black Sea and Sea of Azov hexes, besides "eastern". */
export const BLACK_SEA_BIT = 8;

/** Terrain codes (high four bits of byte 17). One code per hex: a beach or fortress hides the terrain. */
export const TERRAIN_CODES: Readonly<Record<number, string>> = {
  1: "clear",
  2: "mountain",
  3: "island",
  4: "beach",
  5: "swamp",
  6: "fortress",
  7: "island fortress",
  8: "qattara",
  9: "all sea",
};

/**
 * Nation numbers as listed in the game's scenario notes (FORMAT.TXT), mapped to our country
 * ids. 0 is open sea; 3 (U.S.), 36 (a second number for Holland), 39 (East Europe), 40 to 42
 * (Vichy, Free France, nobody) never appear in BINMAP.BIN.
 */
export const NATIONS: Readonly<Record<number, string>> = {
  1: "france", 2: "britain", 4: "ussr", 5: "germany", 6: "italy", 7: "belgium", 8: "bulgaria", 9: "denmark",
  10: "finland", 11: "greece", 12: "hungary", 13: "netherlands", 14: "norway", 15: "poland", 16: "rumania",
  17: "spain", 18: "sweden", 19: "turkey", 20: "yugoslavia", 21: "luxembourg", 22: "ireland", 23: "baltic-states",
  24: "portugal", 25: "switzerland", 26: "persia", 27: "arabia", 28: "tunisia", 29: "libya", 30: "egypt",
  31: "palestine", 32: "transjordan", 33: "lebanon-syria", 34: "iraq", 35: "albania", 37: "algeria", 38: "morocco",
};

export interface GameHex {
  /** Hex this record sits at, from its position in the file. */
  id: HexId;
  /** Hex the record names in its own row and number bytes; null for an empty record. */
  label: HexId | null;
  /** AI area number, 1 to 67 (0: none). */
  area: number;
  /** Nation the hex belongs to on the map (FORMAT.TXT numbering). */
  nation: number;
  /** Major power that owns it at the start (the colonial owner for colonies). */
  owner: number;
  /** Polish, Baltic and Bessarabian hexes of the East Europe partition. */
  eastEurope: boolean;
  /** Hexsides across which the record marks water (bit order SIDE_BITS). */
  seaSides: number;
  /** Water hexsides marked on this side only; the neighbour marks them in seaSides. */
  oneSidedSea: number;
  seaFront: number;
  /** Hexsides ground units may cross. */
  landSides: number;
  /** Hexsides with a crossing arrow. */
  arrowSides: number;
  landFront: number;
  riverSides: number;
  capital: boolean;
  objective: boolean;
  terrain: number;
  city: boolean;
  port: boolean;
  /** The two remaining flag bits of byte 17, meaning not known. */
  otherFlags: number;
}

const rowLetters = (r: number) => {
  const c = String.fromCharCode(65 + (r % 26));
  return r < 26 ? c : c + c;
};

/** Bitmap column (0..50) and row to a hex id; null when the hexrow number would be negative. */
export function columnToHex(column: number, row: number): HexId | null {
  const q = column - Math.floor(row / 2) + 16;
  return q < 0 ? null : `${rowLetters(row)}${q}`;
}

/** Decode BINMAP.BIN into one entry per position that maps to a hex id. */
export function decodeBinmap(bytes: Uint8Array): GameHex[] {
  if (bytes.length !== BINMAP_BYTES) throw new Error(`BINMAP.BIN should be ${BINMAP_BYTES} bytes, got ${bytes.length}`);
  const out: GameHex[] = [];
  for (let i = 0; i < COLUMNS * ROWS; i++) {
    const column = Math.floor(i / ROWS);
    const row = i % ROWS;
    const id = columnToHex(column, row);
    if (!id) continue;
    const b = bytes.subarray(i * RECORD_BYTES, (i + 1) * RECORD_BYTES);
    const word = (k: number) => b[k]! | (b[k + 1]! << 8);
    const nationWord = word(10);
    const seaWord = word(12);
    const landWord = word(14);
    out.push({
      id,
      label: b[7] ? `${rowLetters(b[7] - 1)}${b[8]}` : null,
      area: b[6]!,
      nation: nationWord & 63,
      owner: (nationWord >> 6) & 63,
      eastEurope: Boolean(nationWord & 0x1000),
      seaSides: seaWord & 63,
      oneSidedSea: (seaWord >> 6) & 63,
      seaFront: seaWord >> 12,
      landSides: landWord & 63,
      arrowSides: (landWord >> 6) & 63,
      landFront: landWord >> 12,
      riverSides: b[16]! & 63,
      capital: Boolean(b[16]! & 0x40),
      objective: Boolean(b[16]! & 0x80),
      terrain: b[17]! >> 4,
      city: Boolean(b[17]! & 2),
      port: Boolean(b[17]! & 1),
      otherFlags: b[17]! & 12,
    });
  }
  return out;
}

/** A record is a real map hex when it names the hex at its own position. */
export const isPlayableRecord = (h: GameHex) => h.label === h.id;
export const hasLand = (h: GameHex) => h.landFront !== 0;
export const hasSea = (h: GameHex) => h.seaFront !== 0;

const DELTA: Readonly<Record<Direction, [number, number]>> = {
  NE: [1, -1], E: [1, 0], SE: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [0, -1],
};

function parse(id: HexId): { q: number; r: number } {
  const m = /^([A-Z])(\1?)(\d+)$/.exec(id)!;
  return { q: Number(m[3]), r: m[1]!.charCodeAt(0) - 65 + (m[2] ? 26 : 0) };
}

/** Bit of `from`'s masks that points at the adjacent hex `to`. */
export function sideBit(from: HexId, to: HexId): number {
  const a = parse(from);
  const b = parse(to);
  const k = SIDE_BITS.findIndex((d) => a.q + DELTA[d][0] === b.q && a.r + DELTA[d][1] === b.r);
  if (k < 0) throw new Error(`${from} and ${to} are not adjacent`);
  return 1 << k;
}

/** How the two records of a hexside see one mask: both, one of them, or neither. */
export type Pair = "both" | "one" | "none";
export function pairOf(a: GameHex, b: GameHex, mask: (h: GameHex) => number): Pair {
  const x = Boolean(mask(a) & sideBit(a.id, b.id));
  const y = Boolean(mask(b) & sideBit(b.id, a.id));
  return x && y ? "both" : x || y ? "one" : "none";
}

const frontName = (bits: number): string =>
  Object.entries(FRONT_BITS).find(([, v]) => (bits & 7) === v)?.[0] ?? `bits ${bits}`;

export interface Comparison {
  /** Game records that name their own hex but are not on our map. */
  gameOnlyHexes: { id: HexId; land: boolean; nation: string; landSides: number }[];
  /** Our hexes with no playable game record. */
  oursOnlyHexes: HexId[];
  /** Records that name another hex than the one at their position (off-map boxes, padding). */
  strayRecords: { id: HexId; label: HexId | null }[];
  land: { gameLand: HexId[]; gameSea: HexId[] };
  coastal: { gameCoastal: HexId[]; gameInland: HexId[] };
  country: { id: HexId; ours: string; game: string }[];
  front: { id: HexId; ours: string; game: string }[];
  terrain: { id: HexId; ours: string; game: string }[];
  features: Record<"beach" | "city" | "port" | "capital" | "objective" | "fortress", { gameOnly: HexId[]; oursOnly: HexId[] }>;
  hexsides: {
    landGameOnly: HexsideId[];
    landOursOnly: HexsideId[];
    landOneSided: HexsideId[];
    seaGameOnly: HexsideId[];
    seaOursOnly: HexsideId[];
    seaOneSided: HexsideId[];
    arrowGameOnly: HexsideId[];
    arrowOursOnly: HexsideId[];
    riverGameOnly: HexsideId[];
    riverOursOnly: HexsideId[];
    borderGameOnly: HexsideId[];
    borderOursOnly: HexsideId[];
  };
  /** Odd records worth a note: flags on an all-sea hex, capitals our map has no city for. */
  notes: string[];
}

const byPosition = (a: string, b: string) => {
  const key = (id: string) => id.split("-").map(parse).flatMap((p) => [p.r, p.q]);
  const x = key(a);
  const y = key(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
  return 0;
};
const sortIds = <T extends string>(ids: Iterable<T>) => [...ids].sort(byPosition);

/** Compare the decoded game map with our map, field by field. */
export function compareMaps(game: readonly GameHex[], map: MapData): Comparison {
  const byId = new Map(game.filter(isPlayableRecord).map((h) => [h.id, h]));
  const ours = map.hexes;
  const c: Comparison = {
    gameOnlyHexes: [],
    oursOnlyHexes: sortIds(Object.keys(ours).filter((id) => !byId.has(id))),
    strayRecords: game.filter((h) => h.label && !isPlayableRecord(h)).map((h) => ({ id: h.id, label: h.label })),
    land: { gameLand: [], gameSea: [] },
    coastal: { gameCoastal: [], gameInland: [] },
    country: [],
    front: [],
    terrain: [],
    features: {
      beach: { gameOnly: [], oursOnly: [] }, city: { gameOnly: [], oursOnly: [] }, port: { gameOnly: [], oursOnly: [] },
      capital: { gameOnly: [], oursOnly: [] }, objective: { gameOnly: [], oursOnly: [] }, fortress: { gameOnly: [], oursOnly: [] },
    },
    hexsides: {
      landGameOnly: [], landOursOnly: [], landOneSided: [], seaGameOnly: [], seaOursOnly: [], seaOneSided: [],
      arrowGameOnly: [], arrowOursOnly: [], riverGameOnly: [], riverOursOnly: [], borderGameOnly: [], borderOursOnly: [],
    },
    notes: [],
  };
  for (const g of byId.values()) {
    if (!ours[g.id]) c.gameOnlyHexes.push({ id: g.id, land: hasLand(g), nation: NATIONS[g.nation] ?? "sea", landSides: g.landSides });
  }
  c.gameOnlyHexes.sort((a, b) => byPosition(a.id, b.id));

  const feature = (k: keyof Comparison["features"], o: boolean, gm: boolean, id: HexId) => {
    if (gm && !o) c.features[k].gameOnly.push(id);
    if (o && !gm) c.features[k].oursOnly.push(id);
  };
  for (const id of sortIds(Object.keys(ours))) {
    const h = ours[id]!;
    const g = byId.get(id);
    if (!g) continue;
    const oLand = h.land !== null;
    if (hasLand(g) && !oLand) c.land.gameLand.push(id);
    if (!hasLand(g) && oLand) c.land.gameSea.push(id);
    if (oLand && hasLand(g)) {
      if (hasSea(g) && !h.sea) c.coastal.gameCoastal.push(id);
      if (!hasSea(g) && h.sea) c.coastal.gameInland.push(id);
      const gc = NATIONS[g.nation] ?? `nation ${g.nation}`;
      if (gc !== h.country) c.country.push({ id, ours: h.country ?? "-", game: gc });
    }
    const gFront = frontName(hasLand(g) ? g.landFront : g.seaFront);
    if (gFront !== h.front) c.front.push({ id, ours: h.front, game: gFront });
    // Terrain: only where the game's single code names a terrain at all.
    const code = TERRAIN_CODES[g.terrain] ?? `code ${g.terrain}`;
    const oursTerrain = h.land === "mountains" ? "mountain" : h.land === "swamp" ? "swamp" : h.land === "qattara-depression" ? "qattara" : h.land ? "clear" : "all sea";
    const comparable = ["clear", "mountain", "swamp", "qattara"].includes(code) && oursTerrain !== "all sea";
    if (comparable && code !== oursTerrain) c.terrain.push({ id, ours: oursTerrain, game: code });
    const f = new Set(h.features);
    feature("beach", f.has("beach"), g.terrain === 4, id);
    feature("city", f.has("city") || f.has("port") || f.has("capital") || f.has("capital-port") || f.has("objective"), g.city, id);
    feature("port", f.has("port") || f.has("capital-port"), g.port, id);
    feature("capital", f.has("capital") || f.has("capital-port"), g.capital, id);
    feature("objective", f.has("objective"), g.objective, id);
    feature("fortress", Boolean(h.fortress), g.terrain === 6 || g.terrain === 7, id);
    if (!hasLand(g) && (g.city || g.port)) c.notes.push(`${id} is open sea in both maps, yet its record carries the city and port flags`);
  }

  const hs = c.hexsides;
  for (const id of sortIds(Object.keys(map.hexsides))) {
    const s = map.hexsides[id]!;
    const [a, b] = id.split("-").map((x) => byId.get(x)!);
    if (!a || !b) continue;
    const land = pairOf(a, b, (h) => h.landSides);
    const sea = pairOf(a, b, (h) => h.seaSides);
    const arrow = pairOf(a, b, (h) => h.arrowSides);
    const river = pairOf(a, b, (h) => h.riverSides);
    if (land === "one") hs.landOneSided.push(id);
    else if ((land === "both") !== s.land) (land === "both" ? hs.landGameOnly : hs.landOursOnly).push(id);
    // A one-sided water mark is answered on the other record by the one-sided bit field.
    const seaOne = sea === "one";
    if (seaOne) hs.seaOneSided.push(id);
    else if ((sea === "both") !== s.sea) (sea === "both" ? hs.seaGameOnly : hs.seaOursOnly).push(id);
    if ((arrow === "both") !== Boolean(s.crossingArrow)) (arrow === "both" ? hs.arrowGameOnly : hs.arrowOursOnly).push(id);
    if ((river === "both") !== Boolean(s.river)) (river === "both" ? hs.riverGameOnly : hs.riverOursOnly).push(id);
    const gameBorder = (land === "both" || arrow === "both") && hasLand(a) && hasLand(b) && a.nation !== b.nation;
    if (gameBorder !== Boolean(s.nationalBoundary)) (gameBorder ? hs.borderGameOnly : hs.borderOursOnly).push(id);
  }
  for (const g of byId.values()) {
    const h = ours[g.id];
    if (g.capital && h && !h.features.some((f) => f === "capital" || f === "capital-port")) {
      c.notes.push(`${g.id}${h.name ? ` (${h.name})` : ""} has the capital flag in the game`);
    }
  }
  return c;
}

