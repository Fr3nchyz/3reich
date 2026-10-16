import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { AIR_COMBAT_RULES } from "../src/engine/air-combat";
import { airOf } from "../src/engine/air-record";
import { splitChoices } from "../src/engine/air-units";
import type { GameState, Unit } from "../src/engine/types";
import { CTX, atStart } from "./helpers";
import { at6f, errorOf, inf, okOf } from "./helpers-move";

// Spec 09, ticket 09-4: partial air units (R6; Ref 20.6, Ops 4.11). Counter sizes 1, 2, 3 and 5 (`AIR_COMBAT_RULES.counterSizes`, TODO(verify)).

const air = (id: string, at: string, strength: number, owner: Unit["owner"] = "germany", movement = 4): Unit => inf(id, owner, at, strength, movement, "air");
const board = (units: Unit[], tweak: Partial<GameState> = {}) => at6f(units, "axis", SCENARIO_1939, { nextUnitId: 100, ...tweak });
const split = (unit: string, parts: number[], side: "axis" | "allies" = "axis"): Action => ({ type: "SPLIT_AIR", side, unit, parts });
const combine = (units: string[], side: "axis" | "allies" = "axis"): Action => ({ type: "COMBINE_AIR", side, units });
const factors = (s: GameState) => Object.values(s.units).filter((u) => u.type === "air").reduce((n, u) => n + u.strength, 0);

describe("SPLIT_AIR", () => {
  it("replaces the unit by smaller counters of the same owner, nationality, movement and hex; the factors are conserved", () => {
    const lent = { ...air("a1", "J32", 5), nationality: "italy" as const };
    const s = board([lent, air("a9", "J32", 2)]);
    const r = okOf(applyAction(CTX, s, split("a1", [2, 3])));
    expect(r.state.units.a1).toBeUndefined();
    const made = Object.values(r.state.units).filter((u) => u.id !== "a9");
    expect(made.map((u) => [u.id, u.strength])).toEqual([["u100", 3], ["u101", 2]]); // largest first, new ids
    for (const u of made) expect(u).toMatchObject({ owner: "germany", nationality: "italy", type: "air", movement: 4, at: "J32" });
    expect(factors(r.state)).toBe(factors(s));
    expect(r.state.nextUnitId).toBe(102);
    expect(r.events).toEqual([{ type: "AIR_RESHAPED", at: "J32", before: [{ id: "a1", strength: 5 }], after: [{ id: "u100", strength: 3 }, { id: "u101", strength: 2 }] }]);
    expect(s.units.a1!.strength).toBe(5); // the input state is untouched
  });

  it("every split the list names is accepted, and the list is bounded", () => {
    for (const strength of [2, 3, 5]) {
      const s = board([air("a1", "J32", strength)]);
      const listed = splitChoices(strength);
      for (const parts of listed) expect(applyAction(CTX, s, split("a1", parts)).ok, parts.join("+")).toBe(true);
    }
    expect(splitChoices(5)).toEqual([[3, 2], [3, 1, 1], [2, 2, 1], [2, 1, 1, 1], [1, 1, 1, 1, 1]]);
    expect(splitChoices(1)).toEqual([]);
    expect(splitChoices(3)).toEqual([[2, 1], [1, 1, 1]]);
    for (const odd of [Infinity, -Infinity, NaN, 2.5, -4, 0, 21, 1e308]) expect(splitChoices(odd), String(odd)).toEqual([]);
  });

  it("refuses a part that is no counter size (there is no 4), a wrong total, one part, and malformed lists", () => {
    const s = board([air("a1", "J32", 5)]);
    expect(errorOf(applyAction(CTX, s, split("a1", [4, 1])))).toMatch(/sizes 1, 2, 3, 5 only/);
    expect(errorOf(applyAction(CTX, s, split("a1", [3, 3])))).toMatch(/add up to 6/);
    expect(errorOf(applyAction(CTX, s, split("a1", [2, 2])))).toMatch(/add up to 4/);
    expect(errorOf(applyAction(CTX, s, split("a1", [5])))).toMatch(/two or more parts/);
    expect(errorOf(applyAction(CTX, s, split("a1", [])))).toMatch(/two or more parts/);
    expect(errorOf(applyAction(CTX, s, split("a1", [2.5, 2.5])))).toMatch(/whole number/);
    expect(errorOf(applyAction(CTX, s, split("a1", [-3, 8])))).toMatch(/sizes/);
    // eslint-disable-next-line no-sparse-arrays
    expect(errorOf(applyAction(CTX, s, split("a1", [, 5] as unknown as number[])))).toMatch(/whole number/);
    expect(errorOf(applyAction(CTX, s, { type: "SPLIT_AIR", side: "axis", unit: "a1", parts: "32" as unknown as number[] }))).toMatch(/whole number/);
  });

  it("refuses ground units, the other side's air, minor-country air, unknown units, another step and the wrong side", () => {
    const s = board([air("a1", "J32", 5), inf("u1", "germany", "L32", 3, 3), air("p1", "M33", 3, "poland"), air("f1", "K33", 3, "finland")]);
    expect(errorOf(applyAction(CTX, s, split("u1", [2, 1])))).toMatch(/not an air unit/);
    expect(errorOf(applyAction(CTX, s, split("p1", [2, 1])))).toMatch(/does not belong to the axis side/);
    expect(errorOf(applyAction(CTX, s, split("zz", [3, 2])))).toMatch(/not on the map/);
    expect(errorOf(applyAction(CTX, s, split("constructor", [3, 2])))).toMatch(/not on the map/);
    expect(errorOf(applyAction(CTX, s, split("a1", [3, 2], "allies")))).toMatch(/player turn/);
    expect(errorOf(applyAction(CTX, { ...s, position: { part: "player-turn", turn: 1, step: "8b" } }, split("a1", [3, 2])))).toMatch(/step 6f or 7b/);
    const fin = board([air("f1", "K33", 3, "finland")], { minorAllies: [{ owner: "finland", active: true }] } as Partial<GameState>);
    expect(errorOf(applyAction(CTX, fin, split("f1", [2, 1])))).toMatch(/not a Major Power's air/);
  });

  it("parts of a unit that staged this turn count as staged (one stage a turn cannot be dodged by splitting)", () => {
    let s = board([air("a1", "J32", 5)]);
    s = okOf(applyAction(CTX, s, { type: "STAGE_AIR", side: "axis", units: ["a1"], to: "K33" })).state;
    const r = okOf(applyAction(CTX, s, split("a1", [3, 2])));
    expect(airOf(r.state).staged).toEqual(expect.arrayContaining(["a1", "u100", "u101"]));
    expect(errorOf(applyAction(CTX, r.state, { type: "STAGE_AIR", side: "axis", units: ["u100"], to: "J32" }))).toMatch(/already staged/);
  });
});

describe("COMBINE_AIR", () => {
  it("joins like counters in one hex into one new counter; the factors are conserved", () => {
    const s = board([air("a1", "J32", 3), air("a2", "J32", 2), air("b1", "J32", 1)]);
    const r = okOf(applyAction(CTX, s, combine(["a2", "a1"])));
    expect(r.state.units.a1).toBeUndefined();
    expect(r.state.units.a2).toBeUndefined();
    expect(r.state.units.u100).toMatchObject({ owner: "germany", type: "air", strength: 5, movement: 4, at: "J32" });
    expect(factors(r.state)).toBe(factors(s));
    expect(r.events).toEqual([{ type: "AIR_RESHAPED", at: "J32", before: [{ id: "a2", strength: 2 }, { id: "a1", strength: 3 }], after: [{ id: "u100", strength: 5 }] }]);
  });

  it("refuses a total that is no counter size, units apart, other owners or nationalities or movement, and one unit", () => {
    const s = board([air("a1", "J32", 3), air("a2", "J32", 3), air("a3", "K33", 2), { ...air("a4", "J32", 1), nationality: "italy" as const }, air("a5", "J32", 1, "germany", 6), air("a6", "J32", 2)]);
    expect(errorOf(applyAction(CTX, s, combine(["a1", "a2"])))).toMatch(/6 air factors is not a counter size/);
    expect(errorOf(applyAction(CTX, s, combine(["a1", "a3"])))).toMatch(/only like air counters combine/);
    expect(errorOf(applyAction(CTX, s, combine(["a6", "a4"])))).toMatch(/only like air counters combine/);
    expect(errorOf(applyAction(CTX, s, combine(["a6", "a5"])))).toMatch(/only like air counters combine/);
    expect(errorOf(applyAction(CTX, s, combine(["a1"])))).toMatch(/two or more distinct/);
    expect(errorOf(applyAction(CTX, s, combine(["a1", "a1"])))).toMatch(/two or more distinct/);
    expect(errorOf(applyAction(CTX, s, combine(["a1", "zz"])))).toMatch(/not on the map/);
    expect(errorOf(applyAction(CTX, s, { type: "COMBINE_AIR", side: "axis", units: ["a1", "constructor"] }))).toMatch(/not on the map/);
    // eslint-disable-next-line no-sparse-arrays
    expect(errorOf(applyAction(CTX, s, { type: "COMBINE_AIR", side: "axis", units: [, "a1"] as unknown as string[] }))).toMatch(/two or more distinct/);
    expect(errorOf(applyAction(CTX, s, combine(["a1", "a6"], "allies")))).toMatch(/player turn/);
  });

  it("refuses another step, a different owner on the same side and a free force's air", () => {
    const s = board([air("a1", "J32", 2), air("a2", "J32", 3)]);
    expect(errorOf(applyAction(CTX, { ...s, position: { part: "player-turn", turn: 1, step: "8b" } }, combine(["a1", "a2"])))).toMatch(/step 6f or 7b/);
    const mixed = board([air("a1", "J32", 2), air("i1", "J32", 3, "italy")], { nations: { ...SCENARIO_1939.nations, italy: { ...atStart(SCENARIO_1939, 1).nations.italy, status: "axis" as const } } });
    expect(errorOf(applyAction(CTX, mixed, combine(["a1", "i1"])))).toMatch(/same owner, nationality and movement factor/);
    const free = board([air("f1", "J32", 2, "free-france"), air("f2", "J32", 3, "free-france")], { activeSide: "allies" });
    expect(errorOf(applyAction(CTX, free, combine(["f1", "f2"], "allies")))).toMatch(/not a Major Power's air/);
  });

  it("refuses ground units, a Major Power's air that is not in the war, and the other side's air", () => {
    const s = board([air("a1", "J32", 3), inf("u1", "germany", "J32", 2, 3), air("p1", "J32", 2, "poland")]);
    expect(errorOf(applyAction(CTX, s, combine(["a1", "u1"])))).toMatch(/not an air unit/);
    expect(errorOf(applyAction(CTX, s, combine(["a1", "p1"])))).toMatch(/does not belong to the axis side/);
  });

  it("a combined counter is staged if any part was", () => {
    let s = board([air("a1", "J32", 2), air("a2", "K33", 3)]);
    s = okOf(applyAction(CTX, s, { type: "STAGE_AIR", side: "axis", units: ["a1"], to: "K33" })).state;
    const r = okOf(applyAction(CTX, s, combine(["a1", "a2"])));
    expect(r.state.units.u100).toMatchObject({ strength: 5, at: "K33" });
    expect(airOf(r.state).staged).toContain("u100");
    expect(errorOf(applyAction(CTX, r.state, { type: "STAGE_AIR", side: "axis", units: ["u100"], to: "J32" }))).toMatch(/already staged/);
  });
});

describe("the rest of the game does not notice", () => {
  it("are not in legalActions, and the counter sizes are those of air combat's break-down", () => {
    const s = board([air("a1", "J32", 5), inf("u1", "germany", "L32", 3, 3)]);
    expect(legalActions(CTX, s).some((a) => a.type === "SPLIT_AIR" || a.type === "COMBINE_AIR")).toBe(false);
    expect(AIR_COMBAT_RULES.counterSizes).toEqual([1, 2, 3, 5]);
  });
  it("split then combine returns the same factors in one hex, with fresh ids", () => {
    const s = board([air("a1", "J32", 5)]);
    const halves = okOf(applyAction(CTX, s, split("a1", [3, 2]))).state;
    const back = okOf(applyAction(CTX, halves, combine(["u100", "u101"]))).state;
    expect(Object.values(back.units).map((u) => [u.strength, u.at, u.owner, u.movement])).toEqual([[5, "J32", "germany", 4]]);
    expect(Object.keys(back.units)).toEqual(["u102"]);
  });
});
