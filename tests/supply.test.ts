import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { attackerPool } from "../src/engine/attack-rules";
import { controllingSide } from "../src/engine/control";
import { adjacentHexes, canCross } from "../src/engine/zoc";
import { isUnitSupplied, SUPPLY_POLICY, supplySources, supplyStatus, unsuppliedUnits, type SupplyPolicy } from "../src/engine/supply";
import type { GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

const pole = (id: string, at: string): Unit => counter(id, "poland", "infantry", 2, at, 3);
/** Armor: only armor puts enemy hexes in a ZOC (Ref 7.0); the others are plain ground units. */
const german = (id: string, at: string): Unit => counter(id, "germany", "armor", 3, at, 4);
const italian = (id: string, at: string): Unit => counter(id, "italy", "infantry", 2, at, 3);
const british = (id: string, at: string): Unit => counter(id, "britain", "armor", 3, at, 3);
/** The 1939 board with Italy at war on the Axis side (it is neutral at the start). */
const withItaly = (units: Unit[], extra: Partial<GameState> = {}): GameState => {
  const s = board([]);
  return board(units, undefined, { nations: { ...s.nations, italy: { ...s.nations.italy, status: "axis" } }, ...extra });
};
const lineOf = (s: GameState, side: "axis" | "allies", id: string) => supplyStatus(CTX, s, side).supplied.find((l) => l.unitId === id);

// Ref 19.2 (sources), 19.3 (tracing), 19.4 (consequences); spec 03. See the header of supply.ts for the rule text used.
describe("supply sources (Ref 19.2: capitals)", () => {
  it("1939: Berlin for the Axis; London, Paris and Warsaw for the Allies (Italy is neutral)", () => {
    const s = board([]);
    // Spec 15 R10 (MC10): the capitals of the four sleeping Axis allies (Helsinki, Budapest, Bucharest, Sofia) are Axis sources while they sleep.
    expect(supplySources(CTX, s, "axis")).toEqual(["D41", "L31", "S30", "W33", "Y30"]);
    expect(supplySources(CTX, s, "allies")).toEqual(["K23", "M35", "O22"]);
  });

  it("Rome joins them once Italy is at war", () => {
    expect(supplySources(CTX, withItaly([]), "axis")).toEqual(["D41", "L31", "S30", "W33", "Y22", "Y30"]);
  });

  it("a minor country that takes no side has no source; a captured Polish capital does not supply the Axis", () => {
    const s = board([], undefined, { control: { M35: "germany" } });
    expect(supplySources(CTX, s, "allies")).toEqual(["K23", "O22"]);
    expect(supplySources(CTX, s, "axis")).toEqual(["D41", "L31", "S30", "W33", "Y30"]); // Poland is not an Axis minor: TODO(verify) captured minor capitals
    expect(supplySources(CTX, board([]), "axis")).not.toContain("DD28"); // Athens, Greece neutral
  });

  it("a Major Power's captured capital supplies its captor (19.2: its controlling side)", () => {
    const s = board([], undefined, { control: { O22: "germany" } });
    expect(supplySources(CTX, s, "axis")).toEqual(["D41", "L31", "O22", "S30", "W33", "Y30"]);
    expect(supplySources(CTX, s, "allies")).not.toContain("O22");
  });

  it("an ordinary city or a port is not a source (only capitals, plus sea supply that is not built)", () => {
    const s = board([german("g1", "M32")]);
    expect(supplySources(CTX, s, "axis")).not.toContain("N31");
    const wide: SupplyPolicy = { ...SUPPLY_POLICY, sourceFeatures: ["capital", "capital-port", "city", "port"] };
    expect(supplySources(CTX, s, "axis", wide).length).toBeGreaterThan(1);
  });
});

describe("land supply lines (Ref 19.3)", () => {
  it("a unit is supplied by a continuous line of controlled hexes, each step adjacent and crossable", () => {
    const s = board([pole("p1", "M33")]);
    const line = lineOf(s, "allies", "p1")!;
    expect(line.via).toBe("land");
    expect(line.source).toBe("M35");
    expect(line.path[0]).toBe("M33");
    expect(line.path.length).toBe(3);
    for (let i = 1; i < line.path.length; i++) {
      expect(adjacentHexes(CTX, line.path[i - 1]!)).toContain(line.path[i]);
      expect(canCross(CTX, line.path[i - 1]!, line.path[i]!)).toBe(true);
    }
  });

  it("the unit on its source is supplied by a line of one hex", () => {
    expect(lineOf(board([pole("p1", "M35")]), "allies", "p1")!.path).toEqual(["M35"]);
  });

  it("Ref 19.3: enemy ZOC on the unit's hex and on the source does not cut a line whose hexes between are free of it", () => {
    // L35 touches both Warsaw (M35) and M34, so the direct step is out (next test); the line goes round through N34.
    const s = board([pole("p1", "M34"), german("g1", "L35")]);
    expect(lineOf(s, "allies", "p1")!.path).toEqual(["M34", "N34", "M35"]);
  });

  it("Ref 19.3: a unit next to its source is not supplied when both stand in the ZOC of the same enemy unit", () => {
    const hold = board([pole("p1", "M34"), german("g1", "L35")]);
    const around = Object.fromEntries(adjacentHexes(CTX, "M34").filter((h) => h !== "M35" && CTX.map.hexes[h]?.land).map((h) => [h, "germany" as const]));
    const s = { ...hold, control: { ...hold.control, ...around } };
    expect(lineOf(s, "allies", "p1")).toBeUndefined(); // the only way out is the direct step, and one armor unit covers both hexes
    const apart = { ...s, units: { ...s.units, g1: { ...s.units.g1!, at: "L34" } } }; // L34 touches M34 but not Warsaw: the exception no longer applies
    expect(lineOf(apart, "allies", "p1")!.path).toEqual(["M34", "M35"]);
  });

  it("Ref 19.3: cut by enemy ZOC on a hex between (Messina chain, Sicily to Rome)", () => {
    const base = withItaly([italian("i1", "DD21")]);
    expect(lineOf(base, "axis", "i1")!.path).toContain("CC23");
    const cut = withItaly([italian("i1", "DD21"), british("b1", "BB24")]); // ZOC onto CC23 and BB23
    expect(unsuppliedUnits(CTX, cut, "axis")).toEqual(["i1"]);
    expect(isUnitSupplied(CTX, cut, "i1")).toBe(false);
  });

  it("Ref 19.3: cut by a ring of enemy ZOC around the unit's way out (Poland)", () => {
    const s = board([pole("p1", "M33"), german("g1", "N34"), german("g2", "L35")]);
    expect(lineOf(s, "allies", "p1")).toBeUndefined();
    expect(unsuppliedUnits(CTX, s, "allies")).toEqual(["p1"]);
  });

  it("cut by an enemy-controlled hex on the only way (Ref 19.3, 7.0)", () => {
    const open = withItaly([italian("i1", "DD21")]);
    const cut = { ...open, control: { CC23: "britain" as const } };
    expect(unsuppliedUnits(CTX, open, "axis")).toEqual([]);
    expect(unsuppliedUnits(CTX, cut, "axis")).toEqual(["i1"]);
    expect(unsuppliedUnits(CTX, { ...open, control: { CC23: "france" as const } }, "axis")).toEqual(["i1"]);
  });

  it("a hex nobody controls cannot carry a line (Ref 7.0: neutral Yugoslavia; a sleeping Axis ally is the exception, spec 15 R10)", () => {
    const yugoslavia = Object.values(CTX.map.hexes).find((h) => h.land && h.country === "yugoslavia")!.id;
    const s = board([german("g1", yugoslavia), german("g2", "L32")]);
    expect(controllingSide(CTX, s, yugoslavia)).toBeNull();
    expect(unsuppliedUnits(CTX, s, "axis")).toEqual(["g1"]);
    expect(unsuppliedUnits(CTX, board([german("g3", "CC30")]), "axis")).toEqual(["g3"]);
  });

  it("an enemy ground unit standing on a controlled source cuts it off (the capital cannot supply)", () => {
    // Without the sleeping allies (spec 15 R10 makes their capitals Axis sources too, so g1 would trace to Budapest), Berlin is the only Axis source.
    const s = board([german("g1", "L32"), british("b1", "L31")], undefined, { minorAllies: [] });
    expect(unsuppliedUnits(CTX, s, "axis")).toEqual(["g1"]);
  });

  it("an enemy ground unit standing on the line blocks it", () => {
    const s = withItaly([italian("i1", "DD21"), british("b1", "CC23")]);
    expect(unsuppliedUnits(CTX, s, "axis")).toEqual(["i1"]);
  });

  it("friendly units do NOT negate enemy ZOC for supply (Ref 7.0); the policy switch can turn negation on", () => {
    const s = withItaly([italian("i1", "DD21"), british("b1", "BB24"), italian("i2", "BB23"), italian("i3", "CC23")]);
    expect(unsuppliedUnits(CTX, s, "axis")).toEqual(["i1", "i3"]); // i2 sits on the ZOC edge, the line to it still ends there
    const on: SupplyPolicy = { ...SUPPLY_POLICY, zoc: { friendlyUnitNegates: true } };
    expect(unsuppliedUnits(CTX, s, "axis", on)).toEqual([]);
  });

  it("Ref 19.3: a line crosses a Crossing Arrow without naval help (the Strait of Messina)", () => {
    const hexside = MAP.hexsides["DD21-DD22"] ?? MAP.hexsides["DD22-DD21"];
    expect(hexside?.crossingArrow).toBeTruthy();
    expect(lineOf(withItaly([italian("i1", "DD21")]), "axis", "i1")!.path.slice(0, 3)).toEqual(["DD21", "DD22", "CC23"]);
  });

  it("without the arrow the same strait is a cut: water between two land hexes carries no line", () => {
    const side = MAP.hexsides["DD21-DD22"] ?? MAP.hexsides["DD22-DD21"]!;
    const hexsides = { ...MAP.hexsides, [side.id]: { ...side, land: false, crossingArrow: false } };
    const noArrow = { ...CTX, map: { ...MAP, hexsides } };
    expect(unsuppliedUnits(noArrow, withItaly([italian("i1", "DD21")]), "axis")).toEqual(["i1"]);
  });

  it("an enemy unit on a hex blocks the line even when friendly units cancel the ZOC around it", () => {
    const s = withItaly([italian("i1", "DD21"), italian("i2", "DD22"), italian("i3", "BB23"), british("b1", "CC23")]);
    expect(unsuppliedUnits(CTX, s, "axis")).toEqual(["i1", "i2"]);
  });

  it("an island with no arrow is out of supply: Sardinia (sea supply is a stub, Ref 19.31)", () => {
    expect(unsuppliedUnits(CTX, withItaly([italian("i1", "AA19")]), "axis")).toEqual(["i1"]);
  });

  it("no maximum length is applied, but a policy can set one", () => {
    const s = board([german("g1", "K31")]);
    expect(lineOf(s, "axis", "g1")).toBeDefined();
    const far = withItaly([italian("i1", "DD21")]);
    expect(unsuppliedUnits(CTX, far, "axis", { ...SUPPLY_POLICY, maxLength: 3 })).toEqual(["i1"]);
    expect(unsuppliedUnits(CTX, far, "axis", { ...SUPPLY_POLICY, maxLength: 6 })).toEqual(["i1"]); // the line is 7 steps long
    expect(unsuppliedUnits(CTX, far, "axis", { ...SUPPLY_POLICY, maxLength: 7 })).toEqual([]);
  });

  it("Western Allied and Soviet supply do not come from each other's sources (19.3)", () => {
    const allied = { ...board([]).nations, ussr: { ...board([]).nations.ussr, status: "allied" as const } };
    const s = board([counter("r1", "ussr", "infantry", 3, "K22", 3), british("b1", "K23")], undefined, { nations: allied });
    expect(supplySources(CTX, s, "allies")).toContain("H47");
    expect(unsuppliedUnits(CTX, s, "allies")).toEqual(["r1"]); // a Soviet next to London, on an island away from Moscow; the British at London are supplied
    expect(unsuppliedUnits(CTX, s, "allies", { ...SUPPLY_POLICY, separateAlliedGroups: false })).toEqual([]);
    const home = board([counter("r1", "ussr", "infantry", 3, "H46", 3), pole("p1", "M34")], undefined, { nations: allied });
    expect(unsuppliedUnits(CTX, home, "allies")).toEqual([]);
    expect(lineOf(home, "allies", "p1")!.source).toBe("M35"); // lines may cross each other's hexes, but each starts at its own source
  });

  it("naval and air units and replacements are never listed; airbases are (Ref 19.3, 19.4, 11.75)", () => {
    const s = board([counter("f1", "germany", "fleet", 5, "CC30"), counter("a1", "germany", "air", 4, "CC30"), counter("b1", "germany", "airbase", 1, "CC30")]);
    expect(unsuppliedUnits(CTX, s, "axis")).toEqual(["b1"]);
  });

  it("isUnitSupplied: fleets and air units are always in supply, an airbase or ground unit only when traced (Ref 19.3)", () => {
    const s = board([counter("f1", "germany", "fleet", 5, "CC30"), counter("a1", "germany", "air", 4, "CC30"), counter("r1", "germany", "replacement", 1, "CC30"), counter("b1", "germany", "airbase", 1, "CC30"), german("g1", "CC30"), german("g2", "L32")]);
    expect(["f1", "a1", "r1", "b1", "g1", "g2"].map((id) => isUnitSupplied(CTX, s, id))).toEqual([true, true, true, false, false, true]);
  });

  it("works in the 1942 scenario too", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const s = board([], SCENARIO_1942);
    expect(supplySources(ctx, s, "axis")).toContain("L31");
  });
});

describe("the answer is deterministic (spec 03)", () => {
  const units = [pole("p9", "M33"), pole("p10", "M34"), german("g1", "L35"), british("b1", "K22"), british("b2", "K23")];
  it("same state, same answer, and unit insertion order does not matter", () => {
    const a = board(units);
    const b = board([...units].reverse());
    expect(supplyStatus(CTX, a, "allies")).toEqual(supplyStatus(CTX, a, "allies"));
    expect(supplyStatus(CTX, a, "allies")).toEqual(supplyStatus(CTX, b, "allies"));
  });

  it("units are listed in numeric id order (p9 before p10)", () => {
    const st = supplyStatus(CTX, board(units), "allies");
    expect(st.supplied.map((l) => l.unitId)).toEqual(["b1", "b2", "p9", "p10"]);
  });

  it("does not change the state it reads", () => {
    const s = board(units);
    const copy = JSON.stringify(s);
    supplyStatus(CTX, s, "allies");
    expect(JSON.stringify(s)).toBe(copy);
  });
});

describe("malformed input does not throw", () => {
  it("units on unknown hexes, boxes, unknown owners, missing fields, a bad side", () => {
    const junk = [counter("x1", "germany", "infantry", 1, "ZZ99"), counter("x2", "germany", "infantry", 1, "US Box"), { id: "x3", owner: "martian", type: "infantry", strength: 1, at: "L31" }, { id: "x4" }] as unknown as Unit[];
    const s = board([...junk, german("g1", "L32")]);
    expect(() => supplyStatus(CTX, s, "axis")).not.toThrow();
    expect(supplyStatus(CTX, s, "axis").supplied.map((l) => l.unitId)).toEqual(["g1"]);
    expect(supplyStatus(CTX, s, "nobody" as never)).toMatchObject({ sources: [], supplied: [], unsupplied: [] });
    expect(isUnitSupplied(CTX, s, "missing")).toBe(false);
    expect(isUnitSupplied(CTX, s, "x3")).toBe(false);
    const holes = { ...s, units: { ...s.units, n1: null } } as unknown as GameState;
    expect(supplyStatus(CTX, holes, "axis").supplied.map((l) => l.unitId)).toEqual([]);
    for (const k of ["nations", "minorAllies", "control"] as const) {
      const bad = { ...s, [k]: undefined };
      expect(() => supplyStatus(CTX, bad, "axis"), k).not.toThrow();
      expect(() => supplySources(CTX, bad, "allies"), k).not.toThrow();
      expect(isUnitSupplied(CTX, bad, "g1"), k).toBe(false);
    }
    expect(() => supplyStatus(CTX, undefined as unknown as GameState, "axis")).not.toThrow();
    const noUnits = { ...s, units: undefined } as unknown as GameState;
    expect(unsuppliedUnits(CTX, noUnits, "axis")).toEqual([]);
  });
});

// Ref 19.4: an unsupplied unit keeps its combat factor and may attack, so the attack hook is not tied to supply.
describe("effects on combat (Ref 19.4)", () => {
  it("an unsupplied unit still takes part in the attacker pool", () => {
    const s = board([german("g1", "CC30")]);
    expect(unsuppliedUnits(CTX, s, "axis")).toEqual(["g1"]);
    expect(attackerPool(CTX, s, "axis", []).map((u) => u.id)).toEqual(["g1"]);
  });
});
