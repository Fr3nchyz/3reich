import { describe, expect, it } from "vitest";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { angloFrenchHexes, defaultElimination, eliminateOverstack, eliminationProblem, overstacks, overstacksOf } from "../src/engine/stacking";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

const inf = (id: string, at: string, owner: "germany" | "britain" | "france" = "germany", strength = 3) => counter(id, owner, "infantry", strength, at, 4);

// Ref 5.0 limits apply at all times; Ops 5.45g (step 6g) and 5.48j (step 9j): the owner chooses what goes.
describe("overstacked hexes", () => {
  it("two ground units fit, three are over; airborne never count (Ref 5.0)", () => {
    expect(overstacks(CTX, board([inf("u1", "M33"), inf("u2", "M33")]))).toEqual([]);
    const three = board([inf("u1", "M33"), inf("u2", "M33"), inf("u3", "M33")]);
    expect(overstacks(CTX, three)).toEqual([{ hex: "M33", kind: "ground", unitIds: ["u1", "u2", "u3"] }]);
    const jump = board([inf("u1", "M33"), inf("u2", "M33"), counter("u3", "germany", "airborne", 2, "M33", 5), counter("u4", "germany", "airborne", 2, "M33", 5)]);
    expect(overstacks(CTX, jump)).toEqual([]);
  });

  it("replacements count as ground units for stacking", () => {
    const s = board([inf("u1", "M33"), inf("u2", "M33"), counter("u3", "germany", "replacement", 1, "M33")]);
    expect(overstacks(CTX, s)).toHaveLength(1);
  });

  it("London holds three if all are British, but only two if one is not (Ref 5.0)", () => {
    expect(overstacks(CTX, board([inf("u1", "K23", "britain"), inf("u2", "K23", "britain"), inf("u3", "K23", "britain")]))).toEqual([]);
    const mixed = board([inf("u1", "K23", "britain"), inf("u2", "K23", "britain"), inf("u3", "K23", "france")]);
    expect(overstacks(CTX, mixed)).toHaveLength(1);
    expect(overstacks(CTX, board([inf("u1", "K23", "britain"), inf("u2", "K23", "britain"), inf("u3", "K23", "britain"), inf("u4", "K23", "britain")]))).toHaveLength(1);
  });

  it("five air factors per base: 5 fit, 6 are over (Ref 5.0)", () => {
    const air = (id: string, f: number) => counter(id, "germany", "air", f, "L31", 6);
    expect(overstacks(CTX, board([air("u1", 3), air("u2", 2)]))).toEqual([]);
    expect(overstacks(CTX, board([air("u1", 3), air("u2", 3)]))).toEqual([{ hex: "L31", kind: "air", unitIds: ["u1", "u2"] }]);
  });

  it("36 naval factors per port: 36 fit, 37 are over (Ref 5.0)", () => {
    const ship = (id: string, f: number) => counter(id, "germany", "fleet", f, "J35");
    expect(overstacks(CTX, board([ship("u1", 20), ship("u2", 16)]))).toEqual([]);
    expect(overstacks(CTX, board([ship("u1", 20), ship("u2", 17)]))).toEqual([{ hex: "J35", kind: "naval", unitIds: ["u1", "u2"] }]);
  });

  it("reports several hexes in hex order, each side's own, and counters in boxes are never overstacked", () => {
    const s = board([
      inf("u1", "M33"), inf("u2", "M33"), inf("u3", "M33"),
      inf("u4", "H30", "britain"), inf("u5", "H30", "britain"), inf("u6", "H30", "britain"),
      ...["u7", "u8", "u9"].map((id) => counter(id, "usa", "infantry", 3, "us-box")),
    ]);
    expect(overstacks(CTX, s).map((o) => o.hex)).toEqual(["H30", "M33"]);
    expect(overstacksOf(CTX, s, "axis").map((o) => o.hex)).toEqual(["M33"]);
    expect(overstacksOf(CTX, s, "allies").map((o) => o.hex)).toEqual(["H30"]);
  });

  it("British and French sharing a hex before 1942 is listed apart, not as an overstack (Ref 26.0, TODO verify)", () => {
    const pair = [inf("u1", "O22", "britain"), inf("u2", "O22", "france")];
    expect(angloFrenchHexes(CTX, board(pair))).toEqual(["O22"]);
    expect(overstacks(CTX, board(pair))).toEqual([]);
    expect(angloFrenchHexes(ctxFor(SCENARIO_1942), board(pair, SCENARIO_1942))).toEqual([]);
  });
});

describe("eliminating overstacked units (steps 6g and 9j)", () => {
  const three = () => board([inf("u1", "M33", "germany", 2), inf("u2", "M33", "germany", 5), inf("u3", "M33", "germany", 3)]);

  it("the owner picks which unit goes, even the strongest (Ops 5.45g)", () => {
    const r = eliminateOverstack(CTX, three(), "axis", { M33: ["u2"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.state.units)).toEqual(["u1", "u3"]);
    expect(r.events).toEqual([{ type: "OVERSTACK_ELIMINATED", unitId: "u2", owner: "germany", at: "M33" }]);
    expect(overstacks(CTX, r.state)).toEqual([]);
  });

  it("refuses a choice that leaves the hex over, one that eliminates more than needed, or a stranger", () => {
    const s = three();
    const [o] = overstacks(CTX, s);
    expect(eliminationProblem(CTX, s, o!, [])).toMatch(/still hold too many/);
    expect(eliminationProblem(CTX, s, o!, ["u1", "u2"])).toMatch(/need not be eliminated/);
    expect(eliminationProblem(CTX, s, o!, ["u1", "u1"])).toMatch(/twice/);
    expect(eliminationProblem(CTX, s, o!, ["u9"])).toMatch(/not one of/);
    expect(eliminationProblem(CTX, s, o!, ["u3"])).toBeNull();
    expect(eliminateOverstack(CTX, s, "axis", {}).ok).toBe(false);
    expect(eliminateOverstack(CTX, s, "axis", { M33: ["u1", "u2"] }).ok).toBe(false);
  });

  it("only the side's own overstacks, and only its own units", () => {
    const s = board([inf("u1", "M33"), inf("u2", "M33"), inf("u3", "M33"), inf("u4", "H30", "britain"), inf("u5", "H30", "britain"), inf("u6", "H30", "britain")]);
    expect(eliminateOverstack(CTX, s, "allies", { H30: ["u4"], M33: ["u1"] })).toEqual({ ok: false, error: "M33 is not overstacked." });
    const both = eliminateOverstack(CTX, s, "axis", { M33: ["u1"] });
    expect(both.ok && Object.keys(both.state.units)).toEqual(["u2", "u3", "u4", "u5", "u6"]);
    expect(eliminateOverstack(CTX, s, "allies", { H30: ["u1"] }).ok).toBe(false);
    expect(eliminateOverstack(CTX, s, "allies", {}).ok).toBe(false);
  });

  it("air factors: only as many air units go as bring the base to five", () => {
    const air = (id: string, f: number) => counter(id, "germany", "air", f, "L31", 6);
    const s = board([air("u1", 3), air("u2", 2), air("u3", 2)]);
    expect(eliminateOverstack(CTX, s, "axis", { L31: ["u1"] }).ok).toBe(true); // 4 factors left
    expect(eliminateOverstack(CTX, s, "axis", { L31: ["u2"] }).ok).toBe(true); // exactly 5 left
    expect(eliminateOverstack(CTX, s, "axis", { L31: ["u2", "u3"] }).ok).toBe(false); // one of them is needless
    expect(eliminateOverstack(CTX, s, "axis", { L31: [] }).ok).toBe(false);
  });

  it("a hex over in two kinds needs both settled", () => {
    const s = board([inf("u1", "L31"), inf("u2", "L31"), inf("u3", "L31"), counter("u4", "germany", "air", 3, "L31", 6), counter("u5", "germany", "air", 3, "L31", 6)]);
    expect(overstacks(CTX, s).map((o) => o.kind)).toEqual(["ground", "air"]);
    expect(eliminateOverstack(CTX, s, "axis", { L31: ["u3"] }).ok).toBe(false);
    const r = eliminateOverstack(CTX, s, "axis", { L31: ["u3", "u5"] });
    expect(r.ok && Object.keys(r.state.units)).toEqual(["u1", "u2", "u4"]);
  });

  it("the computer's default choice is legal, takes the weakest first and leaves nothing needless", () => {
    const air = (id: string, f: number) => counter(id, "germany", "air", f, "L31", 6);
    const s = board([air("u1", 3), air("u2", 2), air("u3", 2), air("u4", 1), inf("u5", "M33", "germany", 4), inf("u6", "M33", "germany", 1), inf("u7", "M33", "germany", 2)]);
    const pick = defaultElimination(CTX, s, "axis");
    expect(pick.M33).toEqual(["u6"]);
    const r = eliminateOverstack(CTX, s, "axis", pick);
    expect(r.ok).toBe(true);
    if (r.ok) expect(overstacks(CTX, r.state)).toEqual([]);
    expect(defaultElimination(CTX, s, "allies")).toEqual({});
  });
});
