import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { turnKey } from "../src/engine/combat-record";
import { vacantHexAttackPlan, vacantHexAttackProblem, vacantHexTargets } from "../src/engine/vacant-attack";
import type { Unit, UnitType } from "../src/engine/types";
import { CTX, atStart } from "./helpers";

const armor = (id: string, at = "M32"): Unit => ({ id, at, owner: "germany", type: "armor", strength: 4, movement: 6 });
function fixture() {
  const s = atStart(SCENARIO_1939, 1);
  s.units = { a: armor("a"), b: { ...armor("b"), type: "infantry" }, reserve: armor("reserve", "M33") };
  s.control = Object.fromEntries(Object.values(CTX.map.hexes).filter((h) => h.land).map((h) => [h.id, "germany" as const]));
  s.control.M31 = "poland";
  s.frontOptions = { [CTX.map.hexes.M31!.front]: { option: "offensive" } };
  return s;
}
const problem = (s = fixture(), ids = ["a"], t = "M31") => vacantHexAttackProblem(CTX, s, "axis", ids, t);

describe("spec 16 R16: vacant-hex rules, unwired", () => {
  it("R16: supplied armor and optional adjacent infantry; deterministic immutable plan and targets", () => {
    const s = fixture();
    const before = JSON.stringify(s);
    expect(problem(s, ["a", "b"])).toBeNull();
    const plan = vacantHexAttackPlan(CTX, s, "axis", ["a", "b"], "M31");
    expect(plan).toMatchObject({ attacked: ["a", "b"], target: "M31", advancing: ["a"], breakthrough: { hex: "M31", from: ["M32"], placed: [], moved: {}, attacked: [] } });
    expect(plan!.breakthrough!.placeable).toEqual(["reserve"]);
    expect(vacantHexTargets(CTX, s, "axis")).toEqual(["M31"]);
    expect(vacantHexAttackPlan(CTX, s, "axis", ["a", "b"], "M31")).toEqual(plan);
    expect(JSON.stringify(s)).toBe(before);
  });
  it("R16: only the active side and Offensive target Front qualify", () => {
    const s = fixture();
    expect(vacantHexAttackProblem(CTX, s, "allies", ["a"], "M31")).toMatch(/Phasing/);
    expect(vacantHexTargets(CTX, s, "allies")).toEqual([]);
    for (const option of ["attrition", "defensive"] as const) {
      s.frontOptions = { [CTX.map.hexes.M31!.front]: { option } };
      expect(problem(s)).toMatch(/Offensive/);
    }
  });
  it("R16: requires supplied initiating armor even with supply effects off", () => {
    const s = fixture();
    expect(problem(s, ["b", "a"])).toMatch(/armor/);
    s.control = Object.fromEntries(Object.keys(s.control).map((id) => [id, "poland" as const]));
    s.control.M32 = "germany";
    expect(problem(s)).toMatch(/supplied/);
  });
  it("R16: distinct, present, unused, non-exploiting friendly attackers only", () => {
    const s = fixture();
    for (const ids of [[], ["a", "a"], ["missing"], ["__proto__"]]) expect(problem(s, ids)).not.toBeNull();
    s.combat = { turn: turnKey(s), attacked: ["b"], targets: [], advances: [], pending: null };
    expect(problem(s, ["a", "b"])).toMatch(/unused/);
    s.combat.attacked = ["a"];
    expect(problem(s)).toMatch(/unused/);
    s.combat.attacked = [];
    s.exploit = { turn: turnKey(s), groups: [{ hex: "M32", from: [], placeable: [], placed: ["a"], moved: {}, attacked: [] }] };
    expect(problem(s)).toMatch(/unused/);
    delete s.exploit;
    s.units.b = { ...s.units.b!, owner: "poland" };
    expect(problem(s, ["a", "b"])).toMatch(/unused/);
  });
  it("R16/AER20: every attacker must cross a ground hexside", () => {
    const s = fixture();
    s.units.b = { ...s.units.b!, at: "M34" };
    expect(problem(s, ["a", "b"])).toMatch(/adjacent/);
    s.units.a = armor("a", "L23");
    s.control.L24 = "poland";
    expect(problem(s, ["a"], "L24")).toMatch(/land|adjacent/);
  });
  it("R16: target is real enemy-controlled land at war, not friendly or neutral", () => {
    const s = fixture();
    expect(problem(s, ["a"], "offmap")).toMatch(/land/);
    for (const owner of [null, "germany", "ussr"] as const) {
      s.control.M31 = owner;
      expect(problem(s)).toMatch(/enemy-controlled/);
    }
  });
  it("R16/AER20: all enemy counter types conservatively block vacancy", () => {
    for (const type of ["infantry", "armor", "airborne", "replacement", "air", "naval", "airbase"] as UnitType[]) {
      const s = fixture();
      s.units.e = { ...armor("e", "M31"), owner: "poland", type };
      expect(problem(s)).toMatch(/not vacant/);
      expect(vacantHexTargets(CTX, s, "axis")).toEqual([]);
    }
  });
  it("R16/AER20: adjacent enemy ground denies Exploitation but not the attack", () => {
    const s = fixture();
    s.units.e = { ...armor("e", "L31"), owner: "poland", type: "infantry" };
    expect(problem(s)).toBeNull();
    expect(vacantHexAttackPlan(CTX, s, "axis", ["a"], "M31")!.breakthrough).toBeNull();
    s.units.e.type = "air";
    expect(vacantHexAttackPlan(CTX, s, "axis", ["a"], "M31")!.breakthrough).not.toBeNull();
  });
  it("R16/AER20: no target land supply line denies Exploitation only", () => {
    const s = fixture();
    s.control = Object.fromEntries(Object.keys(s.control).map((id) => [id, "poland" as const]));
    s.control.M32 = "germany";
    s.fortresses.M32 = true;
    expect(problem(s)).toBeNull();
    expect(vacantHexAttackPlan(CTX, s, "axis", ["a"], "M31")!.breakthrough).toBeNull();
  });
  it("R16/AER20: used target refused; invalid plan is null; stale records ignored", () => {
    const s = fixture();
    s.combat = { turn: turnKey(s), attacked: [], targets: ["M31"], advances: [], pending: null };
    expect(problem(s)).toMatch(/already/);
    expect(vacantHexAttackPlan(CTX, s, "axis", ["a"], "M31")).toBeNull();
    s.combat.turn = "old";
    expect(problem(s)).toBeNull();
  });
});
