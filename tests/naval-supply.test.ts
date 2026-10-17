import { describe, expect, it, vi } from "vitest";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { markUsed, navalOf, type SeaSupplyDesignation } from "../src/engine/naval-record";
import { FED_TYPES } from "../src/engine/naval-supply";
import { portSupplied, seaSupplyLine, seaSupplyOptions, seaSupplyProblem } from "../src/engine/naval-supply-options";
import type * as Rules from "../src/engine/naval-rules";
import { SEA_SUPPLY_UNITS_PER_FACTOR } from "../src/engine/naval-rules";
import { SUPPLY_CHECKED_TYPES, supplyNetwork, supplyStatus, unsuppliedUnits } from "../src/engine/supply";
import type { GameState, Unit } from "../src/engine/types";
import { replay } from "../src/engine/actions";
import { autoSetup } from "../src/engine/autosetup";
import type { GameContext } from "../src/engine/context";
import { newGame } from "../src/engine/game";
import { beginPlay } from "../src/engine/turn";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import type { Scenario } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

// Spec 12 ticket 12-2 (R6, R7, C4; Ref 19.31, 19.2, 19.3, 26.0, 27.0): the rules of sea supply as pure queries over a designation recorded in
// GameState.naval. Named hexes: U22 Genoa, W22 Livorno, AA19 Cagliari (Sardinia), K28 Wilhelmshaven, C33 Bergen (port), C34 and C35 Oslo (Norway),
// D33 next to Bergen, LL29 Alexandria, X20 Ajaccio, GG19 Malta, K21 Plymouth.
const inf = (id: string, owner: Unit["owner"], at: string): Unit => counter(id, owner, "infantry", 2, at, 3);
const fleet = (id: string, owner: Unit["owner"], at: string, strength = 9): Unit => counter(id, owner, "fleet", strength, at);
const named = (fleets: string[], from: string, to: string, units: string[]): SeaSupplyDesignation => ({ fleets, from, to, units });

/** A 1939 position (the Axis to move) with these counters, Italy at war on the Axis side, Germany holding Norway's Bergen and Oslo, and these designations recorded. */
function position(units: Unit[], designations: SeaSupplyDesignation[] = [], extra: Partial<GameState> = {}): GameState {
  const base = board([]);
  const s = board(units, undefined, {
    nations: { ...base.nations, italy: { ...base.nations.italy, status: "axis" } },
    control: { C33: "germany", C34: "germany", C35: "germany", D33: "germany", ...(extra.control ?? {}) },
    ...extra,
  });
  return designations.length === 0 ? s : { ...s, naval: { ...navalOf(s), supply: designations } };
}
const norway = (ids: string[]): Unit[] => ids.map((id, i) => inf(id, "germany", ["C35", "C34", "C33", "D33", "C35", "C34", "C33", "D33", "C35", "C34"][i]!));
const unsupplied = (s: GameState): string[] => unsuppliedUnits(CTX, s, "axis");
const problem = (s: GameState, d: SeaSupplyDesignation) => seaSupplyProblem(CTX, s, "axis", d);

describe("the Sardinia pocket: a fleet at Genoa saves the infantry at Cagliari (Ref 19.31)", () => {
  const units = [inf("i1", "italy", "AA19"), fleet("f1", "italy", "U22")];
  const d = named(["f1"], "U22", "AA19", ["i1"]);

  it("cut off without a designation, supplied by sea with one, along a path that ends at the receiving place", () => {
    expect(unsupplied(position(units))).toEqual(["i1"]);
    const s = position(units, [d]);
    expect(problem(position(units), d)).toBeNull();
    expect(unsupplied(s)).toEqual([]);
    const line = supplyStatus(CTX, s, "axis").supplied.find((l) => l.unitId === "i1")!;
    expect(line).toEqual({ unitId: "i1", source: "AA19", path: ["AA19"], via: "sea", sea: { fleets: ["f1"], from: "U22", to: "AA19" } });
  });

  it("only the units named are fed: a unit of the same side in the same pocket that is not named stays cut off", () => {
    const s = position([...units, inf("i2", "italy", "Z19")], [d]);
    expect(unsupplied(s)).toEqual(["i2"]);
  });

  it("seaSupplyLine says the same as the status, and null for a unit no designation names", () => {
    const s = position([...units, inf("i2", "italy", "Z19")], [d]);
    expect(seaSupplyLine(CTX, s, "axis", s.units.i1!)).toEqual(supplyStatus(CTX, s, "axis").supplied.find((l) => l.unitId === "i1"));
    expect(seaSupplyLine(CTX, s, "axis", s.units.i2!)).toBeNull();
    expect(seaSupplyLine(CTX, position(units), "axis", units[0]!)).toBeNull();
  });

  it("an invalid designation gives no sea line", () => {
    const s = position(units, [named(["f1"], "U22", "AA19", ["i1", "i9"])]);
    expect(seaSupplyLine(CTX, s, "axis", units[0]!)).toBeNull();
  });

  it("the land search from a receiving place is made once per place (the network keeps it)", () => {
    const net = supplyNetwork(CTX, position(units), "axis");
    expect(net.reachFrom(["AA19"])).toBe(net.reachFrom(["AA19"]));
    expect([...net.reachFrom(["AA19"]).keys()]).toEqual(["AA19"]);
  });

  it("the other side's supply is not changed by it", () => {
    const s = position([...units, inf("b1", "britain", "K21")], [d]);
    expect(supplyStatus(CTX, s, "allies")).toEqual(supplyStatus(CTX, position([...units, inf("b1", "britain", "K21")]), "allies"));
  });
});

describe("with no designation every answer is what it was", () => {
  it("a state with no record, an empty record and a record of other things give the same status as ever", () => {
    const s = position([inf("i1", "italy", "AA19"), fleet("f1", "italy", "U22"), ...norway(["g1", "g2"])]);
    const base = supplyStatus(CTX, s, "axis");
    const empty = { ...s, naval: navalOf(s) };
    const used = markUsed(s, ["f1"], "intercept");
    for (const t of [empty, used]) expect(supplyStatus(CTX, t, "axis")).toEqual(base);
    expect(supplyNetwork(CTX, s, "axis").reaches.some((r) => r.kind === "sea")).toBe(false);
    expect(FED_TYPES).toEqual(SUPPLY_CHECKED_TYPES);
  });

  it("an invalid designation in the record feeds nobody", () => {
    const s = position([inf("i1", "italy", "AA19"), fleet("f1", "italy", "U22")], [named(["f1"], "U22", "AA19", ["i1", "i9"])]);
    expect(unsupplied(s)).toEqual(["i1"]);
    expect(supplyNetwork(CTX, s, "axis").reaches.some((r) => r.kind === "sea")).toBe(false);
  });
});

describe("the Norway pocket: capacity is one counter per naval factor (Ref 19.31)", () => {
  const ten = [...norway(["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9", "g10"])];
  const fleets = [fleet("f1", "germany", "K28"), fleet("f2", "germany", "K28", 6)];
  const ids = (n: number) => ten.slice(0, n).map((u) => u.id);

  it("one counter per naval factor, whatever the printed factors: 9 are fed by a 9-factor fleet, the tenth is refused", () => {
    expect(SEA_SUPPLY_UNITS_PER_FACTOR).toBe(1);
    const s = position([...ten, ...fleets]);
    expect(unsupplied(s).length).toBe(10);
    expect(problem(s, named(["f1"], "K28", "C33", ids(9)))).toBeNull();
    expect(problem(s, named(["f1"], "K28", "C33", ids(10)))).toMatch(/carries only 9 more units.*10 are named/);
    expect(problem(s, named(["f2"], "K28", "C33", ids(6)))).toBeNull();
    expect(problem(s, named(["f2"], "K28", "C33", ids(7)))).toMatch(/only 6 more/);
  });

  it("two fleets of one port together carry 15 and fill one after the other", () => {
    const s = position([...ten, ...fleets]);
    expect(problem(s, named(["f1", "f2"], "K28", "C33", ids(10)))).toBeNull();
    const done = position([...ten, ...fleets], [named(["f1", "f2"], "K28", "C33", ids(10))]);
    expect(unsupplied(done)).toEqual([]);
  });

  it("capacity is counted over every designation of the Player Turn: 5 and then 4 fit, a fifth more does not (N8, N9)", () => {
    const first = named(["f1"], "K28", "C33", ids(5));
    const s = position([...ten, ...fleets], [first]);
    expect(problem(s, named(["f1"], "K28", "C33", ten.slice(5, 9).map((u) => u.id)))).toBeNull();
    expect(problem(s, named(["f1"], "K28", "C33", ten.slice(5, 10).map((u) => u.id)))).toMatch(/only 4 more/);
    const two = position([...ten, ...fleets], [first, named(["f1"], "K28", "C33", ten.slice(5, 9).map((u) => u.id))]);
    expect(unsupplied(two)).toEqual(["g10"]);
  });

  it("a second designation that overruns the fleet is left out, and the first still stands", () => {
    const s = position([...ten, ...fleets], [named(["f2"], "K28", "C33", ids(5)), named(["f2"], "K28", "C33", ten.slice(5, 9).map((u) => u.id))]);
    expect(unsupplied(s)).toEqual(["g6", "g7", "g8", "g9", "g10"]);
  });

  it("three designations on one fleet add up: 3 and 3 leave 3 of 9, so 4 more are refused and 3 are fine", () => {
    const s = position([...ten, ...fleets], [named(["f1"], "K28", "C33", ids(3)), named(["f1"], "K28", "C33", ten.slice(3, 6).map((u) => u.id))]);
    expect(problem(s, named(["f1"], "K28", "C33", ten.slice(6, 10).map((u) => u.id)))).toMatch(/only 3 more/);
    expect(problem(s, named(["f1"], "K28", "C33", ten.slice(6, 9).map((u) => u.id)))).toBeNull();
  });

  it("an invalid designation in the record does not count against the ones after it", () => {
    const bad = named(["f1"], "J30", "C33", ids(9)); // wrong port: the fleet is at Wilhelmshaven
    const s = position([...ten, ...fleets], [bad, named(["f1"], "K28", "C33", ids(9))]);
    expect(unsupplied(s)).toEqual(["g10"]);
  });

  it("in a shared fleet the units of the first designation use its fleets in the order listed", () => {
    // f1 (9) and f2 (6): 12 named through f1 then f2 leaves f2 with 3; a later 4 through f2 alone is refused, 3 is fine.
    const twelve = named(["f1", "f2"], "K28", "C33", [...ids(10), "x1", "x2"]);
    const s = position([...ten, inf("x1", "germany", "C34"), inf("x2", "germany", "C35"), inf("y1", "germany", "C33"), inf("y2", "germany", "C34"), inf("y3", "germany", "C35"), inf("y4", "germany", "D33"), ...fleets], [twelve]);
    expect(problem(s, named(["f2"], "K28", "C33", ["y1", "y2", "y3"]))).toBeNull();
    expect(problem(s, named(["f2"], "K28", "C33", ["y1", "y2", "y3", "y4"]))).toMatch(/only 3 more/);
    expect(problem(s, named(["f1"], "K28", "C33", ["y1"]))).toMatch(/only 0 more/);
  });
});

describe("what makes a designation invalid (R7), each with a sentence", () => {
  const units = [...norway(["g1", "g2"]), fleet("f1", "germany", "K28"), fleet("f2", "germany", "K28")];
  const ok = named(["f1"], "K28", "C33", ["g1", "g2"]);

  it("the plain case is valid", () => expect(problem(position(units), ok)).toBeNull());

  it("the destination: a port or a one-hex island, held by the side", () => {
    expect(problem(position(units), { ...ok, to: "C34" })).toMatch(/not a port or a one-hex island/);
    expect(problem(position(units), { ...ok, to: "L25" })).toMatch(/not held by the axis side/); // Antwerp, Belgian in 1939
    const enemy = position(units, [], { control: { C33: "britain" } });
    expect(problem(enemy, ok)).toMatch(/Bergen \(C33\) is not held by the axis side/);
  });

  it("the Front: a fleet of the Mediterranean cannot serve a port of the Western Front", () => {
    const s = position([...units, fleet("f3", "italy", "U22")]);
    expect(problem(s, named(["f3"], "U22", "C33", ["g1"]))).toMatch(/Mediterranean|mediterranean/);
    expect(problem(s, named(["f3"], "U22", "C33", ["g1"]))).toMatch(/one Front/);
    expect(problem(position([...units, fleet("f4", "germany", "J30")]), named(["f4"], "J30", "C33", ["g1"]))).toBeNull(); // Kiel serves the western Front too
  });

  it("the fleet's port must have a land line to a supply source", () => {
    const s = position([...units, fleet("f3", "germany", "C33")]); // the fleet sits in the cut-off port itself
    expect(problem(s, named(["f3"], "C33", "C33", ["g1"]))).toMatch(/no land supply line to a supply source/);
    expect(portSupplied(CTX, s, "axis", "C33")).toBe(false);
    expect(portSupplied(CTX, s, "axis", "K28")).toBe(true);
  });

  it("a fleet that is not in a port (in the U.S. Box) cannot carry", () => {
    expect(problem(position([...units, fleet("f9", "germany", "us-box")]), named(["f9"], "us-box", "C33", ["g1"]))).toMatch(/not a port/);
  });

  it("a fleet that did something else this Game Turn, or was built in it, cannot carry; one that carried before can again", () => {
    expect(problem(markUsed(position(units), ["f1"], "intercept"), ok)).toMatch(/already been used this Game Turn \(intercept\)/);
    expect(problem(markUsed(position(units), ["f1"], "mission"), ok)).toMatch(/\(mission\)/);
    expect(problem(markUsed(position(units), ["f1"], "new"), ok)).toMatch(/built this Game Turn/);
    expect(problem(markUsed(position(units), ["f1"], "supply"), ok)).toBeNull();
  });

  it("the fleet must be a fleet of the side, at the port named", () => {
    expect(problem(position(units), { ...ok, fleets: ["g1"] })).toMatch(/not a fleet on the map/);
    expect(problem(position(units), { ...ok, fleets: ["nobody"] })).toMatch(/not a fleet on the map/);
    expect(problem(position(units), { ...ok, from: "J30" })).toMatch(/not at Kiel/);
    expect(problem(position([...units, fleet("b1", "britain", "K21")]), named(["b1"], "K21", "C33", ["g1"]))).toMatch(/not a fleet of the axis side/);
    expect(problem(position(units), { ...ok, from: "K29" })).toMatch(/not at Bremen/);
  });

  it("the units must be ground units or airbases of the side, with a land line to the receiving place", () => {
    const s = position([...units, counter("a1", "germany", "air", 3, "C34", 4), inf("e1", "britain", "D32"), inf("far", "germany", "L31")]);
    expect(problem(s, { ...ok, units: ["a1"] })).toMatch(/not a ground unit or airbase/);
    expect(problem(s, { ...ok, units: ["e1"] })).toMatch(/not a unit of the axis side/);
    expect(problem(s, { ...ok, units: ["far"] })).toMatch(/no land line to Bergen/);
    expect(problem(position([...units, counter("ab", "germany", "airbase", 1, "C34")]), { ...ok, units: ["ab"] })).toBeNull(); // an airbase is fed like a ground unit
    expect(problem(s, { ...ok, units: ["g1", "g1"] })).toMatch(/one or more distinct/);
    expect(problem(s, { ...ok, units: ["gone"] })).toMatch(/not a ground unit or airbase/);
  });

  it("a unit already named in another designation is refused in the second", () => {
    const s = position(units, [named(["f1"], "K28", "C33", ["g1"])]);
    expect(problem(s, named(["f2"], "K28", "C33", ["g1"]))).toMatch(/already named in another sea supply/);
    expect(problem(s, named(["f2"], "K28", "C33", ["g2"]))).toBeNull();
  });

  it("malformed designations are refused with a sentence, never thrown", () => {
    const s = position(units);
    for (const bad of [null, undefined, {}, { ...ok, fleets: [] }, { ...ok, fleets: "f1" }, { ...ok, units: [] }, { ...ok, units: [1] }, { ...ok, fleets: ["f1", "f1"] }, { ...ok, from: 5 }, { ...ok, to: undefined }, { ...ok, fleets: Array.from({ length: 201 }, (_, i) => `f${i}`) }]) {
      expect(problem(s, bad as SeaSupplyDesignation), JSON.stringify(bad)).toMatch(/A sea supply names one or more distinct fleets/);
    }
    // eslint-disable-next-line no-sparse-arrays
    expect(problem(s, { ...ok, fleets: [, "f1"] as unknown as string[] })).toMatch(/A sea supply names/);
  });
});

describe("zones of control (Ref 19.3, 19.31)", () => {
  const units = [...norway(["g1", "g2", "g3"]), fleet("f1", "germany", "K28")];
  const armor = counter("e1", "britain", "armor", 4, "D33", 6);

  it("enemy armor on the way cuts the land leg: units behind its zone are refused", () => {
    const s = position([...units, armor]);
    expect(problem(s, named(["f1"], "K28", "C33", ["g1"]))).toMatch(/no land line to Bergen/); // g1 at C35, behind C34
    expect(problem(s, named(["f1"], "K28", "C33", ["g2"]))).toMatch(/no land line to Bergen/); // g2 at C34, in the zone of the same armor as the port
  });

  it("the receiving place itself may stand in a zone: a unit in it is fed", () => {
    const s = position([...units, armor]);
    expect(problem(s, named(["f1"], "K28", "C33", ["g3"]))).toBeNull(); // g3 at C33 (Bergen)
    const done = position([...units, armor], [named(["f1"], "K28", "C33", ["g3"])]);
    expect(unsupplied(done)).toEqual(["g1", "g2"]);
  });

  it("enemy armor does not cut the sea: a zone does not reach over water", () => {
    // British armor at Calais-side water is not on the route; the check is only on the land legs, so a zone at the origin port's coast changes nothing.
    const s = position([...units, counter("e2", "britain", "armor", 4, "L24", 6)]);
    expect(problem(s, named(["f1"], "K28", "C33", ["g1"]))).toBeNull();
  });
});

describe("groups (Ref 26.0, 27.0)", () => {
  const french = (id: string, at: string): Unit => inf(id, "france", at);

  it("a British fleet carries for French units, and the reverse", () => {
    const s = position([fleet("b1", "britain", "LL29"), french("fr1", "X20"), fleet("fr2", "france", "LL29"), inf("bi1", "britain", "X20")], [], {});
    expect(seaSupplyProblem(CTX, s, "allies", named(["b1"], "LL29", "X20", ["fr1"]))).toBeNull();
    expect(seaSupplyProblem(CTX, s, "allies", named(["fr2"], "LL29", "X20", ["bi1"]))).toBeNull();
  });

  it("the Soviets and the Western Allies do not carry for each other, and an Italian fleet at Genoa is refused for a German unit in Norway by the Front, not by the group", () => {
    const base = board([]);
    const ussr = { ...base.nations.ussr, status: "allied" as const };
    const s = position([fleet("b1", "britain", "LL29"), french("fr1", "X20"), inf("ru1", "ussr", "X20"), fleet("ru2", "ussr", "LL29")], [], { nations: { ...base.nations, italy: { ...base.nations.italy, status: "axis" }, ussr } });
    expect(seaSupplyProblem(CTX, s, "allies", named(["b1"], "LL29", "X20", ["ru1"]))).toMatch(/another group than the fleet/);
    expect(seaSupplyProblem(CTX, s, "allies", named(["ru2"], "LL29", "X20", ["fr1"]))).toMatch(/another group than the fleet/);
    expect(seaSupplyProblem(CTX, s, "allies", named(["b1", "ru2"], "LL29", "X20", ["fr1"]))).toMatch(/same group/);
    const axis = position([fleet("it1", "italy", "U22"), ...norway(["g1"])]);
    expect(problem(axis, named(["it1"], "U22", "C33", ["g1"]))).toMatch(/Front/); // different Front, but the same group: it is the Front that refuses
  });
});

describe("islands and Fortresses as receiving places", () => {
  it("Malta, a port and a one-hex island, receives supply from a fleet at Alexandria", () => {
    const s = position([fleet("b1", "britain", "LL29"), inf("bi1", "britain", "GG19")]);
    expect(seaSupplyProblem(CTX, s, "allies", named(["b1"], "LL29", "GG19", ["bi1"]))).toBeNull();
    expect(portSupplied(CTX, s, "allies", "LL29", "britain")).toBe(true);
  });

  it("a one-hex island that is no port is a receiving place on the Front of its hex (the list is Malta and Scapa Flow, both ports: tested with Rhodes listed)", async () => {
    const s = position([fleet("it1", "italy", "AA24"), inf("i1", "italy", "FF30")]);
    const d = named(["it1"], "AA24", "FF30", ["i1"]);
    expect(problem(s, d)).toMatch(/not a port or a one-hex island/);
    vi.resetModules();
    vi.doMock("../src/engine/naval-rules", async (original) => ({ ...(await original<typeof Rules>()), ONE_HEX_ISLANDS: ["B29", "GG19", "FF30"] }));
    try {
      const mocked = await import("../src/engine/naval-supply-options");
      expect(mocked.seaSupplyProblem(CTX, s, "axis", d)).toBeNull();
      expect(mocked.seaSupplyOptions(CTX, s, "axis")).toEqual([{ ...d, saves: 1 }]);
      expect(mocked.seaSupplyProblem(CTX, position([fleet("it1", "germany", "K28"), inf("i1", "italy", "FF30")]), "axis", named(["it1"], "K28", "FF30", ["i1"]))).toMatch(/Front/); // western to the Mediterranean
    } finally {
      vi.doUnmock("../src/engine/naval-rules");
      vi.resetModules();
    }
  });

  it("a port net serves only the owner it serves: Tunis supplies French fleets, not British ones", () => {
    const s = position([fleet("fr1", "france", "DD17"), fleet("b1", "britain", "DD17")], [], { control: { DD17: "france" } });
    expect(portSupplied(CTX, s, "allies", "DD17", "france")).toBe(true);
    expect(portSupplied(CTX, s, "allies", "DD17", "britain")).toBe(false);
    expect(portSupplied(CTX, s, "allies", "DD17")).toBe(true);
  });
});

describe("seaSupplyOptions: the designations worth proposing (spec 12 C2, B7)", () => {
  it("the Sardinia pocket has one proposal per origin port, each valid, best first, then by port", () => {
    const s = position([inf("i1", "italy", "AA19"), fleet("f1", "italy", "U22"), fleet("f2", "italy", "U22"), fleet("f3", "italy", "W22")]);
    const options = seaSupplyOptions(CTX, s, "axis");
    expect(options).toEqual([
      { fleets: ["f1"], from: "U22", to: "AA19", units: ["i1"], saves: 1 },
      { fleets: ["f3"], from: "W22", to: "AA19", units: ["i1"], saves: 1 },
    ]);
    for (const o of options) expect(problem(s, o)).toBeNull();
  });

  it("the fewest fleets that cover the units, the units as many as they carry, the biggest saving first", () => {
    const ten = norway(["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9", "g10"]);
    const s = position([...ten, fleet("f1", "germany", "K28", 6), fleet("f2", "germany", "K28", 6), fleet("f3", "germany", "K28", 6), fleet("f4", "germany", "K29", 9)]);
    const options = seaSupplyOptions(CTX, s, "axis");
    expect(options.map((o) => [o.from, o.to, o.fleets, o.saves])).toEqual([
      ["K29", "C33", ["f4"], 9],
      ["K28", "C33", ["f1", "f2"], 10],
    ].sort((a, b) => (b[3] as number) - (a[3] as number)));
    expect(options[0]!.saves).toBe(10);
    for (const o of options) expect(problem(s, o)).toBeNull();
  });

  it("units already saved by a recorded designation are not offered again, and a spent fleet is not offered", () => {
    const s = position([...norway(["g1", "g2"]), fleet("f1", "germany", "K28", 1), fleet("f2", "germany", "K28", 1)], [named(["f1"], "K28", "C33", ["g1"])]);
    expect(seaSupplyOptions(CTX, s, "axis")).toEqual([{ fleets: ["f2"], from: "K28", to: "C33", units: ["g2"], saves: 1 }]);
    expect(seaSupplyOptions(CTX, markUsed(s, ["f2"], "intercept"), "axis")).toEqual([]);
  });

  it("nothing is offered when nobody is cut off, when no fleet can carry, or for the other side", () => {
    expect(seaSupplyOptions(CTX, position([inf("i1", "italy", "U22"), fleet("f1", "italy", "U22")]), "axis")).toEqual([]);
    expect(seaSupplyOptions(CTX, position([inf("i1", "italy", "AA19")]), "axis")).toEqual([]);
    expect(seaSupplyOptions(CTX, position([inf("i1", "italy", "AA19"), fleet("f1", "italy", "U22")]), "allies")).toEqual([]);
    expect(seaSupplyOptions(CTX, position([inf("i1", "italy", "AA19"), fleet("f1", "italy", "U22")]), "axis").length).toBe(1);
  });

  it("a fleet whose own port is cut off proposes nothing, and a fleet on another Front proposes nothing", () => {
    expect(seaSupplyOptions(CTX, position([...norway(["g1"]), fleet("f1", "germany", "C33")]), "axis")).toEqual([]);
    expect(seaSupplyOptions(CTX, position([...norway(["g1"]), fleet("f1", "italy", "U22")]), "axis")).toEqual([]);
  });

  it("a recorded designation does not make its receiving place a supplied port for portSupplied", () => {
    const s = position([inf("i1", "italy", "AA19"), fleet("f1", "italy", "U22")], [named(["f1"], "U22", "AA19", ["i1"])]);
    expect(portSupplied(CTX, s, "axis", "AA19")).toBe(false);
    expect(portSupplied(CTX, s, "axis", "AA19", "italy")).toBe(false);
  });

  it("only the units of the fleet's group are proposed: a Soviet unit in the same pocket is left out", () => {
    const base = board([]);
    const s = position([fleet("b1", "britain", "LL29"), inf("fr1", "france", "X20"), inf("ru1", "ussr", "X20")], [], { nations: { ...base.nations, italy: { ...base.nations.italy, status: "axis" }, ussr: { ...base.nations.ussr, status: "allied" as const } } });
    expect(seaSupplyOptions(CTX, s, "allies")).toEqual([{ fleets: ["b1"], from: "LL29", to: "X20", units: ["fr1"], saves: 1 }]);
  });

  it("the fleets of a port are taken in id order, whatever order they were put on the map", () => {
    const s = position([...norway(["g1"]), fleet("f10", "germany", "K28"), fleet("f2", "germany", "K28"), fleet("f1", "germany", "K28")]);
    expect(seaSupplyOptions(CTX, s, "axis")).toEqual([{ fleets: ["f1"], from: "K28", to: "C33", units: ["g1"], saves: 1 }]);
    const two = position([...norway(["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9", "g10"]), fleet("f10", "germany", "K28", 6), fleet("f2", "germany", "K28", 6)]);
    expect(seaSupplyOptions(CTX, two, "axis")[0]!.fleets).toEqual(["f2", "f10"]);
  });

  it("a fleet used for something else is left out of the proposal and a sibling in the same port is used", () => {
    const s = markUsed(position([...norway(["g1"]), fleet("f1", "germany", "K28"), fleet("f2", "germany", "K28")]), ["f1"], "intercept");
    expect(seaSupplyOptions(CTX, s, "axis")).toEqual([{ fleets: ["f2"], from: "K28", to: "C33", units: ["g1"], saves: 1 }]);
  });

  it("every fleet of a proposal must have a supplied port for its own nation: at Tunis a French fleet is offered, a British one is not", () => {
    const s = position([fleet("b1", "britain", "DD17"), fleet("fr1", "france", "DD17"), inf("fi1", "france", "X20")], [], { control: { DD17: "france" } });
    expect(seaSupplyOptions(CTX, s, "allies")).toEqual([{ fleets: ["fr1"], from: "DD17", to: "X20", units: ["fi1"], saves: 1 }]);
    expect(seaSupplyProblem(CTX, s, "allies", named(["fr1", "b1"], "DD17", "X20", ["fi1"]))).toMatch(/no land supply line to a supply source/);
  });

  it("is deterministic, and does not change the state", () => {
    const s = position([inf("i1", "italy", "AA19"), fleet("f1", "italy", "U22"), fleet("f3", "italy", "W22")]);
    const before = JSON.stringify(s);
    expect(seaSupplyOptions(CTX, s, "axis")).toEqual(seaSupplyOptions(CTX, s, "axis"));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("the pockets the automatic setups leave (spec 12, 'What exists today')", () => {
  /** The game after the automatic setup of a scenario (seed 1), at the start of the first Player Turn. */
  const played = (scenario: Scenario): { ctx: GameContext; state: GameState } => {
    const ctx = ctxFor(scenario);
    const start = newGame(scenario, 1);
    return { ctx, state: beginPlay(ctx, replay(ctx, start, autoSetup(ctx, start)).state).state };
  };
  const cut = (c: { ctx: GameContext; state: GameState }, side: "axis" | "allies"): string[] => supplyStatus(c.ctx, c.state, side).unsupplied.map((id) => `${id}@${c.state.units[id]!.at}`);
  const withDesignation = (state: GameState, o: SeaSupplyDesignation): GameState => ({ ...state, naval: { ...navalOf(state), supply: [{ fleets: o.fleets, from: o.from, to: o.to, units: o.units }] } });

  it("1942: Italian infantry at Cagliari (a fleet at Genoa or in Libya) and German infantry at Oslo (a fleet at Antwerp) are each saved by one fleet", () => {
    const c = played(SCENARIO_1942);
    expect(cut(c, "axis").map((x) => x.split("@")[1])).toEqual(["AA19", "AA19", "C35", "C35"]);
    const options = seaSupplyOptions(c.ctx, c.state, "axis");
    expect(options.map((o) => [o.from, o.to, o.saves])).toEqual([["II17", "AA19", 2], ["L25", "C33", 2], ["U22", "AA19", 2]]);
    for (const o of options) {
      expect(seaSupplyProblem(c.ctx, c.state, "axis", o)).toBeNull();
      expect(unsuppliedUnits(c.ctx, withDesignation(c.state, o), "axis").length).toBe(4 - o.saves);
    }
    const both = { ...c.state, naval: { ...navalOf(c.state), supply: [options[1]!, options[0]!].map((o) => ({ fleets: o.fleets, from: o.from, to: o.to, units: o.units })) } };
    expect(unsuppliedUnits(c.ctx, both, "axis")).toEqual([]);
  });

  it("1944: German units at Oslo (Antwerp) and British armor at Cagliari (Tripoli, Alexandria or Suez); 1939 and the Campaign: Finland's armor, which no fleet can reach", () => {
    const c = played(SCENARIO_1944);
    expect(seaSupplyOptions(c.ctx, c.state, "axis").map((o) => [o.from, o.to, o.saves])).toEqual([["L25", "C33", 3]]);
    expect(seaSupplyOptions(c.ctx, c.state, "allies").map((o) => [o.from, o.to, o.saves])).toEqual([["II17", "AA19", 2], ["LL29", "AA19", 2], ["MM30", "AA19", 2]]);
    for (const side of ["axis", "allies"] as const) for (const o of seaSupplyOptions(c.ctx, c.state, side)) expect(unsuppliedUnits(c.ctx, withDesignation(c.state, o), side).length).toBe(0);
    for (const scenario of [SCENARIO_1939, SCENARIO_CAMPAIGN]) {
      const k = played(scenario);
      expect(cut(k, "axis")).toEqual(["u93@D41"]);
      expect(seaSupplyOptions(k.ctx, k.state, "axis")).toEqual([]);
    }
  });
});
