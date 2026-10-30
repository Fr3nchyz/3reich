import { describe, expect, it } from "vitest";
import { neighborIds } from "../src/engine/attack-rules";
import { endAttrition, endAttritionProblem, occupyAttritionHex, occupyAttritionHexProblem, retreatAttritionUnit, retreatAttritionUnitProblem, selectAttritionHex, selectAttritionHexProblem } from "../src/engine/attrition-action";
import { attritionOf, attritionRollProblem, chooseAttritionLosses, finishAttritionHexStage } from "../src/engine/attrition-record";
import type { AttritionRecord } from "../src/engine/attrition-record";
import { retreatOptions } from "../src/engine/retreat";
import { overstacksOf } from "../src/engine/stacking";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Ref 12.4; spec 16 R5-R8, C1/C3/C4/C8; hand-built positions on the real map.
const position = () => board([
  counter("g", "germany", "infantry", 3, "M32"),
  counter("f", "france", "infantry", 2, "M33"),
  counter("f2", "france", "replacement", 1, "M33"),
], undefined, { activeSide: "axis", control: { M33: "france", M34: "germany" }, frontOptions: { eastern: { option: "attrition" } } });
const record = (s = position(), hexesLeft = 2): AttritionRecord => ({ ...attritionOf(s), used: ["g"], run: {
  front: "eastern", factors: 3, column: "1-10", roll: 6, mustLose: 0, hexesLeft, participants: ["g"], against: ["france"], stage: "hex", chooser: "axis", taken: [],
} });
const selected = () => { const s = position(); return selectAttritionHex(CTX, s, record(s), "axis", "M33"); };
const emptied = () => {
  const a = selected();
  const b = retreatAttritionUnit(CTX, a.state, a.record, "allies", "f", "M34");
  return retreatAttritionUnit(CTX, b.state, b.record, "allies", "f2", "M34");
};

describe("Attrition second half (spec 16 R5-R8)", () => {
  it("selects all ground counters, with the defender choosing retreats (R5/R6, C4)", () => {
    const s = position(); const r = record(s); const before = JSON.stringify({ s, r });
    const a = selectAttritionHex(CTX, s, r, "axis", "M33");
    expect(a.record.run).toMatchObject({ target: "M33", stage: "retreat", chooser: "allies", retreating: ["f", "f2"], hexesLeft: 2 });
    expect(a.events).toEqual([{ type: "ATTRITION_HEX_SELECTED", hex: "M33" }]);
    expect(JSON.stringify({ s, r })).toBe(before);
    expect(selectAttritionHex(CTX, s, JSON.parse(JSON.stringify(r)) as AttritionRecord, "axis", "M33")).toEqual(a);
  });

  it("rejects selection at wrong stages, by wrong sides, without allowance or a valid hex (R5)", () => {
    const s = position(); const r = record(s);
    expect(selectAttritionHexProblem(CTX, s, undefined, "axis", "M33")).toMatch(/No Attrition/);
    expect(selectAttritionHexProblem(CTX, s, selected().record, "axis", "M33")).toMatch(/No Attrition/);
    expect(selectAttritionHexProblem(CTX, s, r, "allies", "M33")).toMatch(/Phasing/);
    expect(selectAttritionHexProblem(CTX, s, record(s, 0), "axis", "M33")).toMatch(/allowance/);
    expect(() => selectAttritionHex(CTX, s, r, "axis", "missing")).toThrow(/not a hex/);
  });

  it("rejects loss-emptied hexes and lets the caller close automatically after losses (R5/R8, C8)", () => {
    const s = position(); const r = record(s);
    r.run = { ...r.run!, stage: "losses", chooser: "allies", mustLose: 2 };
    const a = chooseAttritionLosses(CTX, s, r, "allies", ["f", "f2"]);
    expect(selectAttritionHexProblem(CTX, a.state, a.record, "axis", "M33")).toMatch(/no enemy ground/);
    const closed = finishAttritionHexStage(CTX, a.state, a.record);
    expect(closed.run).toBeNull(); expect(closed.done).toEqual(["eastern"]);
    expect(finishAttritionHexStage(CTX, s, r)).toBe(r);
    expect(finishAttritionHexStage(CTX, s, record(s, 0)).run).toBeNull();
  });

  it("permits END only by the Phasing side between hexes and marks the Front done (R5/R8)", () => {
    const s = position(); const r = record(s);
    expect(endAttritionProblem(CTX, s, undefined, "axis")).toMatch(/only/);
    expect(endAttritionProblem(CTX, s, r, "allies")).toMatch(/Phasing/);
    const a = selected(); expect(() => endAttrition(CTX, a.state, a.record, "axis")).toThrow(/only/);
    const b = endAttrition(CTX, s, r, "axis");
    expect(b.state).toBe(s); expect(b.record.run).toBeNull(); expect(b.record.done).toEqual(["eastern"]);
    expect(attritionRollProblem(CTX, s, b.record, "eastern", ["g"])).toMatch(/already resolved/);
    expect(endAttrition(CTX, s, { ...r, done: ["eastern"] }, "axis").record.done).toEqual(["eastern"]);
  });

  it("retreats into vacant enemy land through entry control and waits for every counter (R6, AER6)", () => {
    const a = selected(); const before = JSON.stringify(a);
    const b = retreatAttritionUnit(CTX, a.state, a.record, "allies", "f", "M34");
    expect(b.state.units.f!.at).toBe("M34"); expect(b.state.control.M34).toBe("france");
    expect(b.events).toContainEqual({ type: "UNIT_RETREATED", unit: "f", from: "M33", to: "M34" });
    expect(b.events.some((e) => e.type === "HEX_CONTROL_CHANGED")).toBe(true);
    expect(b.record.run).toMatchObject({ stage: "retreat", retreating: ["f2"] });
    expect(JSON.stringify(a)).toBe(before);
    const c = retreatAttritionUnit(CTX, b.state, b.record, "allies", "f2", "M34");
    expect(c.record.run).toMatchObject({ stage: "occupy", chooser: "axis", occupiers: ["g"] });
  });

  it("rejects invalid retreats, wrong units, sides and stages (R6)", () => {
    const a = selected(); const { state: s, record: r } = a;
    expect(retreatAttritionUnitProblem(CTX, s, undefined, "allies", "f", "M34")).toMatch(/No Attrition/);
    expect(retreatAttritionUnitProblem(CTX, s, r, "axis", "f", "M34")).toMatch(/defending/);
    expect(retreatAttritionUnitProblem(CTX, s, r, "allies", "g", "M34")).toMatch(/retreating/);
    expect(retreatAttritionUnitProblem(CTX, s, r, "allies", "f", "M32")).toMatch(/holds/);
    expect(() => retreatAttritionUnit(CTX, s, r, "allies", "f", "O22")).toThrow(/one land hexside/);
  });

  it("eliminates trapped counters immediately at selection and routes their losses (R6)", () => {
    const s = position(); delete s.units.f2;
    for (const [i, at] of neighborIds(CTX, "M33").entries()) s.units[`block${i}`] = counter(`block${i}`, "germany", "airbase", 0, at);
    expect(retreatOptions(CTX, s, "f")).toEqual([]);
    const a = selectAttritionHex(CTX, s, record(s), "axis", "M33");
    expect(a.state.units.f).toBeUndefined(); expect(a.record.run!.stage).toBe("occupy");
    expect(a.events).toContainEqual({ type: "UNIT_ELIMINATED", unitId: "f", owner: "france", at: "M33" });
    expect(a.events.some((e) => e.type === "UNIT_RETURNED_TO_POOL")).toBe(true);
  });

  it("uses ordinary entry to remove an enemy fortress on retreat (R6, AER6)", () => {
    const s = board([counter("g", "germany", "infantry", 3, "P23")], undefined,
      { activeSide: "allies", control: { P24: "france" }, fortresses: { P24: true } });
    const r = record(s);
    r.run = { ...r.run!, stage: "retreat", target: "P23", retreating: ["g"], chooser: "axis" };
    const b = retreatAttritionUnit(CTX, s, r, "axis", "g", "P24");
    expect(b.state.fortresses.P24).toBe(false);
    expect(b.events.some((e) => e.type === "FORTRESS_CHANGED")).toBe(true);
  });

  it("allows a retreat overstack for the defender's later step 6g (R6)", () => {
    const a = selected(); const s = { ...a.state, units: { ...a.state.units,
      x: counter("x", "france", "infantry", 2, "M34"), y: counter("y", "france", "infantry", 2, "M34") } };
    const b = retreatAttritionUnit(CTX, s, a.record, "allies", "f", "M34");
    expect(b.state.units.f).toBeDefined(); expect(overstacksOf(CTX, b.state, "allies")).toMatchObject([{ hex: "M34" }]);
  });

  it("passes air and ships left behind through the existing capture sweep (R6/R7, AER10)", () => {
    const s = position(); delete s.units.f2;
    s.units.air = counter("air", "france", "air", 1, "M33"); s.units.ship = counter("ship", "france", "fleet", 9, "M33");
    const a = selectAttritionHex(CTX, s, record(s), "axis", "M33");
    expect(a.state.units.air!.at).toBe("M33"); expect(a.record.run!.retreating).toEqual(["f"]);
    const b = retreatAttritionUnit(CTX, a.state, a.record, "allies", "f", "M34");
    expect(b.state.units.air?.at).not.toBe("M33"); expect(b.state.units.ship?.at).not.toBe("M33");
    expect(b.events.some((e) => (e.type === "AIR_DISPLACED" || e.type === "UNIT_ELIMINATED") && e.unitId === "air")).toBe(true);
    expect(b.events.some((e) => (e.type === "FLEET_DISPLACED" || e.type === "UNIT_ELIMINATED") && e.unitId === "ship")).toBe(true);
  });

  it("requires distinct surviving eligible occupiers, respects cutoff and stacking (R7)", () => {
    const a = emptied(); const { state: s, record: r } = a;
    expect(occupyAttritionHexProblem(CTX, s, undefined, "axis", ["g"])).toMatch(/No Attrition/);
    expect(occupyAttritionHexProblem(CTX, s, r, "allies", ["g"])).toMatch(/Phasing/);
    for (const ids of [[], ["g", "g"], ["f"], ["missing"]]) expect(() => occupyAttritionHex(CTX, s, r, "axis", ids)).toThrow(/distinct eligible/);
    const cut = { ...s, unsuppliedAtStart: ["g"] };
    expect(occupyAttritionHexProblem(CTX, cut, r, "axis", ["g"])).toMatch(/eligible/);
    const crowded = { ...s, units: { ...s.units, x: counter("x", "germany", "infantry", 3, "M32"), y: counter("y", "germany", "armor", 3, "M32") } };
    const rec = { ...r, run: { ...r.run!, participants: ["g", "x", "y"] } };
    expect(occupyAttritionHexProblem(CTX, crowded, rec, "axis", ["g", "x", "y"])).toMatch(/limit/);
    expect(occupyAttritionHexProblem(CTX, crowded, rec, "axis", ["g", "x"])).toBeNull();
  });

  it("occupies, uses units, closes at the hex limit and never opens a Breakthrough (R5/R7/R8)", () => {
    const a = emptied(); const rec = { ...a.record, used: [], run: { ...a.record.run!, hexesLeft: 1 } }; const before = JSON.stringify(a);
    const b = occupyAttritionHex(CTX, a.state, rec, "axis", ["g"]);
    expect(b.state.units.g!.at).toBe("M33"); expect(b.state.control.M33).toBe("germany");
    expect(b.record.run).toBeNull(); expect(b.record.done).toEqual(["eastern"]); expect(b.record.used).toEqual(["g"]);
    expect(b.events[0]).toEqual({ type: "ATTRITION_HEX_OCCUPIED", hex: "M33", units: ["g"] });
    expect(b.events.some((e) => e.type === "HEX_CONTROL_CHANGED")).toBe(true);
    expect(b.state.exploit).toEqual(a.state.exploit); expect(b.state.combat).toEqual(a.state.combat);
    expect(b.state.rngState).toBe(a.state.rngState); expect(JSON.stringify(a)).toBe(before);
  });

  it("rejudges the second hex from the first occupation and completes a two-hex run (R5/R6/R7, AER11)", () => {
    const s = position(); delete s.units.f2;
    s.units.remote = counter("remote", "france", "infantry", 2, "M34");
    const r = record(s);
    expect(selectAttritionHexProblem(CTX, s, r, "axis", "M34")).toBeTruthy();
    const a = selectAttritionHex(CTX, s, r, "axis", "M33");
    const b = retreatAttritionUnit(CTX, a.state, a.record, "allies", "f", "N33");
    const c = occupyAttritionHex(CTX, b.state, b.record, "axis", ["g"]);
    expect(c.record.run).toMatchObject({ stage: "hex", hexesLeft: 1, taken: ["M33"] });
    expect(selectAttritionHexProblem(CTX, c.state, c.record, "axis", "M34")).toBeNull();
    const d = selectAttritionHex(CTX, c.state, c.record, "axis", "M34");
    const e = retreatAttritionUnit(CTX, d.state, d.record, "allies", "remote", "M35");
    const f = occupyAttritionHex(CTX, e.state, e.record, "axis", ["g"]);
    expect(f.record.run).toBeNull(); expect(f.record.done).toEqual(["eastern"]); expect(f.state.units.g!.at).toBe("M34");
  });

  it("closes when occupation leaves no further selectable target even with allowance left (R5, C8)", () => {
    const a = emptied(); const s = { ...a.state, units: { ...a.state.units } }; delete s.units.f; delete s.units.f2;
    const b = occupyAttritionHex(CTX, s, a.record, "axis", ["g"]);
    expect(b.record.run).toBeNull(); expect(b.record.done).toEqual(["eastern"]);
  });
});
