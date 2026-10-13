import { describe, expect, it } from "vitest";
import { around as aroundOn, borderCheck } from "../scripts/gamedata/checks";
import { BITMAP_BYTES, decodeBitmap, decodeLine, lineEnds, lineHexsides, MASK_DIRECTIONS, readingFor, type LineEntry } from "../scripts/gamedata/formats";
import { LINES, ORIGINAL_ZONES } from "../src/data/gamedata";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { REGIONS } from "../src/data/zones";
import { hexsideId, hex, type Direction, type HexId } from "../src/engine/hex";

// These tests run on the facts committed in src/data/gamedata.ts, never on the original game's files.
// The cross-checks that need the whole control bitmaps run in scripts/gamedata/extract.ts.

const H = MAP.hexes;
const around = (id: HexId) => aroundOn(MAP, id);
const sideBetween = (a: HexId, b: HexId) => MAP.hexsides[hexsideId(hex(a), hex(b))];
const landOf = (country: string, ids: Iterable<HexId>) => new Set([...ids].filter((id) => H[id]?.land && H[id].country === country));
const countryLand = (country: string) => landOf(country, Object.keys(H));
const sorted = (ids: Iterable<string>) => [...ids].sort();
const z39 = SCENARIO_1939.zones;
const z42 = SCENARIO_1942.zones;
const z44 = SCENARIO_1944.zones;
const hexesOf = (zones: Record<string, { hexes: HexId[] | null }>, ...ids: string[]) => new Set(ids.flatMap((id) => zones[id]!.hexes!));
const named = (name: string) => Object.values(H).find((h) => h.name === name)!.id;

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
      { hex: "L31", sides: ["NE", "E"] },
      { hex: "M30", sides: ["W", "NW"] },
    ]);
    expect(lineHexsides(entries)).toEqual(["K32-L31", "L31-L32", "L30-M30", "M29-M30"].sort());
    expect(() => decodeLine(new Uint8Array([1, 0, 20, 11, 0b1000000]))).toThrow(/more than six/);
    expect(() => decodeLine(new Uint8Array([2, 0, 20, 11, 1]))).toThrow(/not a line file/);
  });

  it("says clearly when a reading of the mask runs a line off the map", () => {
    expect(() => lineHexsides([{ hex: "NN22", sides: ["W"] }], readingFor(["NE", "E", "SE", "W", "SW", "NW"]))).toThrow(/NN22: its SW side leads off the map/);
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
  const hexsides = (l: keyof typeof LINES) => lineHexsides(LINES[l]);

  it("draws the Polish Partition Line as one unbroken path of 28 hexsides (NSPPLINE.BIN)", () => {
    expect(hexsides("NSPPLINE")).toHaveLength(28);
    expect(lineEnds(hexsides("NSPPLINE"))).toBe(2);
  });

  it("draws the 1942 and 1944 start lines in pieces that end at coasts and borders", () => {
    expect([hexsides("1942LINE").length, lineEnds(hexsides("1942LINE"))]).toEqual([49, 14]);
    expect([hexsides("1944LINE").length, lineEnds(hexsides("1944LINE"))]).toEqual([43, 8]);
  });

  it("joins only hexes on our map", () => {
    for (const l of Object.keys(LINES) as (keyof typeof LINES)[]) for (const id of hexsides(l)) expect(MAP.hexsides[id], id).toBeDefined();
  });

  /** Each line splits a country between two zones of the same scenario. */
  const splits: { name: string; line: keyof typeof LINES; country: string; a: Set<HexId>; b: Set<HexId> }[] = [
    { name: "1942 U.S.S.R.", line: "1942LINE", country: "ussr", a: hexesOf(z42, "ussr-east-of-start-line"), b: hexesOf(z42, "ussr-west-of-start-line") },
    { name: "1942 Libya", line: "1942LINE", country: "libya", a: hexesOf(z42, "libya-east-of-start-line"), b: hexesOf(z42, "libya-west-of-start-line") },
    { name: "1944 U.S.S.R.", line: "1944LINE", country: "ussr", a: hexesOf(z44, "ussr-east-of-start-line"), b: hexesOf(z44, "ussr-west-of-start-line") },
    {
      name: "1944 Italy",
      line: "1944LINE",
      country: "italy",
      a: hexesOf(z44, "italy-south-of-start-line", "sicily", "sardinia"),
      b: hexesOf(z44, "italy-north-of-start-line", "rhodes"),
    },
    ...[
      { c: "poland", east: hexesOf(z39, "poland-east-of-partition-line") },
      { c: "rumania", east: landOf("rumania", z42["eastern-europe"]!.hexes!) },
    ].map(({ c, east }) => ({
      name: `the Partition Line in ${c}`,
      line: "NSPPLINE" as const,
      country: c,
      a: east,
      b: new Set([...countryLand(c)].filter((h) => !east.has(h))),
    })),
  ];

  /**
   * Line hexsides inside the country that do not lie between the two zones, under a reading of the
   * mask bits; a side that leads off the map, or off our map, counts too.
   */
  function misses(reading: (d: Direction) => Direction): number {
    let n = 0;
    for (const { line, country, a, b } of splits) {
      const sides: string[] = [];
      for (const e of LINES[line]) {
        for (const s of e.sides) {
          try {
            const [id] = lineHexsides([{ hex: e.hex, sides: [s] } satisfies LineEntry], reading);
            if (MAP.hexsides[id!]) sides.push(id!);
            else n++;
          } catch {
            n++;
          }
        }
      }
      n += borderCheck(MAP, sides, country, a, b).offBorder.length;
    }
    return n;
  }

  for (const { name, line, country, a, b } of splits) {
    it(`runs exactly along the border between the two zones: ${name}`, () => {
      const r = borderCheck(MAP, hexsides(line), country, a, b);
      expect(r.inside, "the line has hexsides inside the country").toBeGreaterThan(0);
      expect(r.offBorder, "line hexsides that are not between the zones").toEqual([]);
      expect(r.undrawn, "land hexsides between the zones that the line leaves out").toEqual([]);
    });
  }

  it("puts every line hexside on a border only with mask bits 0-5 read as NE, E, SE, SW, W, NW", () => {
    expect(misses((d) => d)).toBe(0);
    // Bits 3 and 4 swapped: contiguity cannot tell, but the borders can (Tobruk and the Crimea).
    const m = MASK_DIRECTIONS;
    expect(misses(readingFor([m[0]!, m[1]!, m[2]!, m[4]!, m[3]!, m[5]!]))).toBeGreaterThan(0);
    // Every other one of the 720 ways to map six bits to six directions misses too.
    const permutations = (xs: readonly Direction[]): Direction[][] =>
      xs.length <= 1 ? [[...xs]] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
    const clean = permutations(MASK_DIRECTIONS).filter((order) => misses(readingFor(order)) === 0);
    expect(clean).toEqual([[...MASK_DIRECTIONS]]);
  });
});

describe("zones from the original game's files", () => {
  /**
   * Hexes the original marks for a zone that our map calls sea: coastal slivers for the map work
   * (ticket T04). They are committed with the zone and join it as soon as our map makes them land of
   * the zone's country. When T04 makes one land, this test fails: take it off the list. Nothing else
   * here should need changing, because the counts below are counts of the committed lists.
   */
  it("marks a few hexes our map calls sea", () => {
    const sea = Object.fromEntries(
      Object.entries(ORIGINAL_ZONES).flatMap(([k, ids]) => {
        const notLand = ids.filter((id) => !H[id]?.land);
        return notLand.length ? [[k, notLand]] : [];
      }),
    );
    expect(sea).toEqual({
      "1942/ussr-east-of-start-line": ["U49", "W52", "Z48"],
      "1942/ussr-west-of-start-line": ["T40"],
      "1942/libya-west-of-start-line": ["LL20"],
      "1944/ussr-east-of-start-line": ["T40", "U49", "W52", "Z48"],
      "1944/italy-south-of-start-line": ["BB25"],
      "eastern-europe": ["G38", "H37"],
    });
  });

  it("holds as many hexes per zone as the original marks (counts of the committed lists, whatever our map says)", () => {
    const counts = Object.fromEntries(Object.entries(ORIGINAL_ZONES).map(([k, ids]) => [k, ids.length]));
    expect(counts).toEqual({
      "1942/ussr-east-of-start-line": 392,
      "1942/ussr-west-of-start-line": 93,
      "1942/libya-east-of-start-line": 8,
      "1942/libya-west-of-start-line": 54,
      "1942/vichy-france": 17,
      "1942/occupied-france": 40,
      "1944/ussr-east-of-start-line": 447,
      "1944/ussr-west-of-start-line": 37,
      "1944/italy-north-of-start-line": 26,
      "1944/italy-south-of-start-line": 11,
      "eastern-europe": 36,
    });
  });

  it("split Libya at Tobruk, with Tobruk British (1942)", () => {
    expect(z42["libya-east-of-start-line"]!.hexes).toContain(named("Tobruk"));
    expect(z42["libya-west-of-start-line"]!.hexes).toContain(named("Tripoli"));
    expect(sorted(hexesOf(z42, "libya-east-of-start-line", "libya-west-of-start-line"))).toEqual(sorted(countryLand("libya")));
  });

  it("leave Leningrad, Moscow and Sevastopol Soviet in 1942, and Kiev and Odessa German", () => {
    for (const c of ["Leningrad", "Moscow", "Sevastopol"]) expect(z42["ussr-east-of-start-line"]!.hexes, c).toContain(named(c));
    for (const c of ["Kiev", "Odessa"]) expect(z42["ussr-west-of-start-line"]!.hexes, c).toContain(named(c));
  });

  it("leave Smolensk and Kharkov Soviet in 1944 but Minsk, Kiev and Odessa German, and split Italy south of Rome", () => {
    for (const c of ["Smolensk", "Kharkov", "Sevastopol"]) expect(z44["ussr-east-of-start-line"]!.hexes, c).toContain(named(c));
    for (const c of ["Minsk", "Kiev", "Dnepropetrovsk", "Odessa"]) expect(z44["ussr-west-of-start-line"]!.hexes, c).toContain(named(c));
    expect(z44["italy-north-of-start-line"]!.hexes).toContain(named("Rome"));
    expect(z44["italy-south-of-start-line"]!.hexes).toContain(named("Naples"));
    const italy = hexesOf(z44, "italy-north-of-start-line", "italy-south-of-start-line", "sicily", "sardinia", "rhodes");
    expect(sorted(italy)).toEqual(sorted(countryLand("italy")));
  });

  // TODO(verify): D43 is joined by land only to Finland on our map, so it may be Finnish in the
  // original (no Finland bitmap) or water. V39 is in the Crimea. See docs/RULES.md "Open questions".
  it("leave only D43 (both years) and V39 (1944) of the U.S.S.R. outside both start-line zones", () => {
    const left = (z: typeof z42) => sorted([...countryLand("ussr")].filter((id) => !hexesOf(z, "ussr-east-of-start-line", "ussr-west-of-start-line").has(id)));
    expect(left(z42)).toEqual(["D43"]);
    expect(left(z44)).toEqual(["D43", "V39"]);
  });

  it("make Vichy France southern France, Marseilles included, and the rest of mainland France German (1942)", () => {
    expect(z42["vichy-france"]!.hexes).toContain(named("Marseilles"));
    expect(z42["occupied-france"]!.hexes).toContain(named("Paris"));
    expect(sorted(hexesOf(z42, "vichy-france", "occupied-france"))).toEqual(sorted(z44["france-mainland"]!.hexes!));
  });

  it("make Eastern Europe the Baltic States, Poland east of the Partition Line and Bessarabia", () => {
    const ee = z42["eastern-europe"]!.hexes!;
    expect(sorted(landOf("baltic-states", ee))).toEqual(sorted(countryLand("baltic-states")));
    expect(landOf("poland", ee).has(named("Warsaw"))).toBe(false);
    expect(sorted(landOf("poland", ee))).toEqual(sorted(z39["poland-east-of-partition-line"]!.hexes!));
    expect(landOf("rumania", ee).has(named("Kishinev"))).toBe(true);
    expect(landOf("rumania", ee).has(named("Bucharest"))).toBe(false);
    expect(SCENARIO_CAMPAIGN.zones["poland-east-of-partition-line"]).toEqual(z39["poland-east-of-partition-line"]);
  });
});

// These two zones are worked out from our map, not read from the game's files: the tests guard the
// committed lists against drift from the rule, they are not independent evidence.
describe("zones read off the map", () => {
  function fill(start: HexId, step: (from: HexId, to: HexId) => boolean): Set<HexId> {
    const out = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const a = queue.pop()!;
      for (const b of around(a)) {
        if (out.has(b) || !step(a, b)) continue;
        out.add(b);
        queue.push(b);
      }
    }
    return out;
  }

  it("European Turkey is the Turkish land west of the Straits crossing arrows (Ref 17.3, 4.6)", () => {
    const west = fill(named("Istanbul"), (a, b) => H[b]!.country === "turkey" && !!H[b]!.land && !!sideBetween(a, b)?.land && !sideBetween(a, b)?.crossingArrow);
    expect(sorted(REGIONS["european-turkey"].hexes)).toEqual(sorted(west));
    const arrows = Object.values(MAP.hexsides).filter((s) => s.crossingArrow && s.id.split("-").some((h) => west.has(h)));
    expect(arrows.map((s) => s.id).sort()).toEqual(["AA31-BB31", "Z33-Z34"]);
  });

  it("the Baltic, North Sea and Atlantic ports are those on waters reached from the Atlantic without a Mediterranean hex", () => {
    const atlantic = fill("A24", (_, b) => H[b]!.sea && H[b]!.front !== "mediterranean");
    const isPort = (id: HexId) => !!H[id]!.land && H[id]!.features.some((f) => f === "port" || f === "capital-port");
    const ports = Object.keys(H).filter((id) => isPort(id) && (atlantic.has(id) || around(id).some((n) => atlantic.has(n))));
    expect(sorted(REGIONS["baltic-north-atlantic-ports"].hexes)).toEqual(sorted(ports));
    for (const yes of ["Brest", "Kiel", "Stettin", "Danzig", "Leningrad", "Bergen", "Wilhelmshaven"]) expect(ports, yes).toContain(named(yes));
    for (const no of ["Marseilles", "Genoa", "Odessa", "Sevastopol", "Constanta", "Istanbul", "Rostov", "Batum"]) expect(ports, no).not.toContain(named(no));
  });
});
