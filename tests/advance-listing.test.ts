import { describe, expect, it } from "vitest";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { turnKey } from "../src/engine/combat-record";
import type { ForceOwner, GameState, Unit, UnitType } from "../src/engine/types";
import { CTX, atStart } from "./helpers";
import { SCENARIO_1939 } from "../src/data/scenario-1939";

/**
 * Spec 04, ground combat: the advances listed after a won battle (Ref 5.0 stacking, Ref 26.0 British/French). The list is
 * built by walking the sets that fit; this checks it against the plain definition, "every set of the first 12 survivors
 * that ADVANCE accepts, in the order of the bit mask", which is what the computer's choice (and its recordings) rest on.
 */

const unit = (id: string, owner: ForceOwner, type: UnitType, strength: number, at: string): Unit => ({ id, owner, type, strength, at });
const withAdvance = (units: Unit[], survivors: string[], to: string, extra: Partial<GameState> = {}): GameState => {
  const base: GameState = { ...atStart(SCENARIO_1939, 1), activeSide: "allies", position: { part: "player-turn", turn: 1, step: "7h" }, units: Object.fromEntries(units.map((x) => [x.id, x])), ...extra };
  return { ...base, combat: { turn: turnKey(base), attacked: [], targets: [to], pending: null, advances: [{ to, units: survivors }] } };
};
/** The definition: all non-empty subsets of the first 12 survivors still on the map, by bit mask, that the engine accepts as an ADVANCE. */
function byDefinition(state: GameState, to: string): Action[] {
  const ids = state.combat!.advances[0]!.units.filter((id) => state.units[id]).slice(0, 12);
  const out: Action[] = [];
  for (let mask = 1; mask < 1 << ids.length; mask++) {
    const action: Action = { type: "ADVANCE", side: state.activeSide, units: ids.filter((_, i) => mask & (1 << i)), to };
    if (applyAction(CTX, state, action).ok) out.push(action);
  }
  return out;
}
const listed = (s: GameState) => legalActions(CTX, s).filter((a) => a.type === "ADVANCE");

const ring = ["M32", "N32", "L32", "L33", "N33", "M31", "L31", "N31", "K31", "O32", "O33", "K32", "K33", "M30"];
const many = (owner: ForceOwner, n: number, type: UnitType = "infantry", prefix = "u") => Array.from({ length: n }, (_, i) => unit(`${prefix}${i}`, owner, type, 2, ring[i]!));

describe("the advance list is every set that fits, by bit mask", () => {
  it("12 German survivors into an empty hex: 12 single units and 66 pairs, none of three (limit two, Ref 5.0)", () => {
    const us = many("germany", 12);
    const s = withAdvance(us, us.map((x) => x.id), "M33", { activeSide: "axis" });
    const l = listed(s);
    expect(l).toHaveLength(78);
    expect(l).toEqual(byDefinition(s, "M33"));
    expect(l[0]).toMatchObject({ units: ["u0"] });
    expect(l[1]).toMatchObject({ units: ["u1"] });
    expect(l[2]).toMatchObject({ units: ["u0", "u1"] });
  });

  it("a friendly unit already in the hex leaves room for one: only single units", () => {
    const us = [...many("germany", 12), unit("held", "germany", "infantry", 2, "M33")];
    const s = withAdvance(us, us.slice(0, 12).map((x) => x.id), "M33", { activeSide: "axis" });
    expect(listed(s)).toEqual(byDefinition(s, "M33"));
    expect(listed(s)).toHaveLength(12);
  });

  it("14 survivors: only the first 12 are considered; one that is gone from the map is skipped", () => {
    const us = many("germany", 14);
    const gone = us.filter((x) => x.id !== "u3");
    const s = withAdvance(gone, us.map((x) => x.id), "M33", { activeSide: "axis" });
    const l = listed(s);
    expect(l).toEqual(byDefinition(s, "M33"));
    expect(l.some((a) => a.type === "ADVANCE" && a.units.includes("u3"))).toBe(false);
    expect(l.some((a) => a.type === "ADVANCE" && a.units.includes("u12"))).toBe(true);
    expect(l.some((a) => a.type === "ADVANCE" && a.units.includes("u13"))).toBe(false);
  });

  it("British and French survivors before 1942 do not share the hex (Ref 26.0): same-nation pairs only", () => {
    const us = [...many("france", 6, "infantry", "f"), ...many("britain", 6, "infantry", "b").map((x, i) => ({ ...x, at: ring[6 + i]! }))];
    const s = withAdvance(us, ["f0", "b0", "f1", "b1", "f2", "b2", "f3", "b3", "f4", "b4", "f5", "b5"], "M33");
    const l = listed(s);
    expect(l).toEqual(byDefinition(s, "M33"));
    expect(l.some((a) => a.type === "ADVANCE" && a.units.includes("f0") && a.units.includes("b0"))).toBe(false);
    expect(l).toHaveLength(12 + 15 + 15);
  });

  it("three British may advance into London, a French one only after the others are counted (Ref 5.0)", () => {
    const us = [...many("britain", 5, "infantry", "b"), unit("f0", "france", "infantry", 2, "K22")];
    const s = withAdvance(us, ["b0", "b1", "b2", "b3", "b4", "f0"], "K23");
    const l = listed(s);
    expect(l).toEqual(byDefinition(s, "K23"));
    expect(l.some((a) => a.type === "ADVANCE" && a.units.length === 3)).toBe(true);
    expect(l.some((a) => a.type === "ADVANCE" && a.units.length === 4)).toBe(false);
  });

  it("air units stack by air factors, not by the ground limit", () => {
    const us = [...many("germany", 6, "infantry", "g"), ...many("germany", 4, "air", "a").map((x, i) => ({ ...x, strength: 3 + i, at: ring[6 + i]! }))];
    const s = withAdvance(us, ["g0", "a0", "g1", "a1", "g2", "a2", "g3", "a3", "g4", "g5"], "M33", { activeSide: "axis" });
    expect(listed(s)).toEqual(byDefinition(s, "M33"));
  });
});
