import { describe, expect, it } from "vitest";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { spendable } from "../src/engine/brps";
import type { ForceOwner } from "../src/engine/types";
import { payVitalAreas, suezLost, vitalAreasDue, vitalBalance, VITAL_AREA_LOSS, V27_DEFICIT_ALLOWED, V27_NO_RETURN, V27_SUEZ_NEEDS_BOTH } from "../src/engine/vital-areas";
import { board } from "./board";
import { CTX, ctxFor } from "./helpers";

// spec 14 R8; Ref 32.0, 34.0; TODO(verify) V27: independent, once-only British losses.
const held = (control: Record<string, ForceOwner | null>) => ({ ...board([]), control });

describe("vital production areas (spec 14 R8)", () => {
  it("finds the three cities by map name at the expected hexes", () => {
    for (const [name, id] of [["Gibraltar", "AA7"], ["Suez", "MM30"], ["Alexandria", "LL29"]]) {
      expect(Object.values(CTX.map.hexes).find((h) => h.name === name)?.id).toBe(id);
    }
  });
  it("charges 25 for Axis Gibraltar, zero for British, neutral, nobody, or already paid", () => {
    expect(VITAL_AREA_LOSS).toBe(25);
    expect(vitalAreasDue(CTX, held({ AA7: "germany" }), {})).toEqual({ gibraltar: true, suez: false, total: 25 });
    for (const owner of ["britain", "italy", null] as const) {
      expect(vitalAreasDue(CTX, held({ AA7: owner }), {}).total).toBe(0);
    }
    expect(vitalAreasDue(CTX, held({ AA7: "germany" }), { gibraltar: true }).total).toBe(0);
  });
  it("requires both Suez and Alexandria, unless the V27 switch is off", () => {
    expect(V27_SUEZ_NEEDS_BOTH).toBe(true);
    expect(vitalAreasDue(CTX, held({ MM30: "germany", LL29: "britain" }), {}).total).toBe(0);
    expect(vitalAreasDue(CTX, held({ MM30: "britain", LL29: "germany" }), {}).total).toBe(0);
    const both = held({ MM30: "germany", LL29: "germany" });
    expect(vitalAreasDue(CTX, both, {})).toEqual({ gibraltar: false, suez: true, total: 25 });
    expect(vitalAreasDue(CTX, both, { suez: true }).total).toBe(0);
    expect(suezLost([true, false], false)).toBe(true);
    expect(suezLost([false, true], false)).toBe(true);
    expect(suezLost([false, false], false)).toBe(false);
  });
  it("adds independent losses, debits Britain only, preserves inputs, and never pays twice", () => {
    const state = held({ AA7: "germany", MM30: "germany", LL29: "germany" });
    const paid = {};
    const before = structuredClone({ state, paid });
    const result = payVitalAreas(CTX, state, paid);
    expect(result.due).toEqual({ gibraltar: true, suez: true, total: 50 });
    expect(result.paid).toEqual({ gibraltar: true, suez: true });
    expect(result.state).toEqual({ ...state, nations: { ...state.nations, britain: { ...state.nations.britain, brpTotal: state.nations.britain.brpTotal - 50 } } });
    expect({ state, paid }).toEqual(before);
    const twice = payVitalAreas(CTX, result.state, result.paid);
    expect(twice.due.total).toBe(0);
    expect(twice.state).toEqual(result.state);
    expect(twice.paid).toEqual(result.paid);
  });
  it("keeps paid flags on recapture and owes nothing on a later Axis capture", () => {
    expect(V27_NO_RETURN).toBe(true);
    const first = payVitalAreas(CTX, held({ AA7: "germany", MM30: "germany", LL29: "germany" }), {});
    const retaken = { ...first.state, control: { AA7: "britain", MM30: "britain", LL29: "britain" } as const };
    const back = payVitalAreas(CTX, retaken, first.paid);
    expect(back.state).toEqual(retaken);
    expect(back.paid).toEqual(first.paid);
    expect(vitalAreasDue(CTX, first.state, back.paid).total).toBe(0);
  });
  it("allows a deficit that stops spending; the alternative clamps at zero", () => {
    expect(V27_DEFICIT_ALLOWED).toBe(true);
    const state = held({ AA7: "germany" });
    state.nations = { ...state.nations, britain: { ...state.nations.britain, brpTotal: 10 } };
    const result = payVitalAreas(CTX, state, {});
    expect(result.state.nations.britain.brpTotal).toBe(-15);
    expect(spendable(result.state.nations.britain)).toBe(0);
    expect(vitalBalance(10, 25, false)).toBe(0);
    expect(vitalBalance(40, 25, false)).toBe(15);
  });
  it("owes nothing at the 1942 scenario start", () => {
    expect(vitalAreasDue(ctxFor(SCENARIO_1942), board([], SCENARIO_1942), {})).toEqual({ gibraltar: false, suez: false, total: 0 });
  });
});
