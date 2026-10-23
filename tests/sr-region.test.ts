import { describe, expect, it } from "vitest";
import { controllingSide } from "../src/engine/control";
import { hexsideId, parseHexId } from "../src/engine/hex";
import { srDestinations, srHexProblem, srProblem, srRegion, srUnitProblem, srView } from "../src/engine/sr-region";
import type { GameState, Unit } from "../src/engine/types";
import { adjacentHexes } from "../src/engine/zoc";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 16 R19, R20 (Ref 11.72, 4.5, 19.4, 22.0): the 1939 map. Berlin L31, Munich Q27, Konigsberg J36 (East Prussia, cut from Germany by
// Polish land in 1939), Danzig J35 (Polish, across water from Konigsberg), Messina DD21 and DD22 (a Crossing Arrow), Rome Y22.
const SUPPLY_ON = { ...CTX, supplyEffects: true };
const inf = (id: string, owner: Unit["owner"], at: string): Unit => counter(id, owner, "infantry", 2, at, 3);
const axis = (units: Unit[], tweak: Partial<GameState> = {}): GameState => board(units, undefined, { activeSide: "axis", ...tweak });
/** The 1939 board with Italy at war on the Axis side (it is neutral at the start). */
const withItaly = (units: Unit[], tweak: Partial<GameState> = {}): GameState => {
  const s = board([]);
  return axis(units, { nations: { ...s.nations, italy: { ...s.nations.italy, status: "axis" } }, ...tweak });
};
const landNext = (a: string, b: string): boolean => CTX.map.hexsides[hexsideId(parseHexId(a)!, parseHexId(b)!)]?.land === true;

describe("who may be redeployed (spec 16 R19)", () => {
  it("a ground unit and a Replacement of the side to move, on the map, may be; Replacements move only this way (Ref 22.0)", () => {
    const s = axis([inf("g1", "germany", "L31"), counter("r1", "germany", "replacement", 1, "Q27")]);
    expect(srUnitProblem(CTX, s, s.units.g1!)).toBeNull();
    expect(srUnitProblem(CTX, s, s.units.r1!)).toBeNull();
    expect(srDestinations(CTX, s, s.units.r1!)).toContain("L31");
  });

  it("air units, airbases and fleets are not redeployed in Beta (R23)", () => {
    const s = axis([counter("a1", "germany", "air", 4, "L31", 4), counter("b1", "germany", "airbase", 0, "Q27"), counter("f1", "germany", "fleet", 9, "J30")]);
    for (const id of ["a1", "b1", "f1"]) expect(srUnitProblem(CTX, s, s.units[id]!)).toMatch(/not a ground unit or a Replacement/);
  });

  it("the other side's units, units off the map and Polish units are refused (AER26)", () => {
    const s = axis([inf("p1", "poland", "M35"), { ...inf("g1", "germany", "L31"), at: "us-box" }]);
    expect(srUnitProblem(CTX, s, s.units.p1!)).toMatch(/does not redeploy for the axis side/);
    expect(srUnitProblem(CTX, s, s.units.g1!)).toMatch(/not on the map/);
    const allies = { ...s, activeSide: "allies" as const };
    expect(srUnitProblem(CTX, allies, allies.units.p1!)).toMatch(/cannot be redeployed in this version/);
  });

  it("a unit already redeployed this Player Turn may not be again (AER28)", () => {
    const s = axis([inf("g1", "germany", "L31")]);
    expect(srUnitProblem(CTX, s, s.units.g1!, ["g1"])).toMatch(/already been redeployed/);
    expect(srProblem(CTX, s, ["g1"], "Q27", { redeployed: ["g1"] })).toMatch(/already been redeployed/);
  });

  it("a unit that moved this Player Turn may still be redeployed (AER22)", () => {
    const s = axis([inf("g1", "germany", "L31")]);
    const moved: GameState = { ...s, moves: { turn: `${s.year}-${s.season}-axis`, moved: ["g1"] } };
    expect(srUnitProblem(CTX, moved, moved.units.g1!)).toBeNull();
    expect(srProblem(CTX, moved, ["g1"], "Q27")).toBeNull();
  });

  it("a unit next to an enemy ground unit across a land hexside cannot move (R20, AER23)", () => {
    const s = axis([inf("g1", "germany", "L33"), inf("p1", "poland", "M33")]);
    expect(landNext("L33", "M33")).toBe(true);
    expect(srUnitProblem(CTX, s, s.units.g1!)).toMatch(/next to an enemy unit/);
    expect(srRegion(CTX, s, s.units.g1!).size).toBe(0);
    expect(srDestinations(CTX, s, s.units.g1!)).toEqual([]);
  });

  it("an enemy across open water is not next to it: Konigsberg and Danzig (R20)", () => {
    const s = axis([inf("g1", "germany", "J36"), inf("p1", "poland", "J35")]);
    expect(landNext("J36", "J35")).toBe(false);
    expect(srUnitProblem(CTX, s, s.units.g1!)).toBeNull();
  });

  it("the region does not step between two land hexes across plain water with no Crossing Arrow: England L23 and France L24 (R20, Ref 4.3)", () => {
    // Konigsberg and Danzig are joined by land round the lagoon, so the pair here is two hexes that are not: Dover's side of the Channel.
    const s = board([inf("b1", "britain", "L23")], undefined, { activeSide: "allies" });
    expect(adjacentHexes(CTX, "L23")).toContain("L24");
    expect(landNext("L23", "L24")).toBe(false);
    expect(CTX.map.hexsides[hexsideId(parseHexId("L23")!, parseHexId("L24")!)]?.crossingArrow).not.toBe(true);
    expect(controllingSide(CTX, s, "L24")).toBe("allies");
    expect(srRegion(CTX, s, s.units.b1!).has("L23")).toBe(true);
    expect(srRegion(CTX, s, s.units.b1!).has("L24")).toBe(false);
    expect(srProblem(CTX, s, ["b1"], "L24")).toMatch(/cannot be reached/);
    expect(srDestinations(CTX, s, s.units.b1!)).not.toContain("L24");
  });

  it("an enemy across a Crossing Arrow is not next to it either (R20): Messina", () => {
    const s = withItaly([inf("i1", "italy", "DD21"), inf("b1", "britain", "DD22")]);
    expect(CTX.map.hexsides[hexsideId(parseHexId("DD21")!, parseHexId("DD22")!)]?.crossingArrow).toBe(true);
    expect(srUnitProblem(CTX, s, s.units.i1!)).toBeNull();
  });

  it("an enemy air unit or fleet is not an enemy ground unit: it blocks only its own hex (AER23)", () => {
    const s = axis([inf("g1", "germany", "L33"), counter("pa", "poland", "air", 1, "M33", 4)]);
    expect(srUnitProblem(CTX, s, s.units.g1!)).toBeNull();
    expect(srRegion(CTX, s, s.units.g1!).has("M33")).toBe(false);
  });

  it("a future enemy not yet at war is not an enemy (AER44): a Soviet unit next to German land in 1939", () => {
    const s = axis([inf("g1", "germany", "L33"), inf("r1", "ussr", "M33")]);
    expect(s.nations.ussr.status).toBe("neutral");
    expect(srUnitProblem(CTX, s, s.units.g1!)).toBeNull();
  });
});

describe("the region and the destination (spec 16 R20)", () => {
  it("any distance over the side's own land: Berlin reaches Munich and the Rhine, not Poland or the sea", () => {
    const s = axis([inf("g1", "germany", "L31")]);
    const region = srRegion(CTX, s, s.units.g1!);
    expect(region.has("Q27")).toBe(true);
    expect(region.has("M27")).toBe(true);
    expect(region.has("M34")).toBe(false); // Polish land
    for (const h of region) expect(controllingSide(CTX, s, h)).toBe("axis");
    expect(srProblem(CTX, s, ["g1"], "M27")).toBeNull();
    expect(srProblem(CTX, s, ["g1"], "M34")).toMatch(/not controlled by the axis side/);
  });

  it("the region is connected: Berlin cannot reach East Prussia over Polish land, nor East Prussia Berlin", () => {
    const s = axis([inf("g1", "germany", "L31"), inf("g2", "germany", "J36")]);
    expect(srRegion(CTX, s, s.units.g1!).has("J36")).toBe(false);
    expect(srRegion(CTX, s, s.units.g2!)).toEqual(new Set(["J36", "J37", "K35", "K36"]));
    expect(srProblem(CTX, s, ["g1"], "K36")).toMatch(/cannot be reached from L31/);
  });

  it("an ally's hexes are passable: a German unit reaches Rome once Italy is at war", () => {
    expect(srRegion(CTX, axis([inf("g1", "germany", "L31")]), inf("g1", "germany", "L31")).has("Y22")).toBe(false);
    const s = withItaly([inf("g1", "germany", "L31")]);
    expect(srRegion(CTX, s, s.units.g1!).has("Y22")).toBe(true);
    expect(srProblem(CTX, s, ["g1"], "Y22")).toBeNull();
  });

  it("a Crossing Arrow carries a redeployment: Sicily to the mainland at Messina", () => {
    const s = withItaly([inf("i1", "italy", "DD21")]);
    expect(srRegion(CTX, s, s.units.i1!).has("DD22")).toBe(true);
  });

  it("a destination on or next to an enemy unit is refused, and no hex of the region is (R20)", () => {
    const s = axis([inf("g1", "germany", "L31"), inf("p1", "poland", "M33")]);
    expect(srProblem(CTX, s, ["g1"], "L33")).toMatch(/on or next to an enemy unit/);
    const region = srRegion(CTX, s, s.units.g1!);
    expect(region.has("L33")).toBe(false);
    expect(region.has("M32")).toBe(false);
    for (const h of region) for (const n of adjacentHexes(CTX, h)) if (landNext(h, n)) expect(n).not.toBe("M33");
  });

  it("a destination over open water is refused (R20, Sea Escort is R22)", () => {
    const s = axis([inf("g1", "germany", "L31")]);
    expect(srProblem(CTX, s, ["g1"], "J36")).toMatch(/cannot be reached/);
    const sea = adjacentHexes(CTX, "J30").find((h) => !CTX.map.hexes[h]?.land)!; // the Baltic off Kiel
    expect(srHexProblem(CTX, s, srView(CTX, s), s.units.g1!, sea)).toMatch(/not a land hex/);
    expect(srProblem(CTX, s, ["g1"], sea)).toMatch(/not a land hex/);
  });

  it("a redeployment may not end overstacked (AER27), and its own hex is not a destination", () => {
    const s = axis([inf("g1", "germany", "L31"), inf("g2", "germany", "Q27"), inf("g3", "germany", "Q27")]);
    expect(srProblem(CTX, s, ["g1"], "Q27")).toMatch(/already holds 2 ground units/);
    expect(srDestinations(CTX, s, s.units.g1!)).not.toContain("Q27");
    expect(srProblem(CTX, s, ["g1"], "L31")).toMatch(/already in L31/);
    expect(srProblem(CTX, s, ["g2", "g3"], "L31")).toMatch(/already holds 2 ground units/); // L31 already has g1
    expect(srProblem(CTX, s, ["g2", "g3"], "M27")).toBeNull();
  });

  it("the Anglo-French stop ban applies to a redeployment's end, through endProblem (R32, AER42)", () => {
    const s = board([inf("b1", "britain", "O23"), inf("f1", "france", "N22")], undefined, { activeSide: "allies" });
    expect(controllingSide(CTX, s, "O23")).toBe("allies");
    expect(srProblem(CTX, s, ["b1"], "O22")).toMatch(/British units may not stop in Paris/);
    expect(srDestinations(CTX, s, s.units.b1!)).not.toContain("O22");
    expect(srProblem(CTX, s, ["f1"], "O22")).toBeNull();
  });

  it("the allowance is checked: Germany's tenth redeployment is refused, Italy's use does not count (R18)", () => {
    const s = axis([inf("g1", "germany", "L31")]);
    expect(srProblem(CTX, s, ["g1"], "Q27", { used: { germany: 9 } })).toMatch(/germany has 0 of 9/);
    expect(srDestinations(CTX, s, s.units.g1!, { used: { germany: 9 } })).toEqual([]);
    expect(srProblem(CTX, s, ["g1"], "Q27", { used: { italy: 5, germany: 8 } })).toBeNull();
  });

  it("an Italian counter Germany holds is charged to Italy (AER26)", () => {
    const s = axis([{ ...inf("g1", "germany", "L31"), nationality: "italy" }]);
    expect(srProblem(CTX, s, ["g1"], "Q27", { used: { italy: 5 } })).toMatch(/italy has 0 of 5/);
    expect(srProblem(CTX, s, ["g1"], "Q27", { used: { germany: 9 } })).toBeNull();
  });

  it("refuses an empty list, a repeated unit and a missing unit", () => {
    const s = axis([inf("g1", "germany", "L31")]);
    expect(srProblem(CTX, s, [], "Q27")).toMatch(/at least one/);
    expect(srProblem(CTX, s, ["g1", "g1"], "Q27")).toMatch(/twice/);
    expect(srProblem(CTX, s, ["zz"], "Q27")).toMatch(/no unit zz/);
  });

  it("units from different hexes may go to one hex in one redeployment", () => {
    const s = axis([inf("g1", "germany", "L31"), inf("g2", "germany", "Q27")]);
    expect(srProblem(CTX, s, ["g1", "g2"], "M27")).toBeNull();
  });

  it("a view is reused: two units of one region share one search", () => {
    const s = axis([inf("g1", "germany", "L31"), inf("g2", "germany", "Q27")]);
    const view = srView(CTX, s);
    expect(srRegion(CTX, s, s.units.g1!, view)).toBe(srRegion(CTX, s, s.units.g2!, view));
  });
});

describe("supply and redeployment (spec 16 R19, R20; AER24, AER33)", () => {
  const island = { control: { N34: "germany" as const } }; // a German hex inside Poland: controlled, but no line reaches it

  it("with the supply effects on, a cut-off unit cannot be redeployed and a cut-off hex is not a destination", () => {
    const s = axis([inf("g1", "germany", "N34"), inf("g2", "germany", "L31")], island);
    expect(srUnitProblem(SUPPLY_ON, s, s.units.g1!)).toMatch(/cut off from supply/);
    expect(srHexProblem(SUPPLY_ON, s, srView(SUPPLY_ON, s), s.units.g2!, "N34")).toMatch(/cut off from supply/);
    expect(srProblem(SUPPLY_ON, s, ["g2"], "N34", {}, srView(SUPPLY_ON, s))).toMatch(/cut off from supply/);
    expect(srUnitProblem(SUPPLY_ON, s, s.units.g2!)).toBeNull();
  });

  it("with the supply effects off (the shipped setting) the supply test is skipped; control and adjacency still apply (AER33)", () => {
    const s = axis([inf("g1", "germany", "N34"), inf("g2", "germany", "L31")], island);
    expect(srUnitProblem(CTX, s, s.units.g1!)).toBeNull();
    expect(srHexProblem(CTX, s, srView(CTX, s), s.units.g2!, "N34")).toBeNull();
    expect(srRegion(CTX, s, s.units.g1!)).toEqual(new Set(["N34"]));
  });

  it("supply is read in the unit's own set: Konigsberg supplies German units in East Prussia, not Italian ones (AER24)", () => {
    const s = withItaly([inf("g1", "germany", "J37"), inf("i1", "italy", "K36")]);
    expect(srUnitProblem(SUPPLY_ON, s, s.units.g1!)).toBeNull();
    expect(srUnitProblem(SUPPLY_ON, s, s.units.i1!)).toMatch(/cut off from supply/);
    expect(srRegion(SUPPLY_ON, s, s.units.g1!).has("K35")).toBe(true);
  });
});

describe("property: no destination is next to an enemy ground unit or overstacked (spec 16 F3 property 1)", () => {
  it("holds on a crowded 1939 border", () => {
    const units = [
      inf("g1", "germany", "L31"), inf("g2", "germany", "L31"), inf("g3", "germany", "M32"), inf("g4", "germany", "O32"),
      inf("p1", "poland", "M33"), inf("p2", "poland", "N33"), inf("p3", "poland", "K34"), counter("p4", "poland", "armor", 2, "O33", 5),
      inf("f1", "france", "N25"),
    ];
    const s = axis(units);
    const enemies = units.filter((u) => u.owner !== "germany").map((u) => u.at);
    const view = srView(CTX, s);
    for (const u of units.filter((x) => x.owner === "germany")) {
      for (const to of srDestinations(CTX, s, u, {}, view)) {
        expect(enemies).not.toContain(to);
        for (const n of adjacentHexes(CTX, to)) if (landNext(to, n)) expect(enemies).not.toContain(n);
        expect(srProblem(CTX, s, [u.id], to, {}, view)).toBeNull();
      }
    }
  });
});
