import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { distance, hex, parseHexsideId, hexId, type HexId } from "../src/engine/hex";
import { seaDistance, seaDistances, seaNeighbors, seaRoute } from "../src/engine/naval-routes";
import { portsOf } from "../src/engine/naval-ports";
import { CTX } from "./helpers";

// Spec 12 ticket 12-0, R9 and R11 (Ref 4.3, 21.2): the shortest sea route between two water hexes, breadth-first, fixed neighbour order.
const MALTA = "GG19";
const TRIPOLI = "II17";
const PLYMOUTH = "K21";
const BREST = "N18";
const KIEL = "J30";
const DANZIG = "J35";
const ODESSA = "T37";
const SEVASTOPOL = "V38";
const CONSTANTA = "W35";
const ISTANBUL = "Z33";
const PORT_SAID = "LL31";
const SUEZ = "MM30";
const GENOA = "U22";
const CAGLIARI = "AA19";

/** An independent search: adjacency built from the hexside list alone (every plain sea hexside), then a plain breadth-first search for the distance. */
function oracle(from: HexId): Map<HexId, number> {
  const adj = new Map<HexId, HexId[]>();
  for (const side of Object.values(MAP.hexsides)) {
    if (!side.sea || side.crossingArrow || side.suezCanal) continue;
    const [a, b] = parseHexsideId(side.id)!.map(hexId) as [HexId, HexId];
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const dist = new Map<HexId, number>([[from, 0]]);
  const queue = [from];
  for (const at of queue) {
    for (const next of adj.get(at) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, dist.get(at)! + 1);
      queue.push(next);
    }
  }
  return dist;
}

describe("sea neighbours: the sea hexsides, in the fixed order E, W, NE, NW, SE, SW", () => {
  it("an open-sea hex has all six, in that order", () => {
    // AA12: row AA, hexrow 12, in the middle of the Mediterranean.
    expect(seaNeighbors(CTX, "AA12")).toEqual(["AA13", "AA11", "Z13", "Z12", "BB12", "BB11"]);
  });

  it("every water hex on the map answers without error, with sea hexes next to it, each sea hexside seen from both ends", () => {
    const water = Object.values(MAP.hexes).filter((h) => h.sea).map((h) => h.id);
    expect(water.length).toBe(796);
    for (const h of water) {
      for (const n of seaNeighbors(CTX, h)) {
        expect(MAP.hexes[n]?.sea, `${h} to ${n}`).toBe(true);
        expect(distance(hex(h), hex(n))).toBe(1);
        expect(seaNeighbors(CTX, n), `${n} back to ${h}`).toContain(h);
      }
    }
  });

  it("the edge of the grid is not stepped over: hexrow 0 and the last row, on a map of two hexes", () => {
    const sea = (id: string) => ({ id, land: null, sea: true, features: [], front: "western" as const });
    const edge = { ...CTX, map: { hexes: { A0: sea("A0"), NN5: sea("NN5") }, hexsides: {} } };
    expect(seaNeighbors(edge, "A0")).toEqual([]);
    expect(seaNeighbors(edge, "NN5")).toEqual([]);
    const joined = { ...CTX, map: { hexes: { A1: sea("A1"), A0: sea("A0") }, hexsides: { "A0-A1": { id: "A0-A1", land: false, sea: true } } } };
    expect(seaNeighbors(joined, "A1")).toEqual(["A0"]);
    expect(seaNeighbors(joined, "A0")).toEqual(["A1"]);
  });

  it("a hex with no water, a land hex and a hex off the map have none", () => {
    expect(seaNeighbors(CTX, "M34")).toEqual([]); // plain land
    expect(seaNeighbors(CTX, "ZZ99")).toEqual([]);
    expect(seaNeighbors(CTX, "")).toEqual([]);
  });

  it("a coastal hex has only the neighbours across a sea hexside: the land side is not sailed", () => {
    for (const port of portsOf(CTX)) {
      for (const n of seaNeighbors(CTX, port)) {
        expect(distance(hex(port), hex(n)), `${port} ${n}`).toBe(1);
        expect(MAP.hexes[n]!.sea, n).toBe(true);
      }
    }
    expect(seaNeighbors(CTX, "K32")).toEqual([]); // Stettin touches no sea hexside in the data
    expect(seaNeighbors(CTX, "R12")).toEqual([]); // La Coruna
    expect(seaNeighbors(CTX, "JJ34")).toEqual([]); // Haifa
  });

  it("a crossing arrow is not a step (its use depends on who holds the land: ticket 12-10)", () => {
    expect(MAP.hexsides["B29-C28"]).toMatchObject({ sea: true, crossingArrow: true });
    expect(seaNeighbors(CTX, "B29")).not.toContain("C28"); // Scapa Flow to Scotland
    expect(seaNeighbors(CTX, "C28")).not.toContain("B29");
    expect(seaNeighbors(CTX, ISTANBUL)).not.toContain("Z34"); // the Bosphorus arrow
    expect(seaNeighbors(CTX, "I30")).not.toContain("I31"); // a Danish strait
  });

  it("the Suez Canal is not a plain step (the map-only route leaves it out; the state-aware base-change route always allows it: N22)", () => {
    expect(MAP.hexsides["LL31-MM30"]).toMatchObject({ sea: true, suezCanal: true });
    expect(seaNeighbors(CTX, PORT_SAID)).not.toContain(SUEZ);
    expect(seaNeighbors(CTX, SUEZ)).not.toContain(PORT_SAID);
  });
});

describe("the shortest sea route (breadth-first)", () => {
  it("known short routes: Malta to Tripoli, Plymouth to Brest, Genoa to Cagliari, Odessa to Sevastopol, Kiel to Danzig", () => {
    expect(seaRoute(CTX, MALTA, TRIPOLI)).toEqual(["GG19", "HH18", "II17"]);
    expect(seaRoute(CTX, PLYMOUTH, BREST)).toEqual(["K21", "L20", "L19", "M18", "N18"]);
    expect(seaDistance(CTX, GENOA, CAGLIARI)).toBe(6);
    expect(seaDistance(CTX, ODESSA, SEVASTOPOL)).toBe(3);
    expect(seaDistance(CTX, KIEL, DANZIG)).toBe(6);
  });

  it("known long routes: Kiel to Cagliari goes round Britain's south and through the Strait of Gibraltar; Gibraltar to Plymouth is 20", () => {
    const r = seaRoute(CTX, KIEL, CAGLIARI)!;
    expect(r.length - 1).toBe(41);
    expect(r).toContain("AA7"); // Gibraltar
    expect(r).toContain("L23"); // the Strait of Dover
    expect(seaDistance(CTX, "AA7", PLYMOUTH)).toBe(20);
  });

  it("the length is at least the straight distance and equal to it across open water", () => {
    expect(distance(hex(MALTA), hex(TRIPOLI))).toBe(seaDistance(CTX, MALTA, TRIPOLI));
    expect(distance(hex("U22"), hex(CAGLIARI))).toBe(seaDistance(CTX, GENOA, CAGLIARI));
    expect(distance(hex(PLYMOUTH), hex(BREST))).toBeLessThan(seaDistance(CTX, PLYMOUTH, BREST)!); // the Channel is not straight
  });

  it("the route is a chain of sea steps from the first hex to the last, with no hex twice, and is the shortest", () => {
    const route = seaRoute(CTX, KIEL, CAGLIARI)!;
    expect(route[0]).toBe(KIEL);
    expect(route.at(-1)).toBe(CAGLIARI);
    expect(new Set(route).size).toBe(route.length);
    route.slice(1).forEach((h, i) => expect(seaNeighbors(CTX, route[i]!), `${route[i]} to ${h}`).toContain(h));
    expect(route.length - 1).toBe(oracle(KIEL).get(CAGLIARI));
  });

  it("from every port, the distance to every water hex is what an independent search finds (and the hexes it cannot reach are missing)", () => {
    const ports = portsOf(CTX);
    let reached = 0;
    for (const a of ports) {
      const want = oracle(a);
      const got = seaDistances(CTX, a);
      expect(got.size, a).toBe(want.size);
      for (const [h, d] of want) expect(got.get(h), `${a} to ${h}`).toBe(d);
      reached += got.size;
    }
    expect(reached).toBe(57 * 620 + 6 * 61 + 4); // 57 ports in a sea of 620 hexes, 6 in one of 61, four alone (each reaches itself)
    expect(seaDistances(CTX, "K32").size).toBe(1);
  });

  it("seaDistance and seaRoute agree with that search for every pair among 14 ports from all the seas", () => {
    const some = [KIEL, DANZIG, PLYMOUTH, BREST, "AA7", CAGLIARI, GENOA, MALTA, TRIPOLI, ODESSA, ISTANBUL, "K32", PORT_SAID, SUEZ];
    for (const a of some) {
      const want = oracle(a);
      for (const b of some) {
        expect(seaDistance(CTX, a, b), `${a} to ${b}`).toBe(want.get(b) ?? null);
        expect(seaRoute(CTX, a, b)?.length, `${a} to ${b}`).toBe(want.has(b) ? want.get(b)! + 1 : undefined);
      }
    }
  });

  it("the route between two ports is the same every time, and the same in both directions in length", () => {
    expect(seaRoute(CTX, KIEL, CAGLIARI)).toEqual(seaRoute(CTX, KIEL, CAGLIARI));
    expect(seaDistance(CTX, CAGLIARI, KIEL)).toBe(seaDistance(CTX, KIEL, CAGLIARI));
  });

  it("the same hex is a route of one hex and length 0", () => {
    expect(seaRoute(CTX, MALTA, MALTA)).toEqual([MALTA]);
    expect(seaDistance(CTX, MALTA, MALTA)).toBe(0);
    expect(seaDistance(CTX, "K32", "K32")).toBe(0); // even a port with no sea hexside
  });

  it("equal routes: the one found first in the fixed neighbour order is taken", () => {
    // Plymouth to Brest has more than one shortest route (the oracle counts them); the pinned one is the first in the order E, W, NE, NW, SE, SW.
    const dist = oracle(BREST);
    const alternatives = seaNeighbors(CTX, PLYMOUTH).filter((n) => dist.get(n) === dist.get(PLYMOUTH)! - 1);
    expect(alternatives.length).toBeGreaterThan(0);
    expect(seaRoute(CTX, PLYMOUTH, BREST)![1]).toBe(alternatives[0]); // seaNeighbors is in the fixed order
  });

  it("any water hex counts, not only ports: a route from open sea to a port", () => {
    expect(seaDistance(CTX, "AA12", CAGLIARI)).toBe(oracle(CAGLIARI).get("AA12"));
    expect(seaDistance(CTX, "AA12", CAGLIARI)).toBeGreaterThan(0);
  });
});

describe("where there is no route", () => {
  it("the Black Sea is a body of water of its own: no route to the Mediterranean, the Atlantic or the Baltic (Ref 21.1, 21.2)", () => {
    expect(seaRoute(CTX, ODESSA, CAGLIARI)).toBeNull();
    expect(seaRoute(CTX, CONSTANTA, KIEL)).toBeNull();
    expect(seaRoute(CTX, ODESSA, DANZIG)).toBeNull();
    expect(seaRoute(CTX, ISTANBUL, "AA24")).toBeNull(); // Istanbul to Taranto: the straits need ticket 12-10
    expect(seaDistance(CTX, ISTANBUL, CONSTANTA)).toBe(3);
  });

  it("the Baltic is joined to the North Sea by plain sea hexsides, so Kiel reaches Danzig and Stockholm", () => {
    expect(seaDistance(CTX, KIEL, DANZIG)).not.toBeNull();
    expect(seaDistance(CTX, KIEL, "E38")).not.toBeNull();
    expect(seaDistance(CTX, "E38", "AA7")).not.toBeNull();
  });

  it("Port Said does not reach Suez without the canal rule, and ports that touch no sea hexside reach nothing else", () => {
    expect(seaRoute(CTX, PORT_SAID, SUEZ)).toBeNull();
    for (const lone of ["K32", "R12", "JJ34"]) expect(seaRoute(CTX, lone, KIEL)).toBeNull();
    expect(seaRoute(CTX, KIEL, "K32")).toBeNull();
  });

  it("an end that is not a water hex, or is off the map, gives no route", () => {
    expect(seaRoute(CTX, "M34", MALTA)).toBeNull(); // plain land
    expect(seaRoute(CTX, MALTA, "M34")).toBeNull();
    expect(seaRoute(CTX, "ZZ99", MALTA)).toBeNull();
    expect(seaDistance(CTX, MALTA, "")).toBeNull();
    expect(seaRoute(CTX, "M34", "M34")).toBeNull();
  });
});
