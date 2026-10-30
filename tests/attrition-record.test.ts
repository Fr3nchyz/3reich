import { describe, expect, it } from "vitest";
import { attritionChoiceProblem, attritionOf, attritionRollProblem, attritionUsed, chooseAttritionLosses, rollAttrition } from "../src/engine/attrition-record";
import { combatOf } from "../src/engine/combat-record";
import { resolveAttrition } from "../src/engine/combat";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Ref 12.4; spec 16 R1-R4/R8/R9, C1/C4; AER4/AER5/AER8/AER9.
const position = (strength = 21, rngState = 1) => board([
  counter("g", "germany", "infantry", strength, "M32"),
  counter("omitted", "germany", "infantry", 3, "N32"),
  counter("f", "france", "replacement", 1, "M33"),
  counter("remote", "britain", "infantry", 2, "M35"),
  counter("p", "poland", "infantry", 2, "M33"),
], undefined, { activeSide: "axis", rngState, frontOptions: { eastern: { option: "attrition" } } });
const roll = (strength = 21, seed = 1) => rollAttrition(CTX, position(strength, seed), undefined, "eastern", ["g"]);

describe("isolated Attrition record (spec 16 R1-R4/R8/R9, C1/C4)", () => {
  it("reads missing/stale records as empty and retains a current record (C1)", () => {
    const s = position(); const r = roll().record;
    expect(attritionOf(s).run).toBeNull();
    expect(attritionOf(s, r)).toBe(r);
    expect(attritionOf({ ...s, activeSide: "allies" }, r).done).toEqual([]);
    expect(attritionUsed({ ...s, year: s.year + 1 }, r)).toEqual([]);
  });
  it("reuses the seeded table and counts only the selected printed factors (R2/R3)", () => {
    const a = roll(); const b = roll(); const table = resolveAttrition(21, 1);
    expect(a).toEqual(b);
    expect(a.state.rngState).toBe(table.rngState);
    expect(a.record.run).toMatchObject({ factors: 21, column: "21-30", roll: table.roll, mustLose: table.units, hexesLeft: table.hexes, participants: ["g"] });
    expect(a.events[0]).toMatchObject({ type: "ATTRITION_RESOLVED", side: "axis", front: "eastern", factors: 21 });
  });
  it("records only owners actually in contact, not remote loss candidates (R9)", () => {
    expect(roll().record.run!.against).toEqual(["france", "poland"]);
    const s = position(); delete s.units.p;
    expect(rollAttrition(CTX, s, undefined, "eastern", ["g"]).events[0]).toMatchObject({ against: ["france"] });
  });
  it("rejects empty, duplicate, missing and ineligible participants before rolling (R2/R3)", () => {
    const s = position(); const before = JSON.stringify(s);
    for (const ids of [[], ["g", "g"], ["missing"], ["f"]]) {
      expect(attritionRollProblem(CTX, s, undefined, "eastern", ids)).toBeTruthy();
      expect(() => rollAttrition(CTX, s, undefined, "eastern", ids)).toThrow();
    }
    expect(() => rollAttrition(CTX, position(0), undefined, "eastern", ["g"])).toThrow(/positive/);
    expect(JSON.stringify(s)).toBe(before);
  });
  it("requires the Option, an unfinished Front and no pending run (R1/R8, AER9)", () => {
    const s = position(); const rec = roll().record;
    expect(attritionRollProblem(CTX, s, undefined, "western", ["g"])).toMatch(/Option/);
    expect(attritionRollProblem(CTX, s, rec, "eastern", ["g"])).toMatch(/Finish/);
    expect(attritionRollProblem(CTX, s, { ...rec, run: null }, "eastern", ["g"])).toMatch(/already resolved/);
  });
  it("keeps used units after completion and excludes them on later rolls (R2, AER8)", () => {
    const a = roll(); const rec = { ...a.record, run: null, done: [] };
    expect(attritionUsed(a.state, rec)).toEqual(["g"]);
    expect(attritionRollProblem(CTX, a.state, rec, "eastern", ["g"])).toMatch(/eligible/);
    expect(attritionRollProblem(CTX, a.state, rec, "eastern", ["omitted"])).toBeNull();
  });
  it("makes the defender choose distinct candidates with the exact count (R4, AER4/AER5)", () => {
    const a = roll(); expect(a.record.run).toMatchObject({ stage: "losses", chooser: "allies" });
    expect(attritionChoiceProblem(CTX, a.state, a.record, "axis", ["f"])).toMatch(/defending/);
    expect(attritionChoiceProblem(CTX, a.state, a.record, "allies", [])).toMatch(/exactly/);
    expect(attritionChoiceProblem(CTX, a.state, a.record, "allies", ["f", "f"])).toMatch(/distinct/);
    expect(() => chooseAttritionLosses(CTX, a.state, a.record, "allies", ["g"])).toThrow(/eligible/);
    expect(attritionChoiceProblem(CTX, a.state, undefined, "allies", [])).toMatch(/No Attrition/);
  });
  it("removes whole units and routes losses, preserving inputs and RNG (R4; spec 17 R1/R4)", () => {
    const a = roll(); const before = JSON.stringify(a);
    const b = chooseAttritionLosses(CTX, a.state, a.record, "allies", ["remote", "f"]);
    expect(b.state.units.remote).toBeUndefined(); expect(b.state.units.f).toBeUndefined();
    expect(b.state.units.p).toBeDefined();
    expect(b.state.pools.britain!.allowableBuilds.some((u) => u.returned && u.type === "infantry" && u.strength === 2)).toBe(true);
    expect(b.state.pools.france!.allowableBuilds.some((u) => u.returned && u.type === "replacement")).toBe(true);
    expect(b.events.map((e) => e.type)).toEqual(["ATTRITION_LOSSES_CHOSEN", "UNIT_ELIMINATED", "UNIT_RETURNED_TO_POOL", "UNIT_ELIMINATED", "UNIT_RETURNED_TO_POOL"]);
    expect(b.state.rngState).toBe(a.state.rngState);
    expect(b.record.run).toMatchObject({ stage: "hex", chooser: "axis" });
    expect(JSON.stringify(a)).toBe(before);
    expect(attritionChoiceProblem(CTX, b.state, b.record, "allies", [])).toMatch(/No Attrition/);
  });
  it("takes all when fewer candidates exist and completes with no hex allowance (R4/R5, AER5)", () => {
    const a = roll(61); // seed 1: four units, two hexes; three candidates available.
    expect(attritionChoiceProblem(CTX, a.state, a.record, "allies", ["f", "remote", "p"])).toBeNull();
    const b = roll(3, 7); // seed 7: one unit, no hexes.
    const c = chooseAttritionLosses(CTX, b.state, b.record, "allies", ["f"]);
    expect(c.record.run).toBeNull(); expect(c.record.done).toEqual(["eastern"]);
    expect(attritionUsed(c.state, c.record)).toEqual(["g"]);
  });
  it("refuses participants already used in Offensive combat (R2)", () => {
    const s = position(); s.combat = { ...combatOf(s), attacked: ["g"] };
    expect(attritionRollProblem(CTX, s, undefined, "eastern", ["g"])).toMatch(/eligible/);
  });
  it("replays serialized records and states without mutating the source (R3/C1)", () => {
    const s = position(); const before = JSON.stringify(s);
    const a = rollAttrition(CTX, s, undefined, "eastern", ["g"]);
    expect(JSON.stringify(s)).toBe(before);
    const copy = JSON.parse(JSON.stringify(a)) as typeof a;
    expect(chooseAttritionLosses(CTX, copy.state, copy.record, "allies", ["f", "remote"]))
      .toEqual(chooseAttritionLosses(CTX, a.state, a.record, "allies", ["f", "remote"]));
    expect(roll(21, 7).record.run!.roll).not.toBe(a.record.run!.roll);
  });
  it("finishes a zero/zero result immediately while still spending the roll (R3/R8)", () => {
    const s = position(3); const a = roll(3);
    expect(a.record.run).toBeNull(); expect(a.record.done).toEqual(["eastern"]);
    expect(a.state.rngState).not.toBe(s.rngState);
  });
});
