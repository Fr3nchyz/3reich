import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { controllerOf } from "../src/engine/control";
import { GROUND_MOVERS, ONE_MOVE_PER_TURN, TERRAIN_MOVE_COST, movementFactor, reachableHexes } from "../src/engine/movement";
import { adjacentHexes, zocPathProblem } from "../src/engine/zoc";
import { CTX, ctxFor } from "./helpers";
import { at6f, errorOf, inf, move, okOf } from "./helpers-move";

// Step 6f, ground movement (Ref 5.45f; hexsides Ref 4.3, 4.6, 4.51; ZOC Ref 6.0; stacking Ref 5.0, 26.0; control Ref 7.0).
// Positions are on the real map: L32-L33-L34-L35 is a row of German then Polish plain, M34 is Polish plain next to
// L34 and L35, M32-N31 a river hexside inside Germany, MM26-NN26 and NN25-NN26 Qattara hexsides, K24-L24 the Channel.

describe("movement factor and cost (Ref 5.45f)", () => {
  it("a unit goes as many hexes as its movement factor, one hex per point", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 3)]);
    expect(okOf(move(s, ["u1"], ["L33", "L34", "L35"])).state.units.u1!.at).toBe("L35");
    expect(errorOf(move(s, ["u1"], ["L33", "L34", "L35", "L36"]))).toMatch(/costs 4 movement points; the slowest unit has 3/);
    const slow = at6f([inf("u1", "germany", "L32", 3, 2)]);
    expect(errorOf(move(slow, ["u1"], ["L33", "L34", "L35"]))).toMatch(/costs 3/);
  });

  it("the reachable set is exactly the hexes within the factor on open ground", () => {
    const s = at6f([inf("u1", "germany", "M31", 3, 2)]);
    const reach = reachableHexes(CTX, s, [s.units.u1!]);
    expect(reach.size).toBeGreaterThan(6);
    for (const path of reach.values()) expect(path.length).toBeLessThanOrEqual(2);
    for (const n of adjacentHexes(CTX, "M31")) if (MAP.hexes[n]!.land && n !== "L32") expect(reach.has(n)).toBe(true);
  });

  it("terrain costs 1 everywhere until the chart is read (TODO(verify) in movement.ts); mountains are not dearer", () => {
    expect(Object.values(TERRAIN_MOVE_COST)).toEqual([1, 1, 1, 1]);
    expect(MAP.hexes.Q32!.land).toBe("mountains");
    const s = at6f([inf("u1", "germany", "Q31", 3, 2)]);
    expect(reachableHexes(CTX, s, [s.units.u1!]).get("Q32")).toEqual(["Q32"]);
  });

  it("only infantry, armor and airborne with a movement factor move on the ground", () => {
    expect(GROUND_MOVERS).toEqual(["infantry", "armor", "airborne"]);
    expect(movementFactor({ type: "replacement", movement: undefined })).toBe(0);
    expect(movementFactor({ type: "air", movement: 4 })).toBe(0);
    expect(movementFactor({ type: "infantry", movement: Number.NaN })).toBe(0);
    expect(movementFactor({ type: "armor", movement: 6 })).toBe(6);
    const s = at6f([inf("u1", "germany", "L32", 4, 4, "air"), inf("u2", "germany", "L33", 2, 0, "replacement")]);
    expect(errorOf(move(s, ["u1"], ["L33"]))).toMatch(/no ground movement factor/);
    expect(errorOf(move(s, ["u2"], ["L32"]))).toMatch(/no ground movement factor/);
  });

  it("a stack moves at its slowest unit's factor", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 3), inf("u2", "germany", "L32", 4, 6, "armor")]);
    expect(okOf(move(s, ["u1", "u2"], ["L33", "L34", "L35"])).state.units.u2!.at).toBe("L35");
    expect(errorOf(move(s, ["u1", "u2"], ["L33", "L34", "L35", "L36"]))).toMatch(/the slowest unit has 3/);
    expect(okOf(move(s, ["u2"], ["L33", "L34", "L35", "L36"])).state.units.u2!.at).toBe("L36");
  });

  it("units in different hexes cannot move as one stack", () => {
    const s = at6f([inf("u1", "germany", "L32"), inf("u2", "germany", "L33")]);
    expect(errorOf(move(s, ["u1", "u2"], ["L34"]))).toMatch(/only units in one hex move as a stack/);
  });
});

describe("hexsides (Ref 4.3, 4.6, 4.51)", () => {
  it("a river does not stop a move (M32 to N31, both German)", () => {
    expect(MAP.hexsides["M32-N31"]!.river).toBe(true);
    const s = at6f([inf("u1", "germany", "M32")]);
    expect(okOf(move(s, ["u1"], ["N31"])).state.units.u1!.at).toBe("N31");
  });

  it("the Qattara Depression cannot be entered from any side", () => {
    const s = at6f([inf("u1", "britain", "MM26"), inf("u2", "britain", "NN25"), inf("u3", "britain", "MM27")], "allies");
    for (const id of ["u1", "u2", "u3"]) expect(errorOf(move(s, [id], ["NN26"])), id).toMatch(/water or the Qattara/);
    for (const id of ["u1", "u2", "u3"]) for (const hex of reachableHexes(CTX, s, [s.units[id]!]).keys()) expect(hex).not.toBe("NN26");
    expect(okOf(move(s, ["u1"], ["MM27"])).state.units.u1!.at).toBe("MM27"); // the rest of Egypt is open
  });

  it("the Channel is water: Harwich cannot step to Calais", () => {
    const s = at6f([inf("u1", "britain", "K24")], "allies");
    expect(adjacentHexes(CTX, "K24")).toContain("L24");
    expect(errorOf(move(s, ["u1"], ["L24"]))).toMatch(/water or the Qattara/);
    expect(reachableHexes(CTX, s, [s.units.u1!]).has("L24")).toBe(false);
  });

  it("a crossing arrow is crossed both ways: Messina (1942, Italian one way, British the other)", () => {
    const ctx = ctxFor(SCENARIO_1942);
    expect(MAP.hexsides["DD21-DD22"]!.crossingArrow).toBe(true);
    const axis = at6f([inf("u1", "italy", "DD21")], "axis", SCENARIO_1942);
    expect(okOf(move(axis, ["u1"], ["DD22"], ctx)).state.units.u1!.at).toBe("DD22");
    const allies = at6f([inf("u2", "britain", "DD22")], "allies", SCENARIO_1942);
    expect(okOf(move(allies, ["u2"], ["DD21"], ctx)).state.units.u2!.at).toBe("DD21");
  });

  it("a path must be hexes next to each other, never repeating or returning to the start", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 5)]);
    expect(errorOf(move(s, ["u1"], ["L34"]))).toMatch(/not next to L32/);
    expect(errorOf(move(s, ["u1"], ["L33", "L32"]))).toMatch(/twice/);
    expect(errorOf(move(s, ["u1"], ["L33", "L34", "L33"]))).toMatch(/twice/);
  });
});

describe("Zones of Control (Ref 6.0)", () => {
  const pol = inf("p1", "poland", "M34", 2, 3);

  it("a unit entering an enemy ZOC must stop there", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 5), pol]);
    expect(zocPathProblem(CTX, s, "axis", ["L33", "L34", "L35"])).not.toBeNull();
    expect(okOf(move(s, ["u1"], ["L33", "L34"])).state.units.u1!.at).toBe("L34");
    expect(errorOf(move(s, ["u1"], ["L33", "L34", "L35"]))).toMatch(/must stop there/);
  });

  it("no reachable path passes through a ZOC hex before its end", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 6), pol]);
    const reach = reachableHexes(CTX, s, [s.units.u1!]);
    expect(reach.has("L34")).toBe(true);
    for (const [hex, path] of reach) expect(zocPathProblem(CTX, s, "axis", path), hex).toBeNull();
  });

  it("starting in an enemy ZOC is free: the unit may leave it, even into another ZOC", () => {
    const s = at6f([inf("u1", "germany", "L34", 3, 4), pol]);
    expect(okOf(move(s, ["u1"], ["L33", "L32", "L31"])).state.units.u1!.at).toBe("L31");
    expect(okOf(move(s, ["u1"], ["L35"])).state.units.u1!.at).toBe("L35");
    expect(errorOf(move(s, ["u1"], ["L35", "L36"]))).toMatch(/must stop there/);
  });

  it("a friendly ground unit in the hex cancels the ZOC there (ZOC_POLICY.friendlyUnitNegates, TODO(verify))", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 5), inf("u2", "germany", "L34"), pol]);
    expect(okOf(move(s, ["u1"], ["L33", "L34", "L35"])).state.units.u1!.at).toBe("L35");
  });

  it("an enemy unit's hex cannot be entered: that is an attack", () => {
    const s = at6f([inf("u1", "germany", "M33", 3, 3), pol]);
    expect(errorOf(move(s, ["u1"], ["M34"]))).toMatch(/holds p1 of the other side/);
    expect(reachableHexes(CTX, s, [s.units.u1!]).has("M34")).toBe(false);
  });
});

describe("stacking at the end of a move (Ref 5.0, 26.0)", () => {
  it("refuses to end in a hex that would hold a third ground unit, naming the hex", () => {
    const s = at6f([inf("u1", "germany", "L32"), inf("u2", "germany", "L33"), inf("u3", "germany", "L33")]);
    expect(errorOf(move(s, ["u1"], ["L33"]))).toMatch(/L33 already holds 2 ground units \(limit 2\)/);
  });

  it("allows passing through a full hex and ending beyond it", () => {
    const s = at6f([inf("u1", "germany", "L32"), inf("u2", "germany", "L33"), inf("u3", "germany", "L33")]);
    expect(okOf(move(s, ["u1"], ["L33", "L34"])).state.units.u1!.at).toBe("L34");
    expect(reachableHexes(CTX, s, [s.units.u1!]).has("L33")).toBe(true); // reachable to pass through, though not to end in
  });

  it("a stack of two cannot end on a hex that holds one, but a lone unit can", () => {
    const s = at6f([inf("u1", "germany", "L32"), inf("u2", "germany", "L32"), inf("u3", "germany", "L33")]);
    expect(errorOf(move(s, ["u1", "u2"], ["L33"]))).toMatch(/L33 already holds 2 ground units \(limit 2\)/);
    expect(okOf(move(s, ["u1"], ["L33"])).state.units.u1!.at).toBe("L33");
  });

  it("British and French may not share a hex before 1942 (Ref 26.0), and may in 1942", () => {
    const units = [inf("u1", "britain", "P22"), inf("u2", "france", "O23")];
    expect(errorOf(move(at6f(units, "allies"), ["u1"], ["O23"]))).toMatch(/British and French units may not stack together before 1942/);
    expect(okOf(move(at6f(units, "allies", undefined, { year: 1942 }), ["u1"], ["O23"])).state.units.u1!.at).toBe("O23");
  });
});

describe("one move per unit per Player Turn", () => {
  it("a unit that has moved cannot move again; the record is for this Player Turn only", () => {
    expect(ONE_MOVE_PER_TURN).toBe(true);
    const s1 = okOf(move(at6f([inf("u1", "germany", "L32"), inf("u2", "germany", "M31")]), ["u1"], ["L33"])).state;
    expect(errorOf(move(s1, ["u1"], ["L34"]))).toMatch(/already moved this Player Turn/);
    expect(okOf(move(s1, ["u2"], ["M32"])).state.units.u2!.at).toBe("M32");
    // The next Game Turn (the key names year, season and side) starts afresh without anything clearing the record.
    expect(okOf(move({ ...s1, season: "summer" }, ["u1"], ["L34"])).state.units.u1!.at).toBe("L34");
    expect(okOf(move({ ...s1, year: 1940 }, ["u1"], ["L34"])).state.units.u1!.at).toBe("L34");
  });
});

describe("neutral land and units of other sides", () => {
  it("land of a neutral minor country cannot be entered until the war is declared on it", () => {
    const s = at6f([inf("u1", "germany", "M27")]);
    expect(MAP.hexes.M26!.country).toBe("belgium");
    expect(errorOf(move(s, ["u1"], ["M26"]))).toMatch(/neutral land/);
    const war = { ...s, wars: [...s.wars, ["germany", "belgium"] as ["germany", "belgium"]] };
    const r = okOf(move(war, ["u1"], ["M26"]));
    expect(r.state.units.u1!.at).toBe("M26");
    expect(controllerOf(CTX, r.state, "M26")).toBe("germany");
  });

  it("units of a power that is not in the war (Italy in 1939) do not move", () => {
    const s = at6f([inf("u1", "italy", "Y22")]);
    expect(errorOf(move(s, ["u1"], ["Y23"]))).toMatch(/does not move for the axis side now/);
  });

  it("the side to move moves only its own units", () => {
    const s = at6f([inf("u1", "britain", "K23")], "axis");
    expect(errorOf(move(s, ["u1"], ["K22"]))).toMatch(/does not move for the axis side/);
    expect(errorOf(move(s, ["u1"], ["K22"], CTX, "allies"))).toMatch(/It is the axis player turn/);
  });
});

describe("control of hexes through a move (Ref 7.0, via enterHexes)", () => {
  it("entering enemy hexes takes them, one event each, passing through included", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 4)]);
    const r = okOf(move(s, ["u1"], ["L33", "L34", "L35"]));
    expect(r.events.map((e) => e.type)).toEqual(["UNITS_MOVED", "HEX_CONTROL_CHANGED", "HEX_CONTROL_CHANGED"]);
    expect(controllerOf(CTX, r.state, "L34")).toBe("germany");
    expect(controllerOf(CTX, r.state, "L35")).toBe("germany");
    expect(controllerOf(CTX, r.state, "L33")).toBe("germany");
    expect(r.events[0]).toMatchObject({ type: "UNITS_MOVED", units: ["u1"], from: "L32", to: "L35", path: ["L33", "L34", "L35"] });
  });

  it("moving inside friendly land changes nothing", () => {
    const r = okOf(move(at6f([inf("u1", "germany", "L32")]), ["u1"], ["L33"]));
    expect(r.events.map((e) => e.type)).toEqual(["UNITS_MOVED"]);
    expect(r.state.control).toEqual({});
  });
});
