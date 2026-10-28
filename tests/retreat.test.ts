import { describe, expect, it } from "vitest";
import { neighborIds } from "../src/engine/attack-rules";
import { retreatOptions, retreatProblem } from "../src/engine/retreat";
import { enemyZocFor } from "../src/engine/zoc";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Ref 12.4, 5.0, 26.0; spec 16 R6, AER6. These queries report choices; later actions handle elimination and control changes.
const french = (at = "M33") => counter("f1", "france", "infantry", 2, at, 3);
describe("one-hex Attrition retreats (Ref 12.4; spec 16 R6)", () => {
  it("allows friendly and vacant enemy land, even enemy ZOC", () => {
    const s = board([french(), counter("g1", "germany", "armor", 3, "L32", 4)]);
    expect(enemyZocFor(CTX, s, "allies").has("M32")).toBe(true);
    expect(retreatOptions(CTX, s, "f1")).toContain("M32");
    expect(retreatOptions(CTX, s, "f1")).toContain("M34");
  });

  it("allows a Crossing Arrow and a vacant enemy fortress (AER6)", () => {
    const arrow = board([counter("b1", "britain", "infantry", 3, "DD22", 3)], undefined, { control: { DD21: "germany" } });
    expect(retreatOptions(CTX, arrow, "b1")).toContain("DD21");
    const fort = board([french("P23")], undefined, { control: { P24: "germany" }, fortresses: { P24: true } });
    expect(retreatOptions(CTX, fort, "f1")).toContain("P24");
  });

  it("allows overstacking; a retreat does not use movement's endpoint capacity check", () => {
    const s = board([french(), counter("f2", "france", "infantry", 2, "M34"), counter("f3", "france", "infantry", 2, "M34")]);
    expect(retreatOptions(CTX, s, "f1")).toContain("M34");
  });

  it.each(["infantry", "air", "fleet", "airbase"] as const)("rejects a hex occupied by an enemy %s", (type) => {
    const s = board([french(), counter("g1", "germany", type, 1, "M32")]);
    expect(retreatOptions(CTX, s, "f1")).not.toContain("M32");
    expect(retreatProblem(CTX, s, "f1", "M32")).toMatch(/holds/);
  });

  it("rejects land nobody controls, neutral land, open water, Qattara and non-adjacent hexes", () => {
    const s = board([french()], undefined, { control: { M32: null, M34: "ussr" } });
    expect(retreatProblem(CTX, s, "f1", "M32")).toMatch(/controlled by either side/);
    expect(retreatProblem(CTX, s, "f1", "M34")).toMatch(/controlled by either side/);
    expect(retreatProblem(CTX, s, "f1", "O22")).toMatch(/one land hexside/);
    const channel = board([french("K24")]);
    expect(retreatOptions(CTX, channel, "f1")).not.toContain("L24");
    const qattara = board([french("MM26")]);
    expect(retreatOptions(CTX, qattara, "f1")).not.toContain("NN26");
  });

  it("refuses British retreat into Paris while the stop ban holds", () => {
    const s = board([counter("b1", "britain", "infantry", 3, "N22", 3)]);
    expect(retreatProblem(CTX, s, "b1", "O22")).toMatch(/British units may not stop/);
    expect(retreatOptions(CTX, { ...s, year: 1942 }, "b1")).toContain("O22");
  });

  it("preserves the separate British/French sharing ban, without rejecting overstacking after 1942", () => {
    const s = board([counter("b1", "britain", "infantry", 3, "N22", 3), french("O21"), counter("f2", "france", "infantry", 3, "O21")]);
    expect(retreatProblem(CTX, s, "b1", "O21")).toMatch(/may not stack together/);
    expect(retreatProblem(CTX, { ...s, year: 1942 }, "b1", "O21")).toBeNull();
  });

  it("returns no choices for a surrounded unit, leaving elimination to the caller", () => {
    const enemies = neighborIds(CTX, "M33").map((at, i) => counter(`g${i}`, "germany", "airbase", 0, at));
    const s = board([french(), ...enemies]); const before = JSON.stringify(s);
    expect(retreatOptions(CTX, s, "f1")).toEqual([]);
    expect(s.units.f1).toBeDefined();
    expect(JSON.stringify(s)).toBe(before);
  });

  it("allows Replacement retreats but leaves air relocation to another rule", () => {
    const s = board([counter("r1", "france", "replacement", 1, "M33"), counter("a1", "france", "air", 1, "M33")]);
    expect(retreatOptions(CTX, s, "r1")).toContain("M34");
    expect(retreatOptions(CTX, s, "a1")).toEqual([]);
    expect(retreatOptions(CTX, s, "missing")).toEqual([]);
  });
});
