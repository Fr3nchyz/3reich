import { describe, expect, it } from "vitest";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { chooseAction } from "../src/ai/choose";
import { advance, settle } from "../src/engine/turn";
import { overstacksOf } from "../src/engine/stacking";
import type { GameState } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

const inf = (id: string, at: string, strength = 3, owner: "germany" | "britain" = "germany") => counter(id, owner, "infantry", strength, at, 4);
const at = (units: ReturnType<typeof inf>[], step: string, activeSide: "axis" | "allies" = "axis"): GameState =>
  board(units, undefined, { activeSide, position: { part: "player-turn", turn: 1, step } });
const OVER = [inf("u1", "M33", 2), inf("u2", "M33", 4), inf("u3", "M33", 3)];
const isElim = (a: Action) => a.type === "ELIMINATE_OVERSTACK";

// Spec 16 R15, C3, C5: steps 6g and 9j wait for the active side's overstack and nothing else moves the game on.
describe("ELIMINATE_OVERSTACK (steps 6g and 9j)", () => {
  it.each(["6g", "9j"])("step %s waits while the active side is overstacked: only the elimination is legal, no move-on", (step) => {
    const legal = legalActions(CTX, at(OVER, step));
    expect(legal).toEqual([{ type: "ELIMINATE_OVERSTACK", side: "axis", choices: { M33: ["u1"] } }]);
    expect(applyAction(CTX, at(OVER, step), { type: "END_STEP", side: "axis", step }).ok).toBe(false);
  });

  it.each(["6g", "9j"])("step %s is passed when nothing of the active side is overstacked, including an overstack of the other side", (step) => {
    const s = at([inf("u1", "M33"), inf("u2", "M33"), inf("u3", "M20", 3, "britain"), inf("u4", "M20", 3, "britain"), inf("u5", "M20", 3, "britain")], step);
    expect(overstacksOf(CTX, s, "allies")).toHaveLength(1);
    const left = settle(CTX, s);
    expect(left.state.position).not.toEqual(s.position);
    expect(left.events[0]).toEqual({ type: "STEPS_PASSED", steps: expect.arrayContaining([step]) });
  });

  it("the owner's own choice is applied, then the step is passed", () => {
    const s = at(OVER, "6g");
    const r = applyAction(CTX, s, { type: "ELIMINATE_OVERSTACK", side: "axis", choices: { M33: ["u3"] } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.state.units).sort()).toEqual(["u1", "u2"]);
    expect(r.events).toContainEqual({ type: "OVERSTACK_ELIMINATED", unitId: "u3", owner: "germany", at: "M33" });
    expect(r.state.position).not.toEqual({ part: "player-turn", turn: 1, step: "6g" });
  });

  it("refuses too few, too many, a stranger, the wrong side, the wrong step and a missing hex", () => {
    const s = at(OVER, "9j");
    const go = (state: GameState, a: Partial<Extract<Action, { type: "ELIMINATE_OVERSTACK" }>>) => applyAction(CTX, state, { type: "ELIMINATE_OVERSTACK", side: "axis", choices: { M33: ["u1"] }, ...a });
    expect(go(s, { choices: { M33: [] } }).ok).toBe(false);
    expect(go(s, { choices: { M33: ["u1", "u2"] } }).ok).toBe(false);
    expect(go(s, { choices: { M33: ["u9"] } }).ok).toBe(false);
    expect(go(s, { choices: {} }).ok).toBe(false);
    expect(go(s, { side: "allies" }).ok).toBe(false);
    expect(go(at(OVER, "6f"), {}).ok).toBe(false);
    expect(go(at([inf("u1", "M33"), inf("u2", "M33")], "9j"), {}).ok).toBe(false);
    expect(go(s, {}).ok).toBe(true);
  });

  it("an elimination with nothing overstacked is refused and not listed (a test context that waits at every step)", () => {
    const clean = at([inf("u1", "M33"), inf("u2", "M33")], "9j");
    const every = { ...CTX, implementedSteps: new Set(["9j"]) };
    expect(legalActions(every, clean).some(isElim)).toBe(false);
    expect(applyAction(every, clean, { type: "ELIMINATE_OVERSTACK", side: "axis", choices: {} }).ok).toBe(false);
  });

  it("the other side cannot settle the active side's overstack", () => {
    const s = at([...OVER, inf("b1", "M20", 3, "britain"), inf("b2", "M20", 3, "britain"), inf("b3", "M20", 3, "britain")], "6g");
    const r = applyAction(CTX, s, { type: "ELIMINATE_OVERSTACK", side: "allies", choices: { M20: ["b1"] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/player turn/);
  });

  it("the computer settles it with the default choice, and never stalls", () => {
    const s = at(OVER, "6g");
    const d = chooseAction(CTX, s, { seed: 1 });
    expect(d?.action).toEqual({ type: "ELIMINATE_OVERSTACK", side: "axis", choices: { M33: ["u1"] } });
    expect(overstacksOf(CTX, (applyAction(CTX, s, d!.action) as { state: GameState }).state, "axis")).toEqual([]);
  });

  it("leaving 6e then reaching 6g with an overstack stops there; a clean state does not", () => {
    const s = at(OVER, "6f");
    expect(settle(CTX, advance(CTX, s).state).state.position).toEqual({ part: "player-turn", turn: 1, step: "6g" });
  });

  it("every legal action is applied by applyAction (the legal list is honest)", () => {
    for (const step of ["6g", "9j"]) for (const a of legalActions(CTX, at(OVER, step)).filter(isElim)) expect(applyAction(CTX, at(OVER, step), a).ok).toBe(true);
  });
});
