import { describe, expect, it } from "vitest";
import { ISLANDS } from "../src/data/islands";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { germanNavalShare, italianNavalFactors, italySurrenderTest, V16_AFRICA_COUNTRIES, V16_ISLAND_HEXES } from "../src/engine/conquest-italy";
import { isUnitSupplied } from "../src/engine/supply";
import type { GameState, UnitType } from "../src/engine/types";
import { counter } from "./board";
import { atStart, ctxFor } from "./helpers";

// spec 14 R6 / Ref 18.2; TODO(verify) V16: pure surrender conditions and retained naval factors.
const ctx = ctxFor(SCENARIO_1944);
const mainland = Object.values(MAP.hexes).find((h) => h.country === "italy" && h.name === "Rome")!.id;
const africa = (country: string) => Object.values(MAP.hexes).find((h) => h.land && h.country === country)!.id;
function position(): GameState {
  const s = atStart(SCENARIO_1944, 1);
  s.year = 1943;
  s.season = "spring";
  s.nations.italy.status = "axis";
  s.units = { a: counter("a", "britain", "infantry", 2, mainland, 3) };
  // Existing supply rule: captured Rome supplies the British ground unit.
  for (const h of Object.values(MAP.hexes)) if (h.land) s.control[h.id] = "britain";
  return s;
}
const test = (s: GameState, first = true) => italySurrenderTest(ctx, s, first);
const hold = (s: GameState, id: keyof typeof ISLANDS, allied: boolean) => {
  for (const h of ISLANDS[id].hexes) s.control[h] = allied ? "britain" : "germany";
};

describe("Italian surrender (spec 14 R6)", () => {
  it("uses the map's island zones even when the scenario omits them", () => {
    for (const id of ["sicily", "sardinia", "corsica"] as const) expect(V16_ISLAND_HEXES[id]).toEqual(ISLANDS[id].hexes);
  });
  it("requires Spring 1943 or later", () => {
    const s = position();
    expect(test({ ...s, year: 1942, season: "winter" }).date).toBe(false);
    expect(test(s).date).toBe(true);
    expect(test({ ...s, year: 1944 }).date).toBe(true);
  });
  it("requires supplied non-airborne Allied ground forces on mainland Italy", () => {
    const s = position();
    expect(isUnitSupplied(ctx, s, "a")).toBe(true);
    expect(test(s).mainland).toBe(true);
    for (const at of [...ISLANDS.sicily.hexes, ...ISLANDS.sardinia.hexes]) {
      s.units.a!.at = at;
      expect(test(s).mainland).toBe(false);
    }
    s.units.a!.at = "Z22";
    s.control = { Z22: "britain" };
    expect(isUnitSupplied(ctx, s, "a")).toBe(false);
    expect(test(s).mainland).toBe(false);
    const supplied = position();
    for (const type of ["airborne", "air", "fleet", "airbase", "bridgehead"] as UnitType[]) {
      supplied.units.a!.type = type;
      expect(test(supplied).mainland).toBe(false);
    }
    supplied.units.a = counter("a", "germany", "infantry", 2, mainland);
    expect(test(supplied).mainland).toBe(false);
  });
  it("counts Axis ground, air and fleets throughout every African country, including Egypt", () => {
    for (const country of V16_AFRICA_COUNTRIES) for (const type of ["infantry", "air", "fleet"] as UnitType[]) {
      const s = position();
      s.units.b = counter("b", "germany", type, 2, africa(country));
      expect(test(s).africaClear).toBe(false);
    }
  });
  it("ignores Vichy forces in Libya by default", () => {
    const s = position();
    s.units.b = counter("b", "vichy-france", "infantry", 2, africa("libya"));
    expect(test(s).africaClear).toBe(true);
  });
  it("accepts all six Sicily hexes alone, but rejects five", () => {
    const s = position();
    hold(s, "sardinia", false);
    hold(s, "corsica", false);
    expect(test(s).islands).toBe(true);
    s.control[ISLANDS.sicily.hexes[0]!] = "germany";
    expect(test(s).islands).toBe(false);
  });
  it("accepts Sardinia and Corsica together, but neither alone", () => {
    const s = position();
    hold(s, "sicily", false);
    expect(test(s).islands).toBe(true);
    hold(s, "corsica", false);
    expect(test(s).islands).toBe(false);
    hold(s, "corsica", true);
    hold(s, "sardinia", false);
    expect(test(s).islands).toBe(false);
  });
  it("requires all four conditions and Allied Initiative supplied by the caller", () => {
    const s = position();
    expect(test(s)).toEqual({ date: true, mainland: true, africaClear: true, islands: true, initiative: true, surrenders: true });
    expect(test(s, false).surrenders).toBe(false);
    expect(test(s, false).initiative).toBe(false);
    expect(test({ ...s, year: 1942 }).surrenders).toBe(false);
    expect(test({ ...s, units: {} }).surrenders).toBe(false);
    s.units.b = counter("b", "italy", "infantry", 2, africa("egypt"));
    expect(test(s).surrenders).toBe(false);
    delete s.units.b;
    hold(s, "sicily", false);
    hold(s, "corsica", false);
    expect(test(s).surrenders).toBe(false);
  });
  it("cannot surrender in the last 1939 scenario turn or after conquest or surrender", () => {
    const s = position();
    const old = { ...s, ...SCENARIO_1939.end };
    expect(italySurrenderTest(ctxFor(SCENARIO_1939), old, true).surrenders).toBe(false);
    for (const how of ["capital", "italian-surrender"] as const) {
      s.conquests = [{ country: "italy", by: "germany", side: "axis", how, at: { year: 1943, season: "spring" } }];
      expect(test(s).surrenders).toBe(false);
    }
    delete s.conquests;
    s.nations.italy.status = "conquered";
    expect(test(s).surrenders).toBe(false);
  });
  it("is deterministic and does not mutate inputs", () => {
    const s = position();
    const before = structuredClone(s);
    const context = structuredClone(ctx);
    expect(test(s)).toEqual(test(s));
    italianNavalFactors(s);
    germanNavalShare(3, 8);
    expect(s).toEqual(before);
    expect(ctx).toEqual(context);
  });
});

describe("German naval share (spec 14 R6 / V16)", () => {
  it("adds two, caps at available factors, and handles no fleets", () => {
    expect(germanNavalShare(1, 20)).toBe(3);
    expect(germanNavalShare(6, 20)).toBe(8);
    expect(germanNavalShare(5, 4)).toBe(4);
    expect(germanNavalShare(6, 0)).toBe(0);
  });
  it.each([0, 7, -1, 1.5, NaN, Infinity])("rejects invalid die %s", (die) => {
    expect(() => germanNavalShare(die, 20)).toThrow();
  });
  it("sums only Italian fleets, including partial fleets", () => {
    const s = position();
    s.units = {
      a: counter("a", "italy", "fleet", 3, "Z22"),
      b: counter("b", "italy", "fleet", 1, "Z22"),
      c: counter("c", "germany", "fleet", 9, "Z22"),
      d: counter("d", "italy", "air", 5, "Z22"),
    };
    expect(italianNavalFactors(s)).toBe(4);
    expect(italianNavalFactors({ ...s, units: {} })).toBe(0);
  });
});
