import { describe, expect, it } from "vitest";
import { validateMap, type MapData, type MapHex, type MapHexside } from "../src/engine/map";

// Test fixture around the Qattara Depression. The four Qattara hexsides are the ones
// Ref 4.51 names; the other terrain is simplified for the test.
const hexes: MapHex[] = [
  { id: "MM26", land: "plain", sea: false, features: [] },
  { id: "MM27", land: "plain", sea: false, features: [] },
  { id: "NN25", land: "plain", sea: false, features: [] },
  { id: "NN26", land: "qattara-depression", sea: false, features: [] },
  { id: "NN27", land: "plain", sea: false, features: [] },
];
const qattara = ["NN25-NN26", "NN26-NN27", "MM26-NN26", "MM27-NN26"];
const others = ["MM26-MM27", "MM26-NN25", "MM27-NN27"];
const hexsides: MapHexside[] = [
  ...qattara.map((id) => ({ id, land: false, sea: false, qattara: true })),
  ...others.map((id) => ({ id, land: true, sea: false })),
];

function build(hs: MapHex[] = hexes, sides: MapHexside[] = hexsides): MapData {
  return {
    hexes: Object.fromEntries(hs.map((h) => [h.id, h])),
    hexsides: Object.fromEntries(sides.map((s) => [s.id, s])),
  };
}

describe("validateMap", () => {
  it("accepts a consistent map", () => {
    expect(validateMap(build())).toEqual([]);
  });

  it("reports a missing hexside between playable hexes", () => {
    const errors = validateMap(build(hexes, hexsides.filter((s) => s.id !== "MM27-NN27")));
    expect(errors).toContain("MM27-NN27: missing hexside between playable hexes");
  });

  it("reports hexsides that are not canonical, not adjacent or off the map", () => {
    const errors = validateMap(build(hexes, [
      ...hexsides,
      { id: "NN26-MM26", land: false, sea: false },
      { id: "MM25-NN26", land: true, sea: false },
      { id: "LL27-MM27", land: true, sea: false },
    ]));
    expect(errors).toContain("NN26-MM26: not in canonical order");
    expect(errors).toContain("MM25-NN26: invalid hexside id");
    expect(errors).toContain("LL27-MM27: joins a hex that is not on the map");
  });

  it("checks land, sea and features against each hex", () => {
    const errors = validateMap(build(
      [
        ...hexes.filter((h) => h.id !== "MM27"),
        { id: "MM27", land: null, sea: true, features: ["city"] },
        { id: "A1", land: null, sea: false, features: [] },
        { id: "A2", land: "plain", sea: false, features: ["port"] },
      ],
      [...hexsides, { id: "A1-A2", land: false, sea: true }],
    ));
    expect(errors).toEqual(expect.arrayContaining([
      "MM27: city needs land",
      "MM26-MM27: land hexside needs land on both sides",
      "A1: neither land nor sea",
      "A2: port needs sea",
      "A1-A2: sea hexside needs sea on both sides",
    ]));
  });

  it("rejects a Qattara hexside marked crossable by land", () => {
    const sides = hexsides.map((s) => (s.id === "NN25-NN26" ? { ...s, land: true } : s));
    expect(validateMap(build(hexes, sides))).toContain("NN25-NN26: Qattara hexside cannot be crossable by land");
  });
});
