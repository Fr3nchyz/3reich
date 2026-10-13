import { describe, expect, it } from "vitest";
import { BITMAP_BYTES, decodeBitmap, decodeLine, lineEnds, lineHexsides } from "../scripts/gamedata/formats";
import { CONTROL_BITMAPS, LINE_HEXSIDES } from "../src/data/gamedata";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { REGIONS } from "../src/data/zones";
import { territoryOf } from "../src/engine/areas";
import { hex, hexId, hexsideId, neighbors, type HexId, type HexsideId } from "../src/engine/hex";
import type { ForceOwner, Scenario } from "../src/engine/types";
import { ctxFor } from "./helpers";

// These tests run on the facts committed in src/data/gamedata.ts, never on the original game's files.

type Bitmap = keyof typeof CONTROL_BITMAPS;
const H = MAP.hexes;
const onMap = (ids: Iterable<HexId>) => [...ids].filter((id) => H[id]);
const around = (id: HexId) => onMap(neighbors(hex(id)).filter((n) => n.q >= 0 && n.r >= 0 && n.r < 40).map(hexId));
const sideBetween = (a: HexId, b: HexId) => MAP.hexsides[hexsideId(hex(a), hex(b))];
const landOf = (country: string, ids: Iterable<HexId>) => new Set([...ids].filter((id) => H[id]?.land && H[id]!.country === country));
const countryLand = (country: string) => landOf(country, Object.keys(H));
const sorted = (ids: Iterable<string>) => [...ids].sort();

describe("decoding the original game's file formats (made-up bytes)", () => {
  it("reads a control bitmap: 40 rows of 7 bytes, most significant bit first, offset columns", () => {
    const bytes = new Uint8Array(BITMAP_BYTES);
    bytes[0] = 0b1000_0000; // row A, column 0: q = 0 - 0 + 16
    bytes[3 * 7 + 1] = 0b0000_0001; // row D, column 15: q = 15 - 1 + 16
    bytes[39 * 7 + 6] = 0b0000_0001; // row NN, column 55: q = 55 - 19 + 16
    expect(decodeBitmap(bytes)).toEqual(["A16", "D30", "NN52"]);
    expect(() => decodeBitmap(new Uint8Array(BITMAP_BYTES - 1))).toThrow(/280 bytes/);
  });

  it("reads a line file: a count, a zero, then column, row and hexside mask per hex", () => {
    // Berlin (L31) is bitmap column 31 + 5 - 16 = 20 in row L (11). Mask bits 0 (NE) and 1 (E).
    const bytes = new Uint8Array([2, 0, 20, 11, 0b000011, 20, 12, 0b110000]);
    const entries = decodeLine(bytes);
    expect(entries).toEqual([
      { hex: "L31", directions: ["NE", "E"] },
      { hex: "M30", directions: ["W", "NW"] },
    ]);
    expect(lineHexsides(entries)).toEqual(["K32-L31", "L31-L32", "L30-M30", "M29-M30"].sort());
    expect(() => decodeLine(new Uint8Array([1, 0, 20, 11, 0b1000000]))).toThrow(/more than six/);
    expect(() => decodeLine(new Uint8Array([2, 0, 20, 11, 1]))).toThrow(/not a line file/);
  });

  it("counts the loose ends of a line: two for one unbroken path, two more per extra piece", () => {
    // Three hexsides around the corner shared by L31, L32 and K32 form a Y, with three ends.
    expect(lineEnds(["L31-L32", "K32-L31", "K32-L32"])).toBe(3);
    // Two hexsides of L31 that share a corner make one path; a third far away is another.
    expect(lineEnds(["L31-L32", "K32-L31"])).toBe(2);
    expect(lineEnds(["L31-L32", "K32-L31", "A30-A31"])).toBe(4);
  });
});

describe("the lines of the original game", () => {
  it("draws the Polish Partition Line as one unbroken path of 28 hexsides (NSPPLINE.BIN)", () => {
    expect(LINE_HEXSIDES.NSPPLINE).toHaveLength(28);
    expect(lineEnds(LINE_HEXSIDES.NSPPLINE)).toBe(2);
  });

  it("draws the 1942 and 1944 start lines in pieces that end at coasts and borders", () => {
    expect([LINE_HEXSIDES["1942LINE"].length, lineEnds(LINE_HEXSIDES["1942LINE"])]).toEqual([49, 14]);
    expect([LINE_HEXSIDES["1944LINE"].length, lineEnds(LINE_HEXSIDES["1944LINE"])]).toEqual([43, 8]);
  });

  it("joins only hexes on our map", () => {
    for (const ids of Object.values(LINE_HEXSIDES)) for (const id of ids) expect(MAP.hexsides[id], id).toBeDefined();
  });

  /**
   * A line splits a country between two control bitmaps. Inside the country, a hexside that land
   * units can cross on our map lies between the two sides exactly when the line runs along it.
   * (Hexsides our map says only water crosses, at coasts and inlets, the program leaves undrawn.)
   */
  const splits: { name: string; line: keyof typeof LINE_HEXSIDES; country: string; a: Set<HexId>; b: Set<HexId> }[] = [
    { name: "1942 U.S.S.R.", line: "1942LINE", country: "ussr", a: landOf("ussr", CONTROL_BITMAPS.USSR42), b: landOf("ussr", CONTROL_BITMAPS.GERM42) },
    { name: "1942 Libya", line: "1942LINE", country: "libya", a: landOf("libya", CONTROL_BITMAPS.BRIT42), b: landOf("libya", CONTROL_BITMAPS.ITALY42) },
    { name: "1944 U.S.S.R.", line: "1944LINE", country: "ussr", a: landOf("ussr", CONTROL_BITMAPS.USSR44), b: landOf("ussr", CONTROL_BITMAPS.GERM44) },
    { name: "1944 Italy", line: "1944LINE", country: "italy", a: landOf("italy", CONTROL_BITMAPS.BRIT44), b: landOf("italy", CONTROL_BITMAPS.GERM44) },
    ...["poland", "rumania"].map((c) => {
      const east = landOf(c, CONTROL_BITMAPS.EASTEURP);
      return { name: `Eastern Europe in ${c}`, line: "NSPPLINE" as const, country: c, a: east, b: new Set([...countryLand(c)].filter((h) => !east.has(h))) };
    }),
  ];
  for (const { name, line, country, a, b } of splits) {
    it(`runs exactly along the border between the two sides: ${name}`, () => {
      const drawn = new Set(LINE_HEXSIDES[line]);
      const inside = (s: HexsideId) => s.split("-").every((h) => H[h]?.land && H[h]!.country === country);
      const crossing = new Set<HexsideId>();
      for (const x of a) for (const y of around(x)) if (b.has(y)) crossing.add(hexsideId(hex(x), hex(y)));
      expect(crossing.size, "the sides touch").toBeGreaterThan(0);
      for (const s of LINE_HEXSIDES[line].filter(inside)) expect(crossing.has(s), `${s} is on the line but not between the sides`).toBe(true);
      for (const s of crossing) if (MAP.hexsides[s]!.land) expect(drawn.has(s), `${s} divides the sides but is not on the line`).toBe(true);
    });
  }
});

describe("the control bitmaps of the original game", () => {
  it("mark a few hexes our map calls sea: coastal slivers to check in the map work (ticket T04)", () => {
    const notLand = Object.fromEntries(Object.entries(CONTROL_BITMAPS).map(([k, ids]) => [k, ids.filter((id) => !H[id]?.land)]));
    expect(notLand).toEqual({
      BRIT42: ["H23", "I22"],
      BRIT44: ["H23", "I22", "W21", "Z18", "BB25", "LL20"],
      EASTEURP: ["G38", "H37"],
      GERM42: ["B33", "G31", "G38", "H37", "T40", "DD29"],
      GERM44: ["B33", "G31", "G38", "H37", "DD29"],
      ITALY42: ["Z18", "BB25", "LL20"],
      USSR42: ["U49", "W52", "Z48"],
      USSR44: ["T40", "U49", "W52", "Z48"],
      VICHY: ["W21"],
      VICHY42: ["W21"],
    });
  });

  it("never give one hex to two sides of the same scenario", () => {
    const groups: Bitmap[][] = [["BRIT42", "GERM42", "ITALY42", "USSR42"], ["BRIT44", "GERM44", "USSR44"], ["BRIT42", "ITALY42", "USSR42", "VICHY42"]];
    for (const g of groups) {
      const seen = new Map<HexId, Bitmap>();
      for (const b of g) for (const id of CONTROL_BITMAPS[b]) {
        expect(seen.get(id), `${id} in ${b} and ${seen.get(id)}`).toBeUndefined();
        seen.set(id, b);
      }
    }
    // Germany's 1942 bitmap also marks mainland Vichy France; see the vichy-france zone.
    expect(sorted(CONTROL_BITMAPS.GERM42.filter((id) => CONTROL_BITMAPS.VICHY42.includes(id)))).toEqual(
      sorted([...countryLand("france")].filter((id) => CONTROL_BITMAPS.VICHY42.includes(id) && id !== "X20")),
    );
  });

  it("leave only D43 (both years) and V39 (1944) of the U.S.S.R. to neither side", () => {
    const left = (a: Bitmap, b: Bitmap) => sorted([...countryLand("ussr")].filter((id) => !CONTROL_BITMAPS[a].includes(id) && !CONTROL_BITMAPS[b].includes(id)));
    expect(left("USSR42", "GERM42")).toEqual(["D43"]);
    expect(left("USSR44", "GERM44")).toEqual(["D43", "V39"]);
  });

  it("show Vichy France the same when France falls (VICHY.CON) as at the start of 1942", () => {
    expect(sorted(CONTROL_BITMAPS.VICHY)).toEqual(sorted(CONTROL_BITMAPS.VICHY42.filter((id) => H[id]?.country === "france" || !H[id]?.land)));
  });

  /**
   * Who controls what at the start, as the scenario data encodes it, against the bitmap for that
   * owner. The only differences are named: hexes the bitmaps mark that are not land on our map,
   * mainland Vichy France in Germany's 1942 bitmap, and CC30, an Aegean hex our map gives Turkey.
   */
  const byOwner: { s: Scenario; owner: ForceOwner; bitmap: Bitmap; extra?: (id: HexId) => boolean }[] = [
    { s: SCENARIO_1942, owner: "germany", bitmap: "GERM42", extra: (id) => id === "CC30" || CONTROL_BITMAPS.VICHY42.includes(id) },
    { s: SCENARIO_1942, owner: "italy", bitmap: "ITALY42" },
    { s: SCENARIO_1942, owner: "britain", bitmap: "BRIT42" },
    { s: SCENARIO_1942, owner: "ussr", bitmap: "USSR42" },
    { s: SCENARIO_1942, owner: "vichy-france", bitmap: "VICHY42" },
    { s: SCENARIO_1944, owner: "germany", bitmap: "GERM44", extra: (id) => id === "CC30" },
    { s: SCENARIO_1944, owner: "britain", bitmap: "BRIT44" },
    { s: SCENARIO_1944, owner: "ussr", bitmap: "USSR44" },
  ];
  for (const { s, owner, bitmap, extra } of byOwner) {
    it(`agree with the ${s.id} data on what ${owner} controls at the start (${bitmap}.CON)`, () => {
      const encoded = sorted(territoryOf(ctxFor(s), owner).places);
      const marked = sorted(CONTROL_BITMAPS[bitmap].filter((id) => H[id]?.land && !extra?.(id)));
      expect(encoded).toEqual(marked);
    });
  }
});

describe("zones read off the map", () => {
  function fill(start: HexId, step: (from: HexId, to: HexId) => boolean): Set<HexId> {
    const out = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const a = queue.pop()!;
      for (const b of around(a)) if (!out.has(b) && step(a, b)) (out.add(b), queue.push(b));
    }
    return out;
  }

  it("European Turkey is the Turkish land west of the Straits crossing arrows (Ref 17.3, 4.6)", () => {
    const istanbul = Object.values(H).find((h) => h.name === "Istanbul")!.id;
    const west = fill(istanbul, (a, b) => H[b]!.country === "turkey" && !!H[b]!.land && !!sideBetween(a, b)?.land && !sideBetween(a, b)?.crossingArrow);
    expect(sorted(REGIONS["european-turkey"].hexes)).toEqual(sorted(west));
    // The two Straits crossing arrows lead out of it.
    const arrows = Object.values(MAP.hexsides).filter((s) => s.crossingArrow && s.id.split("-").some((h) => west.has(h)));
    expect(arrows.map((s) => s.id).sort()).toEqual(["AA31-BB31", "Z33-Z34"]);
  });

  it("the Baltic, North Sea and Atlantic ports are those on waters reached from the Atlantic without a Mediterranean hex", () => {
    const atlantic = fill("A24", (_, b) => H[b]!.sea && H[b]!.front !== "mediterranean");
    const isPort = (id: HexId) => !!H[id]!.land && H[id]!.features.some((f) => f === "port" || f === "capital-port");
    const ports = Object.keys(H).filter((id) => isPort(id) && (atlantic.has(id) || around(id).some((n) => atlantic.has(n))));
    expect(sorted(REGIONS["baltic-north-atlantic-ports"].hexes)).toEqual(sorted(ports));
    const named = (name: string) => Object.values(H).find((h) => h.name === name)!.id;
    for (const yes of ["Brest", "Kiel", "Stettin", "Danzig", "Leningrad", "Bergen", "Wilhelmshaven"]) expect(ports, yes).toContain(named(yes));
    for (const no of ["Marseilles", "Genoa", "Odessa", "Sevastopol", "Constanta", "Istanbul", "Rostov", "Batum"]) expect(ports, no).not.toContain(named(no));
  });
});

describe("zones from the original game's files", () => {
  const z42 = SCENARIO_1942.zones;
  const z44 = SCENARIO_1944.zones;
  const named = (name: string) => Object.values(H).find((h) => h.name === name)!.id;

  it("split Libya at Tobruk, with Tobruk British (1942)", () => {
    expect(z42["libya-east-of-start-line"]!.hexes).toContain(named("Tobruk"));
    expect(z42["libya-west-of-start-line"]!.hexes).toContain(named("Tripoli"));
    expect(z42["libya-east-of-start-line"]!.hexes).toHaveLength(8);
    expect(sorted([...z42["libya-east-of-start-line"]!.hexes!, ...z42["libya-west-of-start-line"]!.hexes!])).toEqual(sorted(countryLand("libya")));
  });

  it("leave Leningrad, Moscow and Sevastopol Soviet in 1942, and Kiev and Odessa German", () => {
    for (const c of ["Leningrad", "Moscow", "Sevastopol"]) expect(z42["ussr-east-of-start-line"]!.hexes, c).toContain(named(c));
    for (const c of ["Kiev", "Odessa"]) expect(z42["ussr-west-of-start-line"]!.hexes, c).toContain(named(c));
    expect([z42["ussr-east-of-start-line"]!.hexes!.length, z42["ussr-west-of-start-line"]!.hexes!.length]).toEqual([389, 92]);
  });

  it("leave Smolensk and Kharkov Soviet in 1944 but Minsk, Kiev and Odessa German, and split Italy south of Rome", () => {
    for (const c of ["Smolensk", "Kharkov", "Sevastopol"]) expect(z44["ussr-east-of-start-line"]!.hexes, c).toContain(named(c));
    for (const c of ["Minsk", "Kiev", "Dnepropetrovsk", "Odessa"]) expect(z44["ussr-west-of-start-line"]!.hexes, c).toContain(named(c));
    expect([z44["ussr-east-of-start-line"]!.hexes!.length, z44["ussr-west-of-start-line"]!.hexes!.length]).toEqual([443, 37]);
    expect(z44["italy-north-of-start-line"]!.hexes).toContain(named("Rome"));
    expect(z44["italy-south-of-start-line"]!.hexes).toContain(named("Naples"));
    const italy = [...z44["italy-north-of-start-line"]!.hexes!, ...z44["italy-south-of-start-line"]!.hexes!, ...["sicily", "sardinia", "rhodes"].flatMap((k) => z44[k]!.hexes!)];
    expect(sorted(italy)).toEqual(sorted(countryLand("italy")));
  });

  it("make Vichy France 17 hexes of southern France, Marseilles included, and the rest of mainland France German (1942)", () => {
    expect(z42["vichy-france"]!.hexes).toHaveLength(17);
    expect(z42["vichy-france"]!.hexes).toContain(named("Marseilles"));
    expect(z42["occupied-france"]!.hexes).toContain(named("Paris"));
    expect(sorted([...z42["vichy-france"]!.hexes!, ...z42["occupied-france"]!.hexes!])).toEqual(sorted(SCENARIO_1944.zones["france-mainland"]!.hexes!));
  });

  it("make Eastern Europe the Baltic States, Poland east of the Partition Line and Bessarabia", () => {
    const ee = z42["eastern-europe"]!.hexes!;
    expect(sorted(landOf("baltic-states", ee))).toEqual(sorted(countryLand("baltic-states")));
    expect(landOf("poland", ee).has(named("Warsaw"))).toBe(false);
    expect(sorted(landOf("poland", ee))).toEqual(sorted(SCENARIO_1939.zones["poland-east-of-partition-line"]!.hexes!));
    expect(landOf("rumania", ee).has(named("Kishinev"))).toBe(true);
    expect(landOf("rumania", ee).has(named("Bucharest"))).toBe(false);
    expect(SCENARIO_CAMPAIGN.zones["poland-east-of-partition-line"]).toEqual(SCENARIO_1939.zones["poland-east-of-partition-line"]);
  });
});
