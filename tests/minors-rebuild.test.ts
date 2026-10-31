import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyMinorRebuild, minorRebuildCost, minorRebuildProblem, type MinorRebuildUnit } from "../src/engine/minors-rebuild";
import type { GameState, MinorCountry, Side } from "../src/engine/types";
import { CTX, atStart } from "./helpers";

function fixture(country: MinorCountry = "hungary", type: MinorRebuildUnit["type"] = "infantry", strength = 3) {
  const state: GameState = { ...atStart(SCENARIO_1939, 1), units: {},
    minorAllies: [{ owner: country, of: "germany", active: true }],
    countries: { [country]: { status: "allied", helpers: ["germany"] } },
    pools: { [country]: { forcePool: [], allowableBuilds: [{ type, strength, count: 1, returned: true, movement: 3 }] } } };
  const at = Object.values(CTX.map.hexes).find((h) => h.land && h.country === country && h.features.some((f) => f === "capital" || f === "capital-port"))!.id;
  return { state, unit: { type, strength, at }, country };
}
const problem = (s: GameState, u: MinorRebuildUnit, c: MinorCountry = "hungary", side: Side = "axis") => minorRebuildProblem(CTX, s, side, c, u);
const ok = (r: ReturnType<typeof applyMinorRebuild>) => { if (!r.ok) throw new Error(r.error); return r; };

describe("spec 15 R8/R9 pure Minor-Ally rebuilding", () => {
  it("R8/R9 pays the controller, consumes one loss and preserves input and records", () => {
    const { state, unit } = fixture();
    const before = structuredClone(state);
    expect(problem(state, unit)).toBeNull();
    const supplied = { ...unit, id: "old-counter", owner: "france" as const };
    const r = ok(applyMinorRebuild(CTX, state, "axis", "hungary", supplied));
    expect(r.state.nations.germany.brpTotal).toBe(state.nations.germany.brpTotal - 3);
    expect(r.state.nations.germany.spent).toBe(state.nations.germany.spent + 3);
    expect(r.state.pools.hungary!.allowableBuilds).toEqual([]);
    expect(r.state.units[`u${state.nextUnitId}`]).toEqual({ id: `u${state.nextUnitId}`, owner: "hungary", ...unit, movement: 3 });
    expect(r.state.nextUnitId).toBe(state.nextUnitId + 1);
    expect(r.state.countries).toEqual(state.countries);
    expect(r.events).toHaveLength(2);
    expect(state).toEqual(before);
    expect(applyMinorRebuild(CTX, state, "axis", "hungary", unit)).toEqual(r);
    expect(problem(r.state, unit)).toMatch(/returned/);
  });
  it("R9 requires activation and a surviving minor and controller", () => {
    const { state, unit } = fixture();
    expect(problem({ ...state, minorAllies: [{ owner: "hungary", of: "germany", active: false }] }, unit)).toBeTruthy();
    expect(problem({ ...state, minorAllies: [] }, unit)).toBeTruthy();
    expect(problem({ ...state, conquests: [{ country: "hungary" } as never] }, unit)).toBeTruthy();
    expect(problem({ ...state, nations: { ...state.nations, germany: { ...state.nations.germany, status: "conquered" } } }, unit)).toBeTruthy();
    expect(problem(state, unit, "hungary", "allies")).toBeTruthy();
  });
  it.each(["finland", "hungary", "rumania", "bulgaria"] as const)("R9 rebuilds %s only under Germany", (country) => {
    const { state, unit } = fixture(country);
    expect(problem(state, unit, country)).toBeNull();
    expect(problem({ ...state, minorAllies: [{ owner: country, of: "italy", active: true }] }, unit, country)).toBeTruthy();
  });
  it.each(["spain", "turkey"] as const)("R6/R8 %s requires Intervention; Britain pays", (country) => {
    const { state, unit } = fixture(country);
    const allied: GameState = { ...state, minorAllies: [{ owner: country, of: "britain", active: true }], countries: { [country]: { status: "allied", helpers: ["britain", "france"] } } };
    expect(problem(allied, unit, country, "allies")).toBeNull();
    const r = ok(applyMinorRebuild(CTX, allied, "allies", country, unit));
    expect(r.state.nations.britain.brpTotal).toBe(allied.nations.britain.brpTotal - 3);
    expect(r.state.nations.germany).toEqual(allied.nations.germany);
    for (const record of [undefined, { status: "attacked" as const }, { status: "allied" as const, helpers: ["france", "britain"] }]) {
      expect(problem({ ...allied, countries: { [country]: record } }, unit, country, "allies")).toBeTruthy();
    }
  });
  it("R8 ordinary minors and Spain/Turkey fleets cannot be rebuilt", () => {
    const f = fixture("sweden");
    expect(problem(f.state, f.unit, "sweden")).toBeTruthy();
    for (const country of ["spain", "turkey"] as const) {
      const { state, unit } = fixture(country, "fleet", 9);
      expect(problem(state, unit, country)).toMatch(/cannot be rebuilt/);
    }
  });
  it("R8 requires a returned, available counter, not scenario builds or a different kind", () => {
    const { state, unit } = fixture();
    for (const entry of [ { type: "infantry" as const, strength: 3, count: 1 },
      { type: "infantry" as const, strength: 3, count: 0, returned: true as const },
      { type: "infantry" as const, strength: 3, count: 1, returned: true as const, from: { year: 1945 } } ]) {
      expect(problem({ ...state, pools: { hungary: { forcePool: [], allowableBuilds: [entry] } } }, unit)).toBeTruthy();
    }
    expect(problem(state, { ...unit, strength: 4 })).toBeTruthy();
    expect(problem({ ...state, pools: {} }, unit)).toBeTruthy();
  });
  it("R8 uses chart prices and rejects unsupported or malformed counters", () => {
    const { state, unit } = fixture();
    for (const [type, strength, cost] of [["infantry", 3, 3], ["armor", 4, 8], ["air", 5, 15], ["fleet", 9, 27]] as const) {
      expect(minorRebuildCost(CTX, state, "hungary", { ...unit, type, strength })).toBe(cost);
    }
    for (const strength of [0, -1, 1.5, NaN]) expect(minorRebuildCost(CTX, state, "hungary", { ...unit, strength })).toBeNull();
    expect(problem(state, { ...unit, type: "airbase" })).toMatch(/Unsupported/);
  });
  it("R8 charges within both BRP balance and spending limit, with atomic refusal", () => {
    const { state, unit } = fixture();
    for (const change of [{ brpTotal: 2 }, { spendLimit: 2 }, { spent: state.nations.germany.spendLimit }]) {
      const poor = { ...state, nations: { ...state.nations, germany: { ...state.nations.germany, ...change } } };
      const before = structuredClone(poor);
      expect(applyMinorRebuild(CTX, poor, "axis", "hungary", unit).ok).toBe(false);
      expect(poor).toEqual(before);
    }
  });
  it("R8 home placement respects borders, unknown hexes, stacking and enemy proximity", () => {
    const { state, unit } = fixture();
    for (const at of ["invalid", "us-box", Object.values(CTX.map.hexes).find((h) => h.country === "germany")!.id]) {
      expect(problem(state, { ...unit, at })).toMatch(/home/);
    }
    const friend = (id: string) => ({ id, owner: "hungary" as const, ...unit });
    expect(problem({ ...state, units: { a: friend("a"), b: friend("b") } }, unit)).toBeTruthy();
    expect(problem({ ...state, units: { enemy: { ...friend("enemy"), owner: "france" } } }, unit)).toMatch(/Enemy/);
  });
  it("R8 normal air bases, capacity and new-air restrictions apply", () => {
    const { state, unit } = fixture("hungary", "air", 5);
    const r = ok(applyMinorRebuild(CTX, state, "axis", "hungary", unit));
    expect(r.state.airFlown?.units[`u${state.nextUnitId}`]).toBe("new");
    expect(problem(r.state, unit)).toBeTruthy();
    const at = Object.values(CTX.map.hexes).find((h) => h.land && h.country === "hungary" && !h.features.length)!.id;
    expect(problem(state, { ...unit, at })).toMatch(/base/);
  });
  it("R8 reuses rebuilt-fleet gray restrictions and consumes just one of several losses", () => {
    const { state, unit } = fixture("finland", "fleet", 9);
    // R8: synthetic home port isolates the shared fleet restriction from map omissions.
    const ctx = { ...CTX, map: { ...CTX.map, hexes: { ...CTX.map.hexes, [unit.at]: { ...CTX.map.hexes[unit.at]!, features: ["capital-port" as const] } } } };
    state.pools.finland!.allowableBuilds[0]!.count = 2;
    const r = ok(applyMinorRebuild(ctx, state, "axis", "finland", unit));
    expect(r.state.pools.finland!.allowableBuilds[0]!.count).toBe(1);
    expect(r.state.grayFleets?.[`u${state.nextUnitId}`]).toBeDefined();
    expect(state.grayFleets).toBeUndefined();
  });

});
