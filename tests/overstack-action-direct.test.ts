import { describe, expect, it } from "vitest";
import { applyEliminateOverstack, hasOverstackWork, legalOverstack, OVERSTACK_STEPS } from "../src/engine/overstack-action";
import { overstacksOf } from "../src/engine/stacking";
import type { GameState } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 16 R15, C3, C5 (Ops 5.45g, 5.48j): the exported functions called directly, not through applyAction.
const inf = (id: string, at: string, strength = 3, owner: "germany" | "britain" = "germany") => counter(id, owner, "infantry", strength, at, 4);
const at = (units: ReturnType<typeof inf>[], step = "6g", activeSide: "axis" | "allies" = "axis"): GameState =>
  board(units, undefined, { activeSide, position: { part: "player-turn", turn: 1, step } });
const OVER = [inf("u1", "M33", 2), inf("u2", "M33", 4), inf("u3", "M33", 3)];

describe("overstack-action, called directly", () => {
  it("OVERSTACK_STEPS is exactly 6g and 9j", () => {
    expect([...OVERSTACK_STEPS]).toEqual(["6g", "9j"]);
  });

  it("hasOverstackWork: false on a legal board, true when the active side is one over, false for the other side's overstack", () => {
    expect(hasOverstackWork(CTX, at([inf("u1", "M33"), inf("u2", "M33")]))).toBe(false);
    expect(hasOverstackWork(CTX, at(OVER))).toBe(true);
    const theirs = at([inf("b1", "M20", 3, "britain"), inf("b2", "M20", 3, "britain"), inf("b3", "M20", 3, "britain")]);
    expect(overstacksOf(CTX, theirs, "allies")).toHaveLength(1);
    expect(hasOverstackWork(CTX, theirs)).toBe(false);
    expect(hasOverstackWork(CTX, { ...theirs, activeSide: "allies" })).toBe(true);
  });

  it("legalOverstack offers the one default choice for the active side, and nothing without work", () => {
    expect(legalOverstack(CTX, at(OVER))).toEqual([{ type: "ELIMINATE_OVERSTACK", side: "axis", choices: { M33: ["u1"] } }]);
    expect(legalOverstack(CTX, at([inf("u1", "M33")]))).toEqual([]);
  });

  it("applyEliminateOverstack removes the chosen unit and ends the overstack", () => {
    const s = at(OVER);
    const r = applyEliminateOverstack(CTX, s, { type: "ELIMINATE_OVERSTACK", side: "axis", choices: { M33: ["u3"] } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.state.units).sort()).toEqual(["u1", "u2"]);
    expect(overstacksOf(CTX, r.state, "axis")).toEqual([]);
    expect(Object.keys(s.units)).toHaveLength(3); // the old state is untouched
  });

  it("applyEliminateOverstack refuses the wrong side, a malformed choice, a stranger, no work", () => {
    const s = at(OVER);
    const go = (state: GameState, side: "axis" | "allies", choices: unknown) => applyEliminateOverstack(CTX, state, { type: "ELIMINATE_OVERSTACK", side, choices: choices as Record<string, string[]> });
    const wrong = go(s, "allies", { M33: ["u1"] });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toMatch(/axis player turn/);
    expect(go(s, "axis", null).ok).toBe(false);
    expect(go(s, "axis", { M33: ["u9"] }).ok).toBe(false);
    expect(go(s, "axis", { M33: [] }).ok).toBe(false);
    const none = go(at([inf("u1", "M33")]), "axis", {});
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error).toMatch(/overstacked/);
  });

  it("is deterministic: the same state and action give equal results", () => {
    const s = at(OVER);
    const a = { type: "ELIMINATE_OVERSTACK" as const, side: "axis" as const, choices: { M33: ["u1"] } };
    expect(applyEliminateOverstack(CTX, s, a)).toEqual(applyEliminateOverstack(CTX, s, a));
  });
});
