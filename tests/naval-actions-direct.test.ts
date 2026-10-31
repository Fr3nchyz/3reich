import { describe, expect, it } from "vitest";
import type { GameContext } from "../src/engine/context";
import { applySeaSupply, hasSeaSupplyWork, lapsedDesignations, legalSeaSupply } from "../src/engine/naval-actions";
import { hasUsed, navalOf, useOf } from "../src/engine/naval-record";
import { unsuppliedUnits } from "../src/engine/supply";
import type { GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 12 R5 to R8, C2, C3, C5 (Ref 19.31): the exported functions called directly. Norway pocket: German infantry at C35, C34, C33; a German fleet at K28.
const ON: GameContext = { ...CTX, supplyEffects: true };
const OFF: GameContext = { ...CTX, supplyEffects: false };
const inf = (id: string, at: string): Unit => counter(id, "germany", "infantry", 2, at, 3);
const fleet = (id: string, at: string, strength = 9): Unit => counter(id, "germany", "fleet", strength, at);
const pocket = (ids = ["g1", "g2", "g3"]): Unit[] => ids.map((id, i) => inf(id, ["C35", "C34", "C33"][i % 3]!));
function at6e(units: Unit[], extra: Partial<GameState> = {}): GameState {
  const base = board([]);
  const s = board(units, undefined, {
    nations: { ...base.nations, italy: { ...base.nations.italy, status: "axis" } },
    control: { C33: "germany", C34: "germany", C35: "germany" },
    position: { part: "player-turn", turn: 1, step: "6e" },
    ...extra,
  });
  return { unsuppliedAtStart: unsuppliedUnits(ON, s, "axis"), ...s };
}
const desig = (fleets: string[], to: string, units: string[]) => ({ type: "DESIGNATE_SEA_SUPPLY" as const, side: "axis" as const, fleets, to, units });

describe("naval-actions, called directly", () => {
  it("hasSeaSupplyWork: none with the effects off, work with them on and a fleet that can reach a cut-off unit, none without the fleet", () => {
    const s = at6e([...pocket(), fleet("f1", "K28")]);
    expect(hasSeaSupplyWork(OFF, s)).toBe(false);
    expect(hasSeaSupplyWork(ON, s)).toBe(true);
    expect(hasSeaSupplyWork(ON, at6e(pocket()))).toBe(false);
    expect(hasSeaSupplyWork(ON, { ...s, activeSide: "allies" })).toBe(false);
  });

  it("legalSeaSupply lists the saving proposal for the active side, and nothing for a side with no cut-off unit", () => {
    const s = at6e([...pocket(), fleet("f1", "K28")]);
    expect(legalSeaSupply(ON, s)).toEqual([desig(["f1"], "C33", ["g1", "g2", "g3"])]);
    expect(legalSeaSupply(ON, { ...s, activeSide: "allies" })).toEqual([]);
  });

  it("applySeaSupply records the designation, uses the fleet up and returns the event", () => {
    const s = at6e([...pocket(), fleet("f1", "K28")]);
    const r = applySeaSupply(ON, s, desig(["f1"], "C33", ["g1", "g2"]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toEqual([{ type: "FLEET_DESIGNATED_FOR_SUPPLY", fleets: ["f1"], from: "K28", to: "C33", units: ["g1", "g2"] }]);
    expect(navalOf(r.state).supply).toEqual([{ fleets: ["f1"], from: "K28", to: "C33", units: ["g1", "g2"] }]);
    expect(useOf(r.state, "f1")).toBe("supply");
    expect(hasUsed(s, "f1")).toBe(false);
  });

  it("applySeaSupply refuses a fleet that cannot feed that many units, the wrong side and a malformed fleet list, changing nothing", () => {
    const s = at6e([...pocket(["g1", "g2", "g3", "g4"]), fleet("f2", "K28", 2)]);
    const big = applySeaSupply(ON, s, desig(["f2"], "C33", ["g1", "g2", "g3"]));
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error).toMatch(/carries only 2 more units/);
    const wrong = applySeaSupply(ON, s, { ...desig(["f2"], "C33", ["g1"]), side: "allies" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toMatch(/axis player turn/);
    expect(applySeaSupply(ON, s, desig([], "C33", ["g1"])).ok).toBe(false);
    expect(s.naval).toBeUndefined();
  });

  it("lapsedDesignations: none without a record or while it holds; an event when the fleet is gone or the place is taken", () => {
    const s = at6e([...pocket(["g1", "g2"]), fleet("f1", "K28")]);
    expect(lapsedDesignations(ON, s)).toEqual([]);
    const named = applySeaSupply(ON, s, desig(["f1"], "C33", ["g1", "g2"]));
    if (!named.ok) throw new Error(named.error);
    expect(lapsedDesignations(ON, named.state)).toEqual([]);
    const { f1: _gone, ...units } = named.state.units;
    const lost = lapsedDesignations(ON, { ...named.state, units });
    expect(lost).toEqual([{ type: "SEA_SUPPLY_LAPSED", fleets: ["f1"], from: "K28", to: "C33", units: ["g1", "g2"], reason: expect.stringMatching(/not a fleet on the map/) as string }]);
    const taken = lapsedDesignations(ON, { ...named.state, control: { ...named.state.control, C33: "britain" } });
    expect(taken).toHaveLength(1);
  });

  it("is deterministic: the same state and action give equal results", () => {
    const s = at6e([...pocket(), fleet("f1", "K28")]);
    expect(applySeaSupply(ON, s, desig(["f1"], "C33", ["g1"]))).toEqual(applySeaSupply(ON, s, desig(["f1"], "C33", ["g1"])));
  });
});
