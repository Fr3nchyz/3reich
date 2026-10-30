import { describe, expect, it } from "vitest";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { applyFrontOption, frontOptionOf, legalFrontOptions, WINTER_BAN_TEXT } from "../src/engine/frontoptions";
import type { FrontOption, GameState, PowerId } from "../src/engine/types";
import type { Front } from "../src/engine/map";
import { board } from "./board";
import { CTX } from "./helpers";

// Spec 15 R14 / Ops 5.42: replace/refund only inside the Options step, preserving the existing Russian-winter restriction.
function position(): GameState {
  const s = board([]);
  return { ...s, year: 1942, activeSide: "axis", position: { part: "player-turn", turn: 1, step: "3" }, nations: { ...s.nations,
    germany: { ...s.nations.germany, brpTotal: 100, spendLimit: 100, spent: 7 },
    italy: { ...s.nations.italy, status: "axis", brpTotal: 80, spendLimit: 100, spent: 3 },
  } };
}
const action = (front: Front, option: FrontOption, payer?: PowerId): Extract<Action, { type: "SELECT_FRONT_OPTION" }> => ({ type: "SELECT_FRONT_OPTION", side: "axis", front, option, ...(payer ? { payer } : {}) });
const ok = (r: ReturnType<typeof applyAction>) => { if (!r.ok) throw new Error(r.error); return r; };
const choose = (s: GameState, option: FrontOption, payer?: PowerId, front: Front = "western") => ok(applyAction(CTX, s, action(front, option, payer)));

describe("changing Front Options (spec 15 R14; Ops 5.42)", () => {
  it.each(["attrition", "defensive"] as const)("Offensive to %s refunds the original ledger exactly", (option) => {
    const s = position(), paid = choose(s, "offensive", "germany").state;
    expect(paid.nations.germany).toMatchObject({ brpTotal: 85, spent: 22 });
    const changed = choose(paid, option);
    expect(changed.state.nations).toEqual(s.nations);
    expect(changed.state.frontOptions.western).toEqual({ option });
    expect(changed.events).toContainEqual({ type: "BRPS_CHANGED", nation: "germany", delta: 15, total: 100, reason: "refund of the offensive Option on the western Front" });
    expect(paid.nations.germany.brpTotal).toBe(85);
  });

  it("Attrition to Offensive charges 15 only once and records its payer", () => {
    const s = choose(position(), "attrition").state, changed = choose(s, "offensive", "italy");
    expect(changed.state.nations.italy).toMatchObject({ brpTotal: 65, spent: 18 });
    expect(changed.state.frontOptions.western).toEqual({ option: "offensive", paidBy: "italy" });
    expect(changed.state.nations.germany).toEqual(s.nations.germany);
  });

  it("an unaffordable replacement is not offered and is refused without changing anything", () => {
    const base = position(); base.nations.germany = { ...base.nations.germany, spent: 95 };
    const s = choose(base, "attrition").state, before = JSON.stringify(s);
    expect(legalFrontOptions(CTX, s)).not.toContainEqual(action("western", "offensive", "germany"));
    expect(applyFrontOption(CTX, s, action("western", "offensive", "germany"))).toMatchObject({ ok: false });
    expect(JSON.stringify(s)).toBe(before);
  });

  it("Offensive to the same Offensive is a no-op, even if a different payer is named", () => {
    const s = choose(position(), "offensive", "germany").state;
    const again = ok(applyFrontOption(CTX, s, action("western", "offensive", "italy")));
    expect(again.state).toBe(s); expect(again.events).toEqual([]);
    expect(legalFrontOptions(CTX, s).some((a) => a.type === "SELECT_FRONT_OPTION" && a.front === "western" && a.option === "offensive")).toBe(false);
  });

  it("refunds the recorded payer, regardless of the replacement's named payer", () => {
    const original = position(), paid = choose(original, "offensive", "italy").state;
    const changed = choose(paid, "attrition", "germany");
    expect(changed.state.nations).toEqual(original.nations);
    expect(changed.events).toContainEqual(expect.objectContaining({ type: "BRPS_CHANGED", nation: "italy", delta: 15 }));
  });

  it("changing one Front preserves the others and their charges", () => {
    const original = position();
    const west = choose(original, "offensive", "germany").state;
    const east = choose(west, "offensive", "italy", "eastern").state;
    const changed = choose(east, "attrition").state;
    expect(changed.frontOptions.eastern).toEqual(east.frontOptions.eastern);
    expect(changed.nations.italy).toEqual(east.nations.italy);
    expect(changed.nations.germany).toEqual(original.nations.germany);
  });

  it("repeated changes cannot manufacture BRPs or erase unrelated spending", () => {
    const original = position(); let s = original;
    for (let i = 0; i < 4; i++) { s = choose(s, "offensive", "germany").state; s = choose(s, "defensive").state; }
    expect(s.nations).toEqual(original.nations);
    expect(frontOptionOf(s, "western")).toBe("defensive");
  });

  it("a free scenario Offensive gives no refund", () => {
    const initial = { ...position(), year: 1939, season: "fall" as const };
    const paid = choose(initial, "offensive", undefined, "eastern").state;
    const changed = choose(paid, "attrition", undefined, "eastern");
    expect(changed.state.nations).toEqual(initial.nations);
    expect(changed.events.some((e) => e.type === "BRPS_CHANGED")).toBe(false);
  });

  it("alternatives stay offered inside step 3 and disappear after END_STEP", () => {
    const s = choose(position(), "offensive", "germany").state;
    expect(legalActions(CTX, s)).toContainEqual(action("western", "attrition"));
    const after = ok(applyAction(CTX, s, { type: "END_STEP", side: "axis", step: "3" })).state;
    expect(legalFrontOptions(CTX, after)).toEqual([]);
    expect(applyFrontOption(CTX, after, action("western", "attrition"))).toMatchObject({ ok: false, error: expect.stringMatching(/step 3/) });
    expect(legalActions(CTX, after).some((a) => a.type === "SELECT_FRONT_OPTION")).toBe(false);
  });

  it("the Russian winter still blocks changing to Eastern Offensive", () => {
    const base = position();
    const s: GameState = { ...base, year: 1941, season: "winter", winter: { stage: "over", inForce: "1941-winter", asking: false }, frontOptions: { eastern: { option: "attrition" } } };
    expect(applyFrontOption(CTX, s, action("eastern", "offensive", "germany"))).toEqual({ ok: false, error: WINTER_BAN_TEXT });
    expect(legalFrontOptions(CTX, s).some((a) => a.type === "SELECT_FRONT_OPTION" && a.front === "eastern" && a.option === "offensive")).toBe(false);
  });
});
