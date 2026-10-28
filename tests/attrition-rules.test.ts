import { describe, expect, it } from "vitest";
import { attritionColumn } from "../src/engine/combat";
import { combatOf } from "../src/engine/combat-record";
import { attritionColumnOf, attritionFronts, attritionHexProblem, attritionLossProblem, attritionParticipantProblem, attritionParticipants, lossCandidates, occupiersOf, occupationProblem, selectableHexes } from "../src/engine/attrition";
import { crossable, neighborIds } from "../src/engine/attack-rules";
import type { GameContext } from "../src/engine/context";
import type { GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Ref 12.4; spec 16 R2 to R7, AER1 to AER8/AER11. Queries never apply losses, retreat, occupation or turn limits.
const g = (id: string, at: string, strength = 3, type: Unit["type"] = "infantry") => counter(id, "germany", type, strength, at, 3);
const p = (id: string, at: string, type: Unit["type"] = "infantry") => counter(id, "poland", type, 2, at, 3);
const base = (units: Unit[], extra: Partial<GameState> = {}) => board(units, undefined, { activeSide: "axis", ...extra });
const ids = (units: Unit[]) => units.map((u) => u.id);
function target(to: string, ctx = CTX): { s: GameState; participants: Unit[] } {
  const from = neighborIds(ctx, to).find((h) => crossable(ctx, h, to))!;
  const attacker = g("g1", from);
  return { s: base([attacker, counter("f1", "france", "infantry", 2, to, 3)]), participants: [attacker] };
}

describe("Attrition participants and totals (spec 16 R2; Ref 12.4, 19.4, 22.0)", () => {
  it("counts printed factors once, including airborne and unsupplied units, not Replacements (AER1/AER2)", () => {
    const s = base([g("g1", "M32", 6, "armor"), g("g2", "N32", 2, "airborne"), g("g3", "M32", 1, "replacement"), p("p1", "M33"), p("p2", "N33")], { unsuppliedAtStart: ["g1"], fortresses: { M33: true } });
    const result = attritionParticipants(CTX, s, "eastern");
    expect(ids(result.units)).toEqual(["g1", "g2"]);
    expect(result.factors).toBe(8);
    expect(attritionParticipantProblem(CTX, s, s.units.g3!, "eastern")).toMatch(/Replacements/);
  });

  it("uses the enemy hex's Front, not the participant's (AER3)", () => {
    const s = base([g("g1", "M32"), p("p1", "M33")]);
    expect(CTX.map.hexes.M32!.front).toBe("western");
    expect(CTX.map.hexes.M33!.front).toBe("eastern");
    expect(attritionParticipants(CTX, s, "eastern").factors).toBe(3);
    expect(attritionParticipants(CTX, s, "western").units).toEqual([]);
    expect(attritionParticipantProblem(CTX, s, s.units.g1!, "western")).toMatch(/no land contact/);
  });

  it("omits excluded/used units and those already used in an Offensive attack (AER8)", () => {
    const s = base([g("g1", "M32"), g("g2", "N32"), p("p1", "M33")]);
    expect(attritionParticipants(CTX, s, "eastern", ["g1"]).factors).toBe(3);
    const fought = { ...s, combat: { ...combatOf(s), attacked: ["g2"] } };
    expect(ids(attritionParticipants(CTX, fought, "eastern", ["g1"]).units)).toEqual([]);
    expect(attritionParticipantProblem(CTX, fought, s.units.g2!, "eastern")).toMatch(/already been used/);
  });

  it("allows contact across a Crossing Arrow, but not open water or Qattara", () => {
    const arrow = board([counter("b1", "britain", "infantry", 3, "DD22", 3), g("g1", "DD21")], undefined, { activeSide: "allies" });
    expect(attritionParticipants(CTX, arrow, "mediterranean").factors).toBe(3);
    expect(attritionParticipants(CTX, base([g("g1", "J36"), p("p1", "J35")]), "eastern").units).toEqual([]);
    expect(attritionParticipants(CTX, base([g("g1", "MM26"), counter("b1", "britain", "infantry", 3, "NN26")]), "mediterranean").units).toEqual([]);
  });

  it("requires an enemy ground unit, not only an air unit or a friendly/neutral unit", () => {
    for (const other of [p("a1", "M33", "air"), g("g2", "M33"), counter("r1", "ussr", "infantry", 3, "M33")]) {
      const s = base([g("g1", "M32"), other]);
      expect(attritionParticipants(CTX, s, "eastern").units).toEqual([]);
    }
  });

  it("lists only unresolved Attrition Fronts with participants (R1/R2; AER9)", () => {
    const s = base([g("g1", "M32"), p("p1", "M33")], { frontOptions: { eastern: { option: "attrition" }, western: { option: "attrition" } } });
    expect(attritionFronts(CTX, s)).toEqual(["eastern"]);
    expect(attritionFronts(CTX, s, ["eastern"])).toEqual([]);
    expect(attritionFronts(CTX, { ...s, frontOptions: { eastern: { option: "offensive" } } })).toEqual([]);
  });

  it("reuses the existing column function, including zero factors (R3)", () => {
    expect(attritionColumnOf).toBe(attritionColumn);
    for (const factors of [0, 1, 10, 11, 20, 21, 60, 61, 100]) expect(attritionColumnOf(factors)).toEqual(attritionColumn(factors));
  });
});

describe("defender losses on the whole Front (spec 16 R4; Ref 12.4, 22.0; AER4/AER5)", () => {
  const s = base([g("g1", "M32"), p("p1", "M33"), p("p2", "M35", "replacement"), p("p3", "N35"), p("air", "M34", "air"), p("west", "M31"), counter("f1", "france", "infantry", 2, "M34"), counter("r1", "ussr", "infantry", 3, "R40")]);
  const participants = [s.units.g1!];
  it("includes non-contact units and Replacements, excludes air, other Fronts and nations not at war", () => {
    expect(ids(lossCandidates(CTX, s, "eastern", participants))).toEqual(["f1", "p1", "p2", "p3"]);
  });
  it("takes all when fewer than the rolled losses exist, and refuses wrong counts or duplicate/non-candidates", () => {
    const candidates = ["f1", "p1", "p2", "p3"];
    expect(attritionLossProblem(CTX, s, "eastern", participants, 8, candidates)).toBeNull();
    expect(attritionLossProblem(CTX, s, "eastern", participants, 8, ["p1"])).toMatch(/exactly 4/);
    expect(attritionLossProblem(CTX, s, "eastern", participants, 2, ["p1", "p1"])).toMatch(/distinct/);
    expect(attritionLossProblem(CTX, s, "eastern", participants, 1, ["air"])).toMatch(/eligible enemy ground/);
    expect(attritionLossProblem(CTX, s, "eastern", [], 8, [])).toBeNull();
  });
});

describe("hex selection and occupation (spec 16 R5/R7; Ref 12.4, 4.7, 4.8, 19.4)", () => {
  it("offers an ordinary enemy hex and returns its reason again after losses empty it (AER11)", () => {
    const s = base([g("g1", "M32"), p("p1", "M33")]);
    const participants = [s.units.g1!];
    expect(selectableHexes(CTX, s, "eastern", participants).get("M33")).toBeNull();
    const afterLoss = { ...s, units: { g1: s.units.g1! } };
    expect(selectableHexes(CTX, afterLoss, "eastern", participants).get("M33")).toMatch(/no enemy ground unit/);
    expect(attritionHexProblem(CTX, { ...s, units: { g1: s.units.g1!, air: p("air", "M33", "air") } }, "eastern", "M33", participants)).toMatch(/no enemy ground unit/);
  });

  it.each(["capital", "capital-port", "objective"] as const)("excludes a real map %s", (feature) => {
    const h = Object.values(CTX.map.hexes).find((h) => h.features.includes(feature))!;
    const { s, participants } = target(h.id);
    expect(attritionHexProblem(CTX, s, h.front, h.id, participants)).toMatch(/capital or Objective/);
  });

  it("uses current fortress status, not the printed fortress, at Metz", () => {
    const { s, participants } = target("P24");
    expect(attritionHexProblem(CTX, { ...s, fortresses: { P24: true } }, "western", "P24", participants)).toMatch(/fortress/);
    expect(attritionHexProblem(CTX, { ...s, fortresses: { P24: false } }, "western", "P24", participants)).toBeNull();
  });

  it("excludes bridgeheads and hexes on another Front", () => {
    const { s, participants } = target("M33");
    expect(attritionHexProblem(CTX, s, "western", "M33", participants)).toMatch(/not on the Attritioned Front/);
    const bridgehead = counter("bh", "france", "bridgehead", 0, "M33");
    expect(attritionHexProblem(CTX, { ...s, units: { ...s.units, bh: bridgehead } }, "eastern", "M33", participants)).toMatch(/bridgehead/);
  });

  it("keeps Luxembourg selectable even if its future map data marks it a capital (AER7)", () => {
    const ctx: GameContext = { ...CTX, map: { ...CTX.map, hexes: { ...CTX.map.hexes, O25: { ...CTX.map.hexes.O25!, features: ["capital"] } } } };
    const { s, participants } = target("O25", ctx);
    expect(attritionHexProblem(ctx, s, "western", "O25", participants)).toBeNull();
  });

  it("permits Crossing Arrow contact, but excludes an Arrow-only destination and its occupiers", () => {
    const b1 = counter("b1", "britain", "infantry", 3, "DD22", 3);
    const s = board([b1, g("g1", "DD21")], undefined, { activeSide: "allies" });
    expect(attritionHexProblem(CTX, s, "mediterranean", "DD21", [b1])).toMatch(/Crossing Arrow/);
    expect(occupiersOf(CTX, s, "DD21", [b1])).toEqual([]);
  });

  it("rejects cut-off units and Replacements as occupiers, without imposing stacking capacity", () => {
    const s = base([g("g1", "M32"), g("g2", "N32"), g("g3", "M32", 1, "replacement"), p("p1", "M33")], { unsuppliedAtStart: ["g1"] });
    expect(ids(occupiersOf(CTX, s, "M33", [s.units.g1!, s.units.g2!, s.units.g3!]))).toEqual(["g2"]);
    expect(occupationProblem(CTX, s, s.units.g1!, "M33")).toMatch(/cut off/);
    expect(attritionHexProblem(CTX, s, "eastern", "M33", [s.units.g1!])).toMatch(/No eligible participant/);
    const many = base([g("g1", "M32"), g("g2", "M32"), g("g3", "M32")]);
    expect(occupiersOf(CTX, many, "M33", Object.values(many.units))).toHaveLength(3);
  });

  it("uses current participant positions, ignores dead ones and keeps attacked minors in their country", () => {
    const original = g("g1", "M32");
    const s = base([{ ...original, at: "A10" }]);
    expect(occupiersOf(CTX, s, "M33", [original, g("dead", "M32")])).toEqual([]);
    const polish = p("p1", "M33");
    expect(occupationProblem(CTX, board([polish]), polish, "M32")).toMatch(/own country/);
  });

  it("rechecks targets from current positions after a first occupation (R5; AER11)", () => {
    const s = base([g("g1", "M32"), p("p1", "M33"), p("p2", "M34")]);
    const participants = [s.units.g1!];
    expect(selectableHexes(CTX, s, "eastern", participants).has("M34")).toBe(false);
    const after = { ...s, units: { g1: { ...s.units.g1!, at: "M33" }, p2: s.units.p2! } };
    expect(selectableHexes(CTX, after, "eastern", participants).get("M34")).toBeNull();
  });

  it("never changes the position or eliminates units", () => {
    const { s, participants } = target("M33"); const before = JSON.stringify(s);
    selectableHexes(CTX, s, "eastern", participants); lossCandidates(CTX, s, "eastern", participants); occupiersOf(CTX, s, "M33", participants);
    expect(JSON.stringify(s)).toBe(before);
  });
});
