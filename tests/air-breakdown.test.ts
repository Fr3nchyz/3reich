import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { applyAirBreakDown } from "../src/engine/air-breakdown";
import { airCounterParts, routeLostAirFactors } from "../src/engine/losses";
import { legalBuilds } from "../src/engine/construction";
import type { ForceEntry, ForceOwner, GameState, Unit } from "../src/engine/types";
import { CTX, atStart } from "./helpers";
import { inf } from "./helpers-move";

// Spec 17, ticket 17-2: air factors lost by an air unit that survives (it breaks down, spec 09 R6) go back to the pool in the counter sizes (R3, TODO(verify) RB4,
// RB17); fleets do not (RB5); R4's cases apply as for a whole unit; a nation never has more air factors than its scenario lists (RB13).

const air = (id: string, owner: ForceOwner, strength: number, at = "M32"): Unit => inf(id, owner, at, strength, 4, "air");
const withUnits = (units: Unit[], scenario = SCENARIO_1939): GameState => {
  const s = atStart(scenario, 1);
  return { ...s, units: { ...s.units, ...Object.fromEntries(units.map((u) => [u.id, u])) }, nextUnitId: 900 };
};
const returnedOf = (s: GameState, owner: ForceOwner): ForceEntry[] => (s.pools[owner]?.allowableBuilds ?? []).filter((e) => e.returned);
const ok = <T extends object>(r: T | { problem: string }): T => {
  if ("problem" in r) throw new Error(r.problem);
  return r;
};
/** Air factors a nation holds: on the map plus in the pool (built or not yet built). */
const airTotal = (s: GameState, owner: ForceOwner): number =>
  Object.values(s.units).filter((u) => u.type === "air" && (u.nationality ?? u.owner) === owner).reduce((n, u) => n + u.strength, 0) +
  (s.pools[owner]?.allowableBuilds ?? []).filter((e) => e.type === "air").reduce((n, e) => n + e.strength * e.count, 0);

describe("R3, RB17: the lost factors become counters of the spec 09 sizes, largest first", () => {
  it("sizes 1, 2, 3, 5", () => {
    expect(airCounterParts(2)).toEqual([2]);
    expect(airCounterParts(4)).toEqual([3, 1]);
    expect(airCounterParts(7)).toEqual([5, 2]);
    expect(airCounterParts(0)).toEqual([]);
    expect(airCounterParts(4, [1, 3])).toEqual([3, 1]);
  });
});

describe("R3, RB4: a surviving air unit's lost factors go back to the pool", () => {
  it("a 5 that owes 1 breaks to a 3 and returns a 2, offered at step 8b", () => {
    const s = withUnits([air("a1", "germany", 5)]);
    const r = ok(applyAirBreakDown(s, [{ id: "a1", factors: 1 }], 1));
    expect(r.state.units.a1!.strength).toBe(3);
    expect(returnedOf(r.state, "germany")).toEqual([{ type: "air", strength: 2, movement: 4, count: 1, returned: true }]);
    expect(r.events).toContainEqual({ type: "UNIT_RETURNED_TO_POOL", unitId: "a1", owner: "germany", unitType: "air", strength: 2, at: "M32", pool: "germany" });
    expect(r.events.map((e) => e.type)).not.toContain("UNIT_ELIMINATED");
    const at8b = { ...r.state, position: { part: "player-turn" as const, turn: 1 as const, step: "8b" }, activeSide: "axis" as const };
    expect(legalBuilds(CTX, at8b)).toContainEqual(expect.objectContaining({ owner: "germany", unit: { type: "air", strength: 2, returned: true } }));
  });
  it("a 5 that owes 3 leaves a 2 and returns a 3", () => {
    const s = withUnits([air("a1", "germany", 5)]);
    const r = ok(applyAirBreakDown(s, [{ id: "a1", factors: 3 }], 3));
    expect(r.state.units.a1!.strength).toBe(2);
    expect(returnedOf(r.state, "germany")).toEqual([{ type: "air", strength: 3, movement: 4, count: 1, returned: true }]);
  });
  it("a unit destroyed whole is routed once by the 17-1 route; no factor is counted twice", () => {
    const s = withUnits([air("a1", "germany", 3), air("a2", "germany", 5)]);
    const before = airTotal(s, "germany");
    const r = ok(applyAirBreakDown(s, [{ id: "a1", factors: 3 }, { id: "a2", factors: 1 }], 4));
    expect(r.state.units.a1).toBeUndefined();
    expect(r.events.filter((e) => e.type === "UNIT_RETURNED_TO_POOL" && e.unitId === "a1")).toHaveLength(1);
    expect(returnedOf(r.state, "germany")).toEqual(
      expect.arrayContaining([
        { type: "air", strength: 3, movement: 4, count: 1, returned: true },
        { type: "air", strength: 2, movement: 4, count: 1, returned: true },
      ]),
    );
    expect(airTotal(r.state, "germany")).toBe(before);
  });
  it("a loss of 4 factors comes back as a 3 and a 1; equal counters add up in one entry", () => {
    const s = withUnits([air("a1", "germany", 5), air("a2", "germany", 5)]);
    const r1 = routeLostAirFactors(s, s.units.a1!, 4);
    expect(returnedOf(r1.state, "germany")).toEqual([
      { type: "air", strength: 3, movement: 4, count: 1, returned: true },
      { type: "air", strength: 1, movement: 4, count: 1, returned: true },
    ]);
    const r2 = routeLostAirFactors(r1.state, s.units.a2!, 4);
    expect(returnedOf(r2.state, "germany").map((e) => e.count)).toEqual([2, 2]);
  });
  it("the counter's own nationality gets the factors, not the Power that holds it", () => {
    const u: Unit = { ...air("a1", "germany", 5), nationality: "italy" };
    const s = withUnits([u]);
    const r = ok(applyAirBreakDown(s, [{ id: "a1", factors: 1 }], 1));
    expect(returnedOf(r.state, "italy")).toHaveLength(1);
    expect(returnedOf(r.state, "germany")).toHaveLength(0);
    expect(r.events).toContainEqual(expect.objectContaining({ type: "UNIT_RETURNED_TO_POOL", owner: "germany", pool: "italy" }));
  });
  it("a wrong choice is refused with the reason, state untouched", () => {
    const s = withUnits([air("a1", "germany", 5)]);
    expect(applyAirBreakDown(s, [{ id: "a1", factors: 2 }], 1)).toHaveProperty("problem");
    expect(applyAirBreakDown(s, [{ id: "nope", factors: 1 }], 1)).toHaveProperty("problem");
  });
});

describe("R4 applies to returned factors as to a whole unit (RB14, RB9)", () => {
  it("a Power that is out of the game, or a minor that is not an active ally: lost for good, one event for all the factors", () => {
    const s = withUnits([air("p1", "poland", 5)]);
    const r = routeLostAirFactors(s, s.units.p1!, 2);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([{ type: "UNIT_LOST_FOR_GOOD", unitId: "p1", owner: "poland", unitType: "air", strength: 2, at: "M32", reason: "minor-country" }]);
    const gone = withUnits([air("f1", "france", 5)]);
    const g2 = { ...gone, nations: { ...gone.nations, france: { ...gone.nations.france, status: "conquered" as const } } };
    const rg = routeLostAirFactors(g2, g2.units.f1!, 2);
    expect(rg.events.map((e) => e.type)).toEqual(["UNIT_LOST_FOR_GOOD"]);
  });
  it("a nation with no pool: lost for good", () => {
    const s = withUnits([air("a1", "germany", 5)]);
    const { germany: _g, ...pools } = s.pools;
    const r = routeLostAirFactors({ ...s, pools }, s.units.a1!, 2);
    expect(r.events).toMatchObject([{ type: "UNIT_LOST_FOR_GOOD", reason: "out-of-game" }]);
  });
  it("an active Minor-Ally's air factors wait in its own pool (1942)", () => {
    const s = withUnits([air("fi1", "finland", 5, "A40")], SCENARIO_1942);
    const r = routeLostAirFactors(s, s.units.fi1!, 2);
    expect(r.events).toMatchObject([{ type: "UNIT_RETURNED_TO_POOL", pool: "finland", strength: 2 }]);
  });
});

describe("RB5: fleets never return factors", () => {
  it("routeLostAirFactors ignores a fleet: its break-down factors stay lost for good (break-down not built, ticket 12-9)", () => {
    const s = withUnits([{ id: "f1", owner: "germany", type: "fleet", strength: 9, at: "M32" }]);
    expect(routeLostAirFactors(s, s.units.f1!, 3)).toEqual({ state: s, events: [] });
  });
});

describe("RB13: never more air factors than the scenario lists", () => {
  it.each([[1], [2], [3], [4]])("owing %i factors from a 5 and a 3 keeps each nation's air total (map plus pool) constant", (owed) => {
    const s = withUnits([air("a1", "germany", 5), air("a2", "germany", 3, "M33")]);
    const before = airTotal(s, "germany");
    const take = owed === 4 ? [{ id: "a1", factors: 1 }, { id: "a2", factors: 3 }] : [{ id: "a1", factors: owed }];
    const r = ok(applyAirBreakDown(s, take, owed === 4 ? 4 : owed));
    expect(airTotal(r.state, "germany")).toBe(before);
  });
});
