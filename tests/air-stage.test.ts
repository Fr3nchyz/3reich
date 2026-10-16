import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { airOf, newAirTurn } from "../src/engine/air-record";
import { stagingTargets } from "../src/engine/air-stage";
import { turnKey } from "../src/engine/combat-record";
import type { GameState, Unit } from "../src/engine/types";
import { CTX, atStart, endTurn } from "./helpers";
import { at6f, errorOf, inf, okOf } from "./helpers-move";

// Spec 09, ticket 09-3: staging (rebasing) at step 6f (Ref 20.2, 11.41, 20.1). German bases on the real 1939 map: J30, J32, K28, K29, K32, K33, L31
// (J32 to K33 is 1 hex, J32 to J36 is 4, J36 to K28 is 8, J30 to J36 is 6). Poland holds M33 (Poznan), a Polish city.

const air = (id: string, at: string, strength = 3, owner: Unit["owner"] = "germany"): Unit => inf(id, owner, at, strength, 4, "air");
const stage = (units: string[], to: string): Action => ({ type: "STAGE_AIR", side: "axis", units, to });
const board = (units: Unit[], tweak: Partial<GameState> = {}) => at6f(units, "axis", SCENARIO_1939, { nextUnitId: 100, ...tweak });
const withRecord = (s: GameState, change: Partial<ReturnType<typeof airOf>>): GameState => ({ ...s, air: { ...airOf(s), ...change } });

describe("STAGE_AIR at step 6f", () => {
  it("moves the unit to the new base, records it and says so; control and the other units stay", () => {
    const s = board([air("a1", "J32"), inf("u1", "germany", "L32", 3, 3)]);
    const r = okOf(applyAction(CTX, s, stage(["a1"], "K33")));
    expect(r.state.units.a1!.at).toBe("K33");
    expect(r.state.units.u1).toEqual(s.units.u1);
    expect(airOf(r.state).staged).toEqual(["a1"]);
    expect(r.state.control).toEqual(s.control);
    expect(r.events).toEqual([{ type: "AIR_STAGED", units: ["a1"], from: "J32", to: "K33" }]);
    expect(s.units.a1!.at).toBe("J32"); // the input state is untouched
  });

  it("up to 8 hexes: J36 to K28 is 8, J30 to J36 is 6, and 9 is refused", () => {
    expect(applyAction(CTX, board([air("a1", "J36")]), stage(["a1"], "K28")).ok).toBe(true);
    expect(applyAction(CTX, board([air("a1", "J30")]), stage(["a1"], "J36")).ok).toBe(true);
    const far = board([air("a1", "J36")]);
    expect(errorOf(applyAction(CTX, far, stage(["a1"], "Q27")))).toMatch(/too far/);
  });

  it("units standing together stage together, each counted one at a time against the room (5 air factors a city)", () => {
    const s = board([air("a1", "J32", 3), air("a2", "J32", 2), air("a3", "K33", 3)]);
    expect(errorOf(applyAction(CTX, s, stage(["a1", "a2"], "K33")))).toMatch(/limit/i); // 3 + 3 + 2 = 8 > 5
    const room = board([air("a1", "J32", 2), air("a2", "J32", 2)]);
    const r = okOf(applyAction(CTX, room, stage(["a1", "a2"], "K33")));
    expect(r.state.units.a1!.at).toBe("K33");
    expect(r.state.units.a2!.at).toBe("K33");
    expect(airOf(r.state).staged).toEqual(["a1", "a2"]);
  });

  it("once a Player Turn (ONE_STAGE_PER_TURN)", () => {
    const once = okOf(applyAction(CTX, board([air("a1", "J32")]), stage(["a1"], "K33"))).state;
    expect(errorOf(applyAction(CTX, once, stage(["a1"], "J32")))).toMatch(/already staged/);
    expect(airOf({ ...once, activeSide: "allies" }).staged).toEqual([]); // another Player Turn starts fresh
    const next = okOf(endTurn(CTX, once)).state; // the real thing: the record of the new Player Turn
    expect(next.air!.staged).toEqual([]);
  });

  it("refuses ground units, the other side's air, units apart, the hex they stand in, water, unknown hexes and malformed input", () => {
    const s = board([air("a1", "J32"), air("a2", "K33"), air("p1", "M33", 3, "poland"), inf("u1", "germany", "L32", 3, 3)]);
    expect(errorOf(applyAction(CTX, s, stage(["u1"], "K33")))).toMatch(/not an air unit/);
    expect(errorOf(applyAction(CTX, s, stage(["p1"], "K33")))).toMatch(/does not stage for the axis side/);
    expect(errorOf(applyAction(CTX, s, stage(["a1", "a2"], "K29")))).toMatch(/units stage together from one hex/);
    expect(errorOf(applyAction(CTX, s, stage(["a1"], "J32")))).toMatch(/already are/);
    const sea = Object.values(CTX.map.hexes).find((h) => !h.land)!.id;
    expect(errorOf(applyAction(CTX, s, stage(["a1"], sea)))).toMatch(/not an air base/);
    expect(errorOf(applyAction(CTX, s, stage(["a1"], "ZZ99")))).toMatch(/not on the map/);
    expect(errorOf(applyAction(CTX, s, stage(["zz"], "K33")))).toMatch(/not on the map/);
    expect(errorOf(applyAction(CTX, s, stage([], "K33")))).toMatch(/one or more distinct/);
    expect(errorOf(applyAction(CTX, s, stage(["a1", "a1"], "K33")))).toMatch(/one or more distinct/);
    expect(errorOf(applyAction(CTX, s, { type: "STAGE_AIR", side: "axis", units: ["a1"], to: 5 as unknown as string }))).toMatch(/names a hex/);
    expect(errorOf(applyAction(CTX, s, { type: "STAGE_AIR", side: "allies", units: ["a1"], to: "K33" }))).toMatch(/player turn/);
    expect(errorOf(applyAction(CTX, s, stage(["constructor"], "K33")))).toMatch(/not on the map/);
  });

  it("refuses a hex that is not a base, an enemy base, and any other step", () => {
    const s = board([air("a1", "J32")]);
    const plain = Object.values(CTX.map.hexes).find((h) => h.land && h.features.length === 0 && h.country === "germany")!.id;
    expect(errorOf(applyAction(CTX, s, stage(["a1"], plain)))).toMatch(/not an air base/);
    expect(errorOf(applyAction(CTX, s, stage(["a1"], "M33")))).toMatch(/not held by the axis side/); // Poznan: Polish
    expect(errorOf(applyAction(CTX, { ...s, position: { part: "player-turn", turn: 1, step: "7h" } }, stage(["a1"], "K33")))).toMatch(/step/);
  });

  it("a base taken in this very turn cannot be staged to (Ref 20.2): control as the turn began decides", () => {
    const s = board([air("a1", "J32")]);
    const taken = withRecord({ ...s, control: { ...s.control, K29: "germany" } }, { controlAtStart: { ...s.control, K29: "poland" } });
    expect(errorOf(applyAction(CTX, taken, stage(["a1"], "K29")))).toMatch(/not held by the axis side at the start of its turn/);
    expect(applyAction(CTX, s, stage(["a1"], "K29")).ok).toBe(true);
  });

  it("an airbase set down this turn serves only air of its own nation until the turn ends (Ref 20.1)", () => {
    const plain = Object.values(CTX.map.hexes).find((h) => h.land && h.features.length === 0 && h.country === "germany")!.id;
    const tweak = { nations: { ...SCENARIO_1939.nations, italy: { ...atStart(SCENARIO_1939, 1).nations.italy, status: "axis" as const } } } as Partial<GameState>;
    let s = board([air("g1", "J32", 2), air("i1", "J32", 2, "italy"), { ...air("l1", "J32", 1), nationality: "italy" }], tweak);
    const border = Object.values(CTX.map.hexes).filter((h) => h.land && h.features.length === 0 && h.country === "germany").map((h) => h.id);
    const hex = border.find((h) => h === plain)!;
    s = okOf(applyAction(CTX, s, { type: "PLACE_AIRBASE", owner: "germany", at: hex })).state;
    const near = (id: string) => errorOf(applyAction(CTX, s, stage([id], hex)));
    expect(near("g1")).not.toMatch(/placed this turn/); // German air may use it at once (it may still be out of reach)
    expect(near("i1")).toMatch(/placed this turn: only germany air/);
    expect(near("l1")).not.toMatch(/placed this turn/); // an Italian unit lent to Germany counts as German here
    const next = { ...s, air: { ...airOf(s), turn: "an earlier turn" } }; // the record belongs to another Player Turn: nothing was placed in this one
    expect(errorOf(applyAction(CTX, next, stage(["i1"], hex)))).not.toMatch(/placed this turn/);
  });

  it("a city that also holds the new airbase takes any air of the side (the city is a base in its own right)", () => {
    const tweak = { nations: { ...SCENARIO_1939.nations, italy: { ...atStart(SCENARIO_1939, 1).nations.italy, status: "axis" as const } } } as Partial<GameState>;
    let s = board([air("i1", "J32", 2, "italy")], tweak);
    s = okOf(applyAction(CTX, s, { type: "PLACE_AIRBASE", owner: "germany", at: "K33" })).state; // K33 is a city
    expect(applyAction(CTX, s, stage(["i1"], "K33")).ok).toBe(true);
  });

  it("holes and odd entries in the list of units are refused, never thrown", () => {
    const s = board([air("a1", "J32")]);
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [, "a1"] as unknown as string[];
    expect(errorOf(applyAction(CTX, s, { type: "STAGE_AIR", side: "axis", units: sparse, to: "K33" }))).toMatch(/one or more distinct/);
    expect(errorOf(applyAction(CTX, s, { type: "STAGE_AIR", side: "axis", units: "a1" as unknown as string[], to: "K33" }))).toMatch(/one or more distinct/);
    expect(stagingTargets(CTX, s, sparse)).toEqual([]);
  });

  it("the list of targets agrees with the engine on every hex of the map", () => {
    const s = board([air("a1", "J32", 2), air("a2", "J32", 2), air("b1", "K33", 4)]);
    for (const ids of [["a1"], ["a1", "a2"]]) {
      const listed = new Set(stagingTargets(CTX, s, ids));
      expect(listed.size).toBeGreaterThan(3);
      for (const h of Object.keys(CTX.map.hexes)) expect(applyAction(CTX, s, stage(ids, h)).ok, `${ids.join("+")} -> ${h}`).toBe(listed.has(h));
    }
    expect(stagingTargets(CTX, s, ["u9"])).toEqual([]);
  });

  it("is not in legalActions (the computer does not stage yet) and changes none of the other choices", () => {
    const s = board([air("a1", "J32"), inf("u1", "germany", "L32", 3, 3)]);
    expect(legalActions(CTX, s).some((a) => a.type === "STAGE_AIR")).toBe(false);
    const after = okOf(applyAction(CTX, s, stage(["a1"], "K33"))).state;
    expect(legalActions(CTX, after)).toEqual(legalActions(CTX, s));
  });
});

describe("the air record at the start of a Player Turn", () => {
  it("is begun with the control of that moment and empty lists, for every Player Turn", () => {
    const s = atStart(SCENARIO_1939, 1);
    expect(s.air).toEqual(newAirTurn(s));
    expect(s.air!.turn).toBe(turnKey(s));
    expect(s.air!.staged).toEqual([]);
    const second = okOf(endTurn(CTX, s)).state; // the other side's Player Turn begins
    expect(second.activeSide).not.toBe(s.activeSide);
    expect(second.air!.turn).toBe(turnKey(second));
    expect(second.air!.turn).not.toBe(s.air!.turn);
  });
});
