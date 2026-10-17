import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { frontOptionOf, FRONTS, legalFrontOptions, optionCost } from "../src/engine/frontoptions";
import { BRP_COSTS } from "../src/engine/tables";
import type { GameState, PowerId } from "../src/engine/types";
import { CTX, NO_AIRBASES_LEFT, atStart, ctxFor } from "./helpers";

/** Spec 02 / roadmap 4.4: Front Options chosen at step 3 (Ref 11.21), stored in the state. */

const ok = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const select = (s: GameState, front: (typeof FRONTS)[number], option: "offensive" | "attrition" | "defensive", payer?: PowerId, ctx = CTX) =>
  applyAction(ctx, s, { type: "SELECT_FRONT_OPTION", side: s.activeSide, front, option, ...(payer ? { payer } : {}) });
/** The Axis turn of Fall 1939 at step 3. */
const at3 = (): GameState => ok(applyAction(CTX, atStart(SCENARIO_1939, 1), { type: "END_STEP", side: "axis", step: "1" })).state;
const withNation = (s: GameState, id: PowerId, patch: Partial<GameState["nations"][PowerId]>): GameState => ({
  ...s,
  nations: { ...s.nations, [id]: { ...s.nations[id], ...patch } },
});

describe("step 3, Select Front Options (Ref 11.21)", () => {
  it("is waited at once step 1 is done, and offers the choices ahead of the move-on action", () => {
    const s = at3();
    expect(s.position).toEqual({ part: "player-turn", turn: 1, step: "3" });
    const legal = legalActions(CTX, s);
    expect(legal.at(-1)).toEqual({ type: "END_STEP", side: "axis", step: "3" });
    expect(legal.slice(0, -1).every((a) => a.type === "SELECT_FRONT_OPTION")).toBe(true);
    expect(new Set(legal.flatMap((a) => (a.type === "SELECT_FRONT_OPTION" ? [a.front] : [])))).toEqual(new Set(FRONTS));
  });

  it("is passed by a side at war with nobody", () => {
    const s = { ...atStart(SCENARIO_1939, 1), wars: [], airbasesPlaced: NO_AIRBASES_LEFT };
    const r = ok(applyAction(CTX, s, { type: "END_STEP", side: "axis", step: "1" }));
    expect(r.state.position).toMatchObject({ step: "8b" });
    expect(r.events.flatMap((e) => (e.type === "STEPS_PASSED" ? e.steps : []))).toContain("3");
  });

  it("is refused at any other step, naming the step", () => {
    const r = select(atStart(SCENARIO_1939, 1), "eastern", "attrition");
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/Front Options are chosen in step 3.*the game is at step 1 /);
  });

  it("is refused for the side that is not up", () => {
    const r = applyAction(CTX, at3(), { type: "SELECT_FRONT_OPTION", side: "allies", front: "western", option: "attrition" });
    expect(r).toMatchObject({ ok: false });
  });
});

describe("what an Option costs", () => {
  it("is nothing for the Attrition and Defensive Options", () => {
    const s = at3();
    for (const option of ["attrition", "defensive"] as const) {
      const r = ok(select(s, "western", option));
      expect(r.state.nations).toEqual(s.nations);
      expect(r.events).toEqual([{ type: "FRONT_OPTION_SELECTED", side: "axis", front: "western", option, cost: 0 }]);
    }
  });

  it("is 15 BRPs for the Offensive Option, paid by the named Major Power within its spending limit", () => {
    expect(BRP_COSTS.offensiveOption).toBe(15);
    const s = at3();
    const r = ok(select(s, "western", "offensive", "germany"));
    expect(r.state.nations.germany).toMatchObject({ brpTotal: 135, spent: 15 });
    expect(r.events[0]).toEqual({ type: "BRPS_CHANGED", nation: "germany", delta: -15, total: 135, reason: "the offensive Option on the western Front" });
    expect(r.state.frontOptions).toEqual({ western: { option: "offensive", paidBy: "germany" } });
  });

  it("needs a payer of the side to move", () => {
    const s = at3();
    expect(select(s, "western", "offensive")).toMatchObject({ ok: false });
    const wrong = select(s, "western", "offensive", "britain");
    expect(wrong).toMatchObject({ ok: false });
    expect(select(s, "western", "offensive", "nobody" as PowerId)).toMatchObject({ ok: false });
  });

  it("is refused beyond the payer's spending limit, naming it", () => {
    const s = withNation(at3(), "germany", { spent: 70 }); // limit 75
    const r = select(s, "western", "offensive", "germany");
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/may spend only 75/);
    expect(legalFrontOptions(CTX, s).some((a) => a.type === "SELECT_FRONT_OPTION" && a.option === "offensive" && a.payer === "germany")).toBe(false);
  });

  it("is free for Germany's opening Eastern Front Offensive Option (Ref 29.0), and only that one", () => {
    const s = at3();
    expect(optionCost(CTX, s, "eastern", "offensive")).toBe(0);
    expect(optionCost(CTX, s, "western", "offensive")).toBe(15);
    const r = ok(select(s, "eastern", "offensive"));
    expect(r.state.nations).toEqual(s.nations);
    expect(r.state.frontOptions).toEqual({ eastern: { option: "offensive" } });
    // Not in a later Game Turn, nor for the Allies.
    expect(optionCost(CTX, { ...s, season: "winter" }, "eastern", "offensive")).toBe(15);
    expect(optionCost(CTX, { ...s, activeSide: "allies" }, "eastern", "offensive")).toBe(15);
    expect(optionCost(ctxFor(SCENARIO_1944), { ...s, year: 1944 }, "eastern", "offensive")).toBe(15);
  });
});

describe("the choice is kept in the state", () => {
  it("is one per Front: a Front with a choice is not offered again and cannot be changed", () => {
    const s = ok(select(at3(), "eastern", "attrition")).state;
    expect(frontOptionOf(s, "eastern")).toBe("attrition");
    expect(legalFrontOptions(CTX, s).some((a) => a.type === "SELECT_FRONT_OPTION" && a.front === "eastern")).toBe(false);
    expect(select(s, "eastern", "defensive")).toMatchObject({ ok: false });
    expect(legalFrontOptions(CTX, s).length).toBeGreaterThan(0);
  });

  it("is the Defensive Option for a Front with no choice (TODO(verify))", () => {
    expect(frontOptionOf(at3(), "mediterranean")).toBe("defensive");
  });

  it("lapses when the next Player Turn begins", () => {
    let s = ok(select(at3(), "eastern", "offensive")).state;
    for (let i = 0; i < 40 && s.activeSide === "axis"; i++) s = ok(applyAction(CTX, s, legalActions(CTX, s).at(-1)!)).state;
    expect(s.activeSide).toBe("allies");
    expect(s.frontOptions).toEqual({});
    expect(s.position).toMatchObject({ turn: 2 });
  });

  it("replays exactly", () => {
    const initial = atStart(SCENARIO_1939, 3);
    const actions: Action[] = [
      { type: "END_STEP", side: "axis", step: "1" },
      { type: "SELECT_FRONT_OPTION", side: "axis", front: "western", option: "offensive", payer: "germany" },
      { type: "SELECT_FRONT_OPTION", side: "axis", front: "eastern", option: "attrition" },
    ];
    const a = replay(CTX, initial, actions).state;
    expect(a.nations.germany.brpTotal).toBe(135);
    expect(replay(CTX, initial, actions).state).toEqual(a);
  });
});
