import { describe, expect, it } from "vitest";
import {
  BINMAP_BYTES,
  columnToHex,
  compareMaps,
  decodeBinmap,
  pairOf,
  RECORD_BYTES,
  ROWS,
  sideBit,
  type GameHex,
} from "../scripts/gamedata/binmap";
import type { MapData } from "../src/engine/map";

// Made-up bytes only: the original game's files are never read by the tests.

/** Offset of the record for a bitmap column and row (records are stored column by column). */
const at = (column: number, row: number) => (column * ROWS + row) * RECORD_BYTES;

/** Write one record: row and number label, nation word, sea word, land word, byte 16, byte 17. */
function put(bytes: Uint8Array, column: number, row: number, q: number, f: { nation: number; sea: number; land: number; b16?: number; b17: number; area?: number }) {
  const o = at(column, row);
  bytes[o + 6] = f.area ?? 0;
  bytes[o + 7] = row + 1;
  bytes[o + 8] = q;
  bytes[o + 10] = f.nation & 0xff;
  bytes[o + 11] = f.nation >> 8;
  bytes[o + 12] = f.sea & 0xff;
  bytes[o + 13] = f.sea >> 8;
  bytes[o + 14] = f.land & 0xff;
  bytes[o + 15] = f.land >> 8;
  bytes[o + 16] = f.b16 ?? 0;
  bytes[o + 17] = f.b17;
}

describe("decoding BINMAP.BIN (made-up bytes)", () => {
  it("maps bitmap columns to hex ids as the control bitmaps do", () => {
    expect(columnToHex(15, 10)).toBe("K26"); // 15 - 5 + 16
    expect(columnToHex(0, 39)).toBeNull(); // 0 - 19 + 16 is negative: padding, not a hex
    expect(columnToHex(12, 39)).toBe("NN9");
  });

  it("reads one 22-byte record per hex, column by column", () => {
    const bytes = new Uint8Array(BINMAP_BYTES);
    // Berlin, L31: column 31 + 5 - 16 = 20, row 11. Germany (5), owned by Germany, land on all
    // sides, Western Front; capital and objective, a river on its east side; clear, city.
    put(bytes, 20, 11, 31, { nation: 5 | (5 << 6), sea: 0, land: 0x3f | (1 << 12), b16: 0xc0 | 0b10, b17: 0x12, area: 39 });
    // L32 east of it: Baltic-coast hex with water to the north-east, the E. Europe flag, a crossing arrow west.
    put(bytes, 21, 11, 32, { nation: 15 | (15 << 6) | 0x1000, sea: 0b1 | (2 << 12), land: 0b101100 | (0b10000 << 6) | (2 << 12), b17: 0x41 });
    const recs = decodeBinmap(bytes);
    const berlin = recs.find((r) => r.id === "L31")!;
    expect(berlin).toMatchObject({
      label: "L31", area: 39, nation: 5, owner: 5, eastEurope: false, landSides: 0x3f, landFront: 1,
      seaSides: 0, seaFront: 0, capital: true, objective: true, riverSides: 0b10, terrain: 1, city: true, port: false,
    });
    const l32 = recs.find((r) => r.id === "L32")!;
    expect(l32).toMatchObject({ nation: 15, owner: 15, eastEurope: true, seaSides: 1, seaFront: 2, landSides: 0b101100, arrowSides: 0b10000, terrain: 4, port: true, city: false });
    // Bit 4 of L32 is west, towards Berlin; bit 1 of Berlin is east, towards L32.
    expect(sideBit("L32", "L31")).toBe(1 << 4);
    expect(sideBit("L31", "L32")).toBe(1 << 1);
    expect(pairOf(berlin, l32, (h) => h.riverSides)).toBe("one");
    expect(pairOf(berlin, l32, (h) => h.landSides)).toBe("one"); // L32 marks that side as an arrow, not land
    expect(pairOf(berlin, l32, (h) => h.arrowSides)).toBe("one");
    expect(() => decodeBinmap(new Uint8Array(BINMAP_BYTES - 1))).toThrow(/44880 bytes/);
  });

  it("lists every field where the game and our map disagree", () => {
    const g = (id: string, over: Partial<GameHex>): GameHex => ({
      id, label: id, area: 1, nation: 5, owner: 5, eastEurope: false, seaSides: 0, oneSidedSea: 0, seaFront: 0, landSides: 0,
      arrowSides: 0, landFront: 1, riverSides: 0, capital: false, objective: false, terrain: 1, city: false, port: false, otherFlags: 0,
      ...over,
    });
    const game = [
      g("L31", { landSides: 1 << 1, capital: true }),
      g("L32", { landSides: 1 << 4, nation: 15, terrain: 2 }),
      g("L33", { landFront: 0, seaFront: 2, nation: 0, terrain: 9, seaSides: 1 << 4 }),
    ];
    const map: MapData = {
      hexes: {
        L31: { id: "L31", land: "plain", sea: false, features: [], country: "germany", front: "western" },
        L32: { id: "L32", land: "plain", sea: false, features: [], country: "germany", front: "eastern" },
        L33: { id: "L33", land: "plain", sea: true, features: [], country: "germany", front: "eastern" },
      },
      hexsides: {
        "L31-L32": { id: "L31-L32", land: true, sea: false },
        "L32-L33": { id: "L32-L33", land: false, sea: false },
      },
    };
    const c = compareMaps(game, map);
    expect(c.land.gameSea).toEqual(["L33"]);
    expect(c.country).toEqual([{ id: "L32", ours: "germany", game: "poland" }]);
    expect(c.front).toEqual([{ id: "L32", ours: "eastern", game: "western" }]);
    expect(c.terrain).toEqual([{ id: "L32", ours: "clear", game: "mountain" }]);
    expect(c.features.capital.gameOnly).toEqual(["L31"]);
    expect(c.hexsides.borderGameOnly).toEqual(["L31-L32"]);
    expect(c.hexsides.seaOneSided).toEqual(["L32-L33"]);
  });
});
