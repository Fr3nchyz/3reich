import { describe, expect, it, vi } from "vitest";
import { MAP } from "../src/data/map";
import { hexId, hexsideId, neighbors, parseHexId, type HexId } from "../src/engine/hex";
import type { Front } from "../src/engine/map";
import type * as Rules from "../src/engine/naval-rules";
import { DOUBLE_PORT_HEXES, NAVAL_PER_PORT, ONE_HEX_ISLANDS, SMALL_PORT_CAPACITY, SMALL_PORT_HEXES } from "../src/engine/naval-rules";
import { PORT_FRONTS, isOneHexIsland, isPort, isTwoFrontPort, portCapacity, portFronts, portsOf, portsOnFront } from "../src/engine/naval-ports";
import { NAVAL_FACTOR_STACKING_LIMIT } from "../src/engine/tables";
import { CTX } from "./helpers";

// Spec 12 ticket 12-0, R2 and R3 (Ref 4.4, 4.7, 4.9, 5.0, 21.1, 33.0): what a port bases, which Front it serves, the one-hex islands.
const MALTA = "GG19";
const SUDA_BAY = "GG26";
const FAMAGUSTA = "GG34";
const KIEL = "J30";
const GIBRALTAR = "AA7";
const ISTANBUL = "Z33";
const MARSEILLES = "V19";
const CONSTANTA = "W35";
const SCAPA_FLOW = "B29";

const PORTS = Object.values(MAP.hexes).filter((h) => h.features.includes("port") || h.features.includes("capital-port")).map((h) => h.id);

/** The spec's bucket rule, computed from the raw map: the Fronts of the water hexes next to the port across a sea hexside. */
function waterFronts(port: HexId): Set<Front> {
  const here = parseHexId(port)!;
  const found = new Set<Front>();
  for (const n of neighbors(here)) {
    let id: HexId;
    try {
      id = hexId(n);
    } catch {
      continue; // off the grid
    }
    const there = MAP.hexes[id];
    if (there?.sea && MAP.hexsides[hexsideId(here, n)]?.sea) found.add(there.front);
  }
  return found;
}

/** The Fronts of the hexes next to the port that are all water (no land at all), whatever the hexside between. */
function openWaterFronts(port: HexId): Set<Front> {
  const found = new Set<Front>();
  for (const n of neighbors(parseHexId(port)!)) {
    let id: HexId;
    try {
      id = hexId(n);
    } catch {
      continue;
    }
    const there = MAP.hexes[id];
    if (there?.sea && there.land === null) found.add(there.front);
  }
  return found;
}

describe("capacity: 36 naval factors per port, 9 at Malta, Suda Bay and Famagusta (Ref 21.1, 5.0, 33.0)", () => {
  it("names the numbers: 36 (the setup stacking limit), 9, and the three small ports", () => {
    expect([NAVAL_PER_PORT, NAVAL_FACTOR_STACKING_LIMIT, SMALL_PORT_CAPACITY]).toEqual([36, 36, 9]);
    expect([...SMALL_PORT_HEXES].sort()).toEqual([MALTA, SUDA_BAY, FAMAGUSTA].sort());
    expect(DOUBLE_PORT_HEXES).toEqual([]); // TODO(verify): none is marked on the map data
  });

  it("the three small ports are real ports of the right name", () => {
    expect([MALTA, SUDA_BAY, FAMAGUSTA].map((h) => MAP.hexes[h]!.name)).toEqual(["Malta", "Suda Bay", "Famagusta"]);
    for (const h of [MALTA, SUDA_BAY, FAMAGUSTA]) expect(isPort(CTX, h)).toBe(true);
  });

  it("Malta, Suda Bay and Famagusta base 9", () => {
    expect(portCapacity(CTX, MALTA)).toBe(9);
    expect(portCapacity(CTX, SUDA_BAY)).toBe(9);
    expect(portCapacity(CTX, FAMAGUSTA)).toBe(9);
  });

  it("every other port bases 36, Gibraltar and the capital-ports included", () => {
    const others = PORTS.filter((h) => !SMALL_PORT_HEXES.includes(h));
    expect(others.length).toBe(64);
    for (const h of others) expect(portCapacity(CTX, h), h).toBe(36);
    expect(portCapacity(CTX, GIBRALTAR)).toBe(36);
    expect(portCapacity(CTX, "DD28")).toBe(36); // Athens, a capital-port
    expect(portCapacity(CTX, "E38")).toBe(36); // Stockholm, a capital-port
  });

  it("a hex that is no port bases nothing: a city, open sea, open ground, off the map", () => {
    expect(portCapacity(CTX, "M35")).toBe(0); // Warsaw
    expect(portCapacity(CTX, "L31")).toBe(0); // Berlin
    expect(portCapacity(CTX, "A24")).toBe(0); // open sea
    expect(portCapacity(CTX, "M34")).toBe(0); // plain land
    expect(portCapacity(CTX, "ZZ99")).toBe(0);
    expect(isPort(CTX, "C35")).toBe(false); // Oslo is not a port; Bergen is
    expect(isPort(CTX, "C33")).toBe(true);
  });

  it("a hex of two ports would base 72, and a small one stays 9 (the list is empty on our map)", async () => {
    vi.resetModules();
    vi.doMock("../src/engine/naval-rules", async (original) => ({ ...(await original<typeof Rules>()), DOUBLE_PORT_HEXES: ["AA19", MALTA] }));
    try {
      const ports = await import("../src/engine/naval-ports");
      expect(ports.portCapacity(CTX, "AA19")).toBe(72);
      expect(ports.portCapacity(CTX, MALTA)).toBe(9);
      expect(ports.portCapacity(CTX, "AA24")).toBe(36);
    } finally {
      vi.doUnmock("../src/engine/naval-rules");
      vi.resetModules();
    }
  });
});

describe("the 67 ports and their Fronts (Ref 4.4, 21.1)", () => {
  it("the map has 67 ports: 21 western, 8 eastern and 38 Mediterranean by the Front of the port's own hex", () => {
    expect(PORTS.length).toBe(67);
    expect(portsOf(CTX).sort()).toEqual([...PORTS].sort());
    const by = (f: Front) => PORTS.filter((h) => MAP.hexes[h]!.front === f).length;
    expect([by("western"), by("eastern"), by("mediterranean")]).toEqual([21, 8, 38]);
  });

  it("by the Front of the water they open on the clear ports are 18, 8 and 32 and nine need a hand check", () => {
    const clear = (f: Front) => PORTS.filter((h) => {
      const w = waterFronts(h);
      return w.size === 1 && w.has(f);
    }).length;
    expect([clear("western"), clear("eastern"), clear("mediterranean")]).toEqual([18, 8, 32]);
    const odd = PORTS.filter((h) => waterFronts(h).size !== 1).sort();
    expect(odd).toEqual(["AA7", "J32", "JJ34", "K32", "R12", "S11", "X43", "Z33", "Z7"].sort());
  });

  it("the table has an entry for each of the 67 ports and for nothing else, each with one or two Fronts", () => {
    expect(Object.keys(PORT_FRONTS).sort()).toEqual([...PORTS].sort());
    for (const h of PORTS) {
      const fronts = portFronts(CTX, h);
      expect([1, 2], h).toContain(fronts.length);
      expect(new Set(fronts).size, h).toBe(fronts.length);
    }
  });

  it("the table equals the Front of the water for the 57 clear ports other than Kiel; Kiel is the 58th clear port, and its Baltic side is written by hand", () => {
    const clear = PORTS.filter((h) => waterFronts(h).size === 1);
    expect(clear.length).toBe(58);
    for (const h of clear.filter((p) => p !== KIEL)) expect(portFronts(CTX, h), `${h} ${MAP.hexes[h]!.name}`).toEqual([...waterFronts(h)]);
    expect([...waterFronts(KIEL)]).toEqual(["western"]);
  });

  it("Marseilles is Mediterranean (western by land) and Constanta is the Black Sea, which is Eastern (Mediterranean by land)", () => {
    expect(MAP.hexes[MARSEILLES]!.front).toBe("western");
    expect(portFronts(CTX, MARSEILLES)).toEqual(["mediterranean"]);
    expect(MAP.hexes[CONSTANTA]!.front).toBe("mediterranean");
    expect(portFronts(CTX, CONSTANTA)).toEqual(["eastern"]);
    for (const h of ["T37", "V38", "X43"]) expect(portFronts(CTX, h)).toEqual(["eastern"]); // Odessa, Sevastopol, Batum
  });

  it("exactly Kiel, Gibraltar and Istanbul serve two Fronts", () => {
    const two = PORTS.filter((h) => isTwoFrontPort(CTX, h)).sort();
    expect(two).toEqual([GIBRALTAR, ISTANBUL, KIEL].sort());
    expect([...portFronts(CTX, KIEL)].sort()).toEqual(["eastern", "western"]); // Baltic and North Sea
    expect([...portFronts(CTX, GIBRALTAR)].sort()).toEqual(["mediterranean", "western"]);
    expect([...portFronts(CTX, ISTANBUL)].sort()).toEqual(["eastern", "mediterranean"]); // Black Sea and Mediterranean
    expect(isTwoFrontPort(CTX, "AA19")).toBe(false);
    expect(isTwoFrontPort(CTX, "A24")).toBe(false);
  });

  it("the seven ports the map does not settle (TODO(verify)): each takes the Front of the all-water hexes beside it", () => {
    const hand: Record<HexId, Front> = { J32: "eastern", K32: "eastern", S11: "western", R12: "western", Z7: "western", X43: "eastern", JJ34: "mediterranean" };
    for (const [h, front] of Object.entries(hand)) {
      expect(portFronts(CTX, h), h).toEqual([front]);
      expect([...openWaterFronts(h)], `${h} ${MAP.hexes[h]!.name}`).toEqual([front]);
    }
  });

  it("Front lists: 22 western, 13 eastern and 35 Mediterranean ports (70 entries for 67 ports), a two-Front port on both of its lists", () => {
    const w = portsOnFront(CTX, "western");
    const e = portsOnFront(CTX, "eastern");
    const m = portsOnFront(CTX, "mediterranean");
    expect([w.length, e.length, m.length]).toEqual([22, 13, 35]);
    expect([KIEL, GIBRALTAR].every((h) => w.includes(h))).toBe(true);
    expect([KIEL, ISTANBUL].every((h) => e.includes(h))).toBe(true);
    expect([GIBRALTAR, ISTANBUL].every((h) => m.includes(h))).toBe(true);
    expect(new Set([...w, ...e, ...m]).size).toBe(67);
  });

  it("a hex that is no port serves no Front", () => {
    expect(portFronts(CTX, "M35")).toEqual([]);
    expect(portFronts(CTX, "A24")).toEqual([]);
    expect(portFronts(CTX, "ZZ99")).toEqual([]);
  });
});

describe("one-hex islands (Ref 4.9, 19.31)", () => {
  it("Malta and Scapa Flow, the two the manual names, and no other", () => {
    expect([...ONE_HEX_ISLANDS].sort()).toEqual([MALTA, SCAPA_FLOW].sort());
    expect(isOneHexIsland(CTX, MALTA)).toBe(true);
    expect(isOneHexIsland(CTX, SCAPA_FLOW)).toBe(true);
    expect(MAP.hexes[MALTA]!.name).toBe("Malta");
    expect(MAP.hexes[SCAPA_FLOW]!.name).toBe("Scapa Flow");
  });

  it("Sardinia, Corsica, Rhodes, Sicily, Berlin, Suda Bay, open sea and a hex off the map are not on the list", () => {
    for (const h of ["AA19", "X20", "FF30", "DD20", "L31", "GG26", "A24", "ZZ99"]) expect(isOneHexIsland(CTX, h), h).toBe(false);
  });

  it("Malta touches no other land hex; Scapa Flow touches Scotland only across a crossing arrow", () => {
    const land = (h: HexId) => neighbors(parseHexId(h)!).flatMap((n) => { try { return [hexId(n)]; } catch { return []; } }).filter((id) => MAP.hexes[id]?.land);
    expect(land(MALTA)).toEqual([]);
    expect(land(SCAPA_FLOW)).toEqual(["C28"]);
    expect(MAP.hexsides["B29-C28"]).toMatchObject({ crossingArrow: true, land: false });
  });
});
