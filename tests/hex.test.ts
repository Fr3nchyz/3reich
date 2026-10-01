import { describe, expect, it } from "vitest";
import {
  adjacent,
  distance,
  hex,
  hexId,
  hexsideId,
  neighbors,
  parseHexId,
  parseHexsideId,
  rowLabel,
  ROW_COUNT,
} from "../src/engine/hex";

describe("hex ids", () => {
  it("labels rows A..Z then AA..NN", () => {
    expect(rowLabel(0)).toBe("A");
    expect(rowLabel(25)).toBe("Z");
    expect(rowLabel(26)).toBe("AA");
    expect(rowLabel(39)).toBe("NN");
    expect(() => rowLabel(ROW_COUNT)).toThrow();
  });

  it("round-trips every row and the Ref 4.1 examples", () => {
    for (let r = 0; r < ROW_COUNT; r++) {
      const id = hexId({ q: 17, r });
      expect(hexId(parseHexId(id)!)).toBe(id);
    }
    // Lisbon, Marrakech, Dublin, Rome, Berlin, Helsinki, Moscow, Perma (Ref 4.1).
    for (const id of ["V8", "EE2", "H22", "Y22", "L31", "D41", "H47", "D61"]) {
      expect(hexId(hex(id))).toBe(id);
    }
  });

  it("rejects malformed ids", () => {
    for (const id of ["", "A", "22", "a5", "AB5", "OO5", "AAA5", "A05", "A-1", "K21 "]) {
      expect(parseHexId(id)).toBeNull();
    }
  });
});

describe("adjacency from hexsides named in the manual", () => {
  // Qattara (Ref 4.51), Suez Canal (Ref 4.3), Kerch Strait (Ref 4.8). These only line up
  // if numbered hexrows run northwest to southeast.
  const named = ["NN25-NN26", "NN26-NN27", "MM26-NN26", "MM27-NN26", "LL30-LL31", "MM30-LL31", "MM30-MM31", "U40-U41"];

  it("treats every named hexside as adjacent", () => {
    for (const side of named) {
      const [a, b] = side.split("-").map(hex) as [ReturnType<typeof hex>, ReturnType<typeof hex>];
      expect(adjacent(a, b), side).toBe(true);
    }
  });

  it("does not treat the opposite diagonal as adjacent", () => {
    expect(adjacent(hex("MM25"), hex("NN26"))).toBe(false);
    expect(adjacent(hex("LL29"), hex("MM30"))).toBe(false);
  });

  it("writes hexside ids the way the manual does", () => {
    expect(hexsideId(hex("NN26"), hex("MM26"))).toBe("MM26-NN26");
    expect(hexsideId(hex("LL31"), hex("MM30"))).toBe("LL31-MM30");
    expect(hexsideId(hex("U41"), hex("U40"))).toBe("U40-U41");
    expect(parseHexsideId("MM27-NN26")).not.toBeNull();
    expect(parseHexsideId("MM25-NN26")).toBeNull();
    expect(() => hexsideId(hex("A1"), hex("A3"))).toThrow();
  });
});

describe("neighbours and distance", () => {
  it("gives six distinct neighbours, each at distance 1 and symmetric", () => {
    const h = hex("Q30");
    const ns = neighbors(h);
    expect(new Set(ns.map(hexId)).size).toBe(6);
    for (const n of ns) {
      expect(distance(h, n)).toBe(1);
      expect(neighbors(n).map(hexId)).toContain("Q30");
    }
  });

  it("measures distance along the grid", () => {
    expect(distance(hex("K21"), hex("K21"))).toBe(0);
    expect(distance(hex("A24"), hex("A30"))).toBe(6);
    // Same numbered hexrow: Dublin H22 to Rome Y22 is 17 rows apart.
    expect(distance(hex("H22"), hex("Y22"))).toBe(17);
    // Down-left steps change both coordinates.
    expect(distance(hex("C10"), hex("F7"))).toBe(3);
    expect(distance(hex("C10"), hex("F10"))).toBe(3);
    expect(distance(hex("C10"), hex("F13"))).toBe(6);
  });
});
