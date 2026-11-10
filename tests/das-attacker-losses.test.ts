import { describe, expect, it } from "vitest";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { sideToAct } from "../src/engine/actor";
import { dasOf, setManualDas } from "../src/engine/air-defense-wire";
import { hasFlown } from "../src/engine/air-record";
import { combatOf } from "../src/engine/combat-record";
import type { Side } from "../src/engine/types";
import { CTX, NO_AIRBASES_LEFT } from "./helpers";
import { at6f, inf, okOf } from "./helpers-move";

// Ref 12.2, spec 09 R10/C4, TODO(verify) AER121: use real 6f -> 7d -> 7h actions.
function battle(side: Side, strengths = [12, 12], das = true) {
  const defender: Side = side === "axis" ? "allies" : "axis";
  const attackingOwner = side === "axis" ? "germany" : "britain";
  const defendingOwner = side === "axis" ? "poland" : "germany";
  const ids = strengths.map((_, i) => i === 0 ? "z" : "a");
  let state = at6f([
    ...strengths.map((n, i) => inf(ids[i]!, attackingOwner, "M32", n)),
    inf("p", defendingOwner, "M33"), inf("d", defendingOwner, "M33", 3, 4, "air"),
  ], side, undefined, { rngState: 7, airbasesPlaced: NO_AIRBASES_LEFT,
    control: { M32: attackingOwner, M33: defendingOwner } });
  if (das) state = setManualDas(state, true);
  const send = (action: Action) => { state = okOf(applyAction(CTX, state, action)).state; };
  send({ type: "END_STEP", step: "6f", side });
  if (das) {
    expect(state.position).toMatchObject({ step: "7d" });
    send({ type: "DESIGNATE_DAS", side: defender, units: ["d"], hex: "M33" });
    send({ type: "END_STEP", step: "7d", side: defender });
  }
  expect(state.position).toMatchObject({ step: "7h" });
  const before = state;
  const result = okOf(applyAction(CTX, before, { type: "ATTACK", side, units: ids, target: "M33" }));
  expect(result.events[0]).toMatchObject({ type: "COMBAT_RESOLVED", outcome: "exchange" });
  return { before, ...result };
}

describe("AER121: DAS Exchange loss chooser", () => {
  it.each(["axis", "allies"] as const)("AER121/Ref 12.2: %s attacker chooses either minimal set and completes combat", (side) => {
    const { state, before } = battle(side);
    expect(combatOf(state).pending).toMatchObject({ chooser: side, candidates: ["z", "a"],
      required: 9, values: { z: 12, a: 12 }, attackers: ["z", "a"], target: "M33" });
    expect(sideToAct(state)).toBe(side);
    const options = legalActions(CTX, state);
    expect(options).toEqual([
      { type: "ALLOCATE_LOSSES", side, units: ["z"] },
      { type: "ALLOCATE_LOSSES", side, units: ["a"] },
    ]);
    expect(state.units.p).toBeUndefined();
    expect(state.units.d).toBeUndefined();
    expect(state.units.z).toEqual(before.units.z);
    expect(state.units.a).toEqual(before.units.a);
    const snapshot = JSON.stringify(state);
    for (const units of [[], ["p"], ["d"], ["z", "a"]]) {
      expect(applyAction(CTX, state, { type: "ALLOCATE_LOSSES", side, units }).ok).toBe(false);
    }
    expect(applyAction(CTX, state, { type: "ALLOCATE_LOSSES", side: side === "axis" ? "allies" : "axis", units: ["z"] }).ok).toBe(false);
    for (const action of options) {
      const done = okOf(applyAction(CTX, state, action));
      const lost = action.type === "ALLOCATE_LOSSES" ? action.units[0]! : "";
      const survivor = lost === "z" ? "a" : "z";
      expect(done.state.units[lost]).toBeUndefined();
      expect(done.state.units[survivor]).toEqual(before.units[survivor]);
      expect(done.events).toContainEqual({ type: "LOSSES_CHOSEN", side, units: [lost] });
      expect(combatOf(done.state).pending).toBeNull();
      expect(combatOf(done.state).advances).toContainEqual({ to: "M33", units: [survivor] });
      expect(dasOf(done.state)).toEqual({});
      expect(hasFlown(done.state, "d")).toBe(true);
      expect(done.state.rngState).toBe(state.rngState);
    }
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it.each(["axis", "allies"] as const)("AER121/AER78: against %s attack, defender auto-allocates lexical first at basic air value", (side) => {
    const { state } = battle(side, [3]);
    expect(combatOf(state).pending).toBeNull();
    expect(state.units.z).toBeUndefined();
    expect(state.units.d).toBeUndefined(); // d precedes p; its three basic factors suffice.
    expect(state.units.p).toBeDefined();
    expect(dasOf(state)).toEqual({});
    expect(legalActions(CTX, state).some((a) => a.type === "ALLOCATE_LOSSES")).toBe(false);
  });

  it("AER121: single attacker loss set still resolves automatically", () => {
    const { state } = battle("axis", [24]);
    expect(combatOf(state).pending).toBeNull();
    for (const id of ["z", "p", "d"]) expect(state.units[id]).toBeUndefined();
    expect(dasOf(state)).toEqual({});
  });

  it("AER121/Ref 12.2: equal totals eliminate both sides without a choice", () => {
    const { state } = battle("axis", [9]);
    expect(combatOf(state).pending).toBeNull();
    for (const id of ["z", "p", "d"]) expect(state.units[id]).toBeUndefined();
    expect(dasOf(state)).toEqual({});
  });

  it("AER121/AER76: absent DAS gate retains ordinary attacker allocation and order", () => {
    const { state } = battle("axis", [12, 12], false);
    expect(state.air?.manualDas).toBeUndefined();
    expect(combatOf(state).pending).toMatchObject({ chooser: "axis", candidates: ["z", "a"], required: 6 });
    expect(legalActions(CTX, state)).toEqual([
      { type: "ALLOCATE_LOSSES", side: "axis", units: ["z"] },
      { type: "ALLOCATE_LOSSES", side: "axis", units: ["a"] },
    ]);
  });
});
