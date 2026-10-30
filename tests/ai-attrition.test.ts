import { describe, expect, it } from "vitest";
import { chooseAttritionHex, chooseAttritionLosses, chooseOccupiers, chooseRetreat } from "../src/ai/attrition";
import { attritionHexProblem, attritionLossProblem, attritionParticipants, occupationProblem } from "../src/engine/attrition";
import { retreatOptions, retreatProblem } from "../src/engine/retreat";
import { stackingProblem } from "../src/engine/placement";
import { neighborIds } from "../src/engine/attack-rules";
import type { Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

const g = (id: string, strength = 3, type: Unit["type"] = "infantry", at = "M32") => counter(id, "germany", type, strength, at, 3);
const p = (id: string, strength = 2, at = "M33", type: Unit["type"] = "infantry", movement?: number) => counter(id, "poland", type, strength, at, movement);
const position = (units: Unit[]) => board(units, undefined, { activeSide: "axis", fortresses: {} });

describe("Attrition policy (spec 16 Part E, R4–R7; AER47)", () => {
  it("R4 orders Replacements, strength, missing movement, distance and id; caps losses", () => {
    const s = position([g("g"), p("rep", 8, "M35", "replacement"), p("weak", 1),
      p("fast", 2, "M35", "infantry", 4), p("near", 2, "M35"), p("z", 2), p("a", 2),
      p("air", 1, "M34", "air"), p("west", 1, "M31")]);
    const before = JSON.stringify(s);
    for (const n of [0, 1, 3, 99]) {
      const ids = chooseAttritionLosses(CTX, s, "eastern", n);
      expect(ids).toEqual(["rep", "weak", "a", "z", "near", "fast"].slice(0, n));
      expect(attritionLossProblem(CTX, s, "eastern", attritionParticipants(CTX, s, "eastern").units, n, ids)).toBeNull();
      expect(chooseAttritionLosses(CTX, s, "eastern", n)).toEqual(ids);
    }
    expect(JSON.stringify(s)).toBe(before);
    expect(chooseAttritionLosses(CTX, position([g("g")]), "eastern", 3)).toEqual([]);
  });

  it("R7 uses the smallest safe set, strongest preferred counters, and stable id ties", () => {
    const s = position([g("z", 3), g("a", 3, "armor"), g("weak", 1), p("threat", 10, "M34")]);
    const units = [s.units.z!, s.units.weak!, s.units.a!];
    const before = JSON.stringify(s);
    const ids = chooseOccupiers(CTX, s, "M33", units);
    expect(ids).toEqual(["a", "z"]);
    let placed = s;
    for (const id of ids) {
      const u = s.units[id]!;
      expect(occupationProblem(CTX, s, u, "M33")).toBeNull();
      expect(stackingProblem(CTX, placed, u.owner, u, "M33")).toBeNull();
      placed = { ...placed, units: { ...placed.units, [id]: { ...u, at: "M33" } } };
    }
    expect(chooseOccupiers(CTX, s, "M33", units)).toEqual(ids);
    expect(JSON.stringify(s)).toBe(before);
    const quiet = position([g("a", 3), g("z", 6), g("drop", 9, "airborne")]);
    expect(chooseOccupiers(CTX, quiet, "M33", Object.values(quiet.units))).toEqual(["z"]);
  });

  it("R7 forces the strongest single unit if safety needs an overstack; filters ineligible units", () => {
    const s = position([g("z", 3), g("a", 3), g("third", 2), g("rep", 8, "replacement"), p("threat", 15, "M34")]);
    expect(chooseOccupiers(CTX, s, "M33", Object.values(s.units).filter((u) => u.owner === "germany"))).toEqual(["a"]);
    expect(chooseOccupiers(CTX, s, "M33", [s.units.rep!])).toEqual([]);
    expect(chooseOccupiers(CTX, { ...s, unsuppliedAtStart: ["a", "z", "third"] }, "M33", Object.values(s.units).filter((u) => u.owner === "germany"))).toEqual([]);
  });

  it("R5 selects safe hexes by expelled factors then hex order; stops and re-judges", () => {
    const s = position([g("g", 6), p("one", 1), p("two", 2, "N32")]);
    const participants = [s.units.g!];
    expect(chooseAttritionHex(CTX, s, "eastern", participants, 2)).toBe("M33");
    // N32 is on the other Front, so it cannot displace the eligible target.
    const to = chooseAttritionHex(CTX, s, "eastern", participants, 2)!;
    expect(attritionHexProblem(CTX, s, "eastern", to, participants)).toBeNull();
    expect(chooseAttritionHex(CTX, s, "eastern", participants, 2)).toBe(to);
    expect(chooseAttritionHex(CTX, s, "eastern", participants, 0)).toBeNull();
    const danger = position([...Object.values(s.units), p("threat", 30, "M34")]);
    expect(chooseAttritionHex(CTX, danger, "eastern", participants, 2)).toBeNull();
    expect(chooseAttritionHex(CTX, position([s.units.g!]), "eastern", participants, 2)).toBeNull();
  });

  it("R5 ranks cities before plain hexes, then expelled factors and fixed hex order", () => {
    // Real map around Poznan: city M33 outranks plain L34.
    const s = position([g("g", 20, "infantry", "L33"), p("city", 1, "M33"), p("plain", 8, "L34")]);
    const participants = [s.units.g!];
    expect(CTX.map.hexes.M33!.features).toContain("city");
    expect(chooseAttritionHex(CTX, s, "eastern", participants, 1)).toBe("M33");
  });

  it("R6 chooses a supplied retreat nearest the capital and returns null without options", () => {
    const s = position([p("p", 2, "M34")]);
    const before = JSON.stringify(s);
    const to = chooseRetreat(CTX, s, "p")!;
    expect(to).toBe("M35");
    expect(retreatProblem(CTX, s, "p", to)).toBeNull();
    expect(chooseRetreat(CTX, s, "p")).toBe(to);
    expect(JSON.stringify(s)).toBe(before);
    const blocked = position([s.units.p!, ...neighborIds(CTX, "M34").map((h, i) => g(`block${i}`, 3, "infantry", h))]);
    expect(retreatOptions(CTX, blocked, "p")).toEqual([]);
    expect(chooseRetreat(CTX, blocked, "p")).toBeNull();
    expect(chooseRetreat(CTX, s, "missing")).toBeNull();
  });
  it("R5 breaks city ties by expelled factors, then fixed hex order", () => {
    const s = position([g("g", 10, "infantry", "M34"), p("m", 1), p("n", 2, "N33")]);
    const participants = [s.units.g!];
    expect(chooseAttritionHex(CTX, s, "eastern", participants, 1)).toBe("N33");
    const tied = { ...s, units: { ...s.units, n: { ...s.units.n!, strength: 1 } } };
    expect(chooseAttritionHex(CTX, tied, "eastern", participants, 1)).toBe("M33");
    for (const state of [s, tied]) {
      const to = chooseAttritionHex(CTX, state, "eastern", participants, 1)!;
      expect(attritionHexProblem(CTX, state, "eastern", to, participants)).toBeNull();
    }
  });

  it("R6 prefers fewer enemy factors over capital proximity; fixed hex ties", () => {
    const s = position([p("p", 2, "M34"), g("enemy", 3, "infantry", "L35")]);
    const to = chooseRetreat(CTX, s, "p")!;
    expect(to).toBe("N34");
    expect(retreatProblem(CTX, s, "p", to)).toBeNull();
    expect(chooseRetreat(CTX, s, "p")).toBe(to);
  });

  it("R6 prioritizes supply over capital distance on isolated controlled hexes", () => {
    const s = { ...position([p("p", 2, "M34")]),
      control: { ...Object.fromEntries(Object.keys(CTX.map.hexes).map((h) => [h, null])), M33: "poland" as const, N34: "poland" as const },
      fortresses: { M33: true } };
    expect(retreatOptions(CTX, s, "p").sort()).toEqual(["M33", "N34"]);
    expect(chooseRetreat(CTX, s, "p")).toBe("M33");
    expect(retreatProblem(CTX, s, "p", "M33")).toBeNull();
    expect(chooseRetreat(CTX, s, "p")).toBe("M33");
  });

  it("R6 breaks equal supply, threat and capital-distance ties by hex id", () => {
    const s = { ...position([p("p", 2, "M34")]),
      control: { ...Object.fromEntries(Object.keys(CTX.map.hexes).map((h) => [h, null])), M33: "poland" as const, N33: "poland" as const } };
    expect(retreatOptions(CTX, s, "p").sort()).toEqual(["M33", "N33"]);
    expect(chooseRetreat(CTX, s, "p")).toBe("M33");
    expect(retreatProblem(CTX, s, "p", "M33")).toBeNull();
    expect(chooseRetreat(CTX, s, "p")).toBe("M33");
  });

  it("R4 ties owners without a printed capital at distance zero (AER47)", () => {
    const s = position([g("g"), counter("a", "free-france", "infantry", 2, "M35"),
      counter("z", "free-france", "infantry", 2, "M33")]);
    const ids = chooseAttritionLosses(CTX, s, "eastern", 1);
    expect(ids).toEqual(["a"]);
    expect(attritionLossProblem(CTX, s, "eastern", attritionParticipants(CTX, s, "eastern").units, 1, ids)).toBeNull();
    expect(chooseAttritionLosses(CTX, s, "eastern", 1)).toEqual(ids);
  });

});
