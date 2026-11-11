import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseAction } from "../src/ai/choose";
import { chooseFleetIntercept, chooseFleetMove } from "../src/ai/naval";
import * as policies from "../src/ai/policies";
import { playOne } from "../src/ai/play";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { sideToAct } from "../src/engine/actor";
import { newAirTurn } from "../src/engine/air-record";
import { setManualFleetMove } from "../src/engine/naval-actions";
import { board, counter } from "./board";
import { CTX } from "./helpers";
import type { GameState } from "../src/engine/types";

const enable = () => vi.spyOn(policies, "AI_USES_FLEETS", "get").mockReturnValue(true as never);
afterEach(() => vi.restoreAllMocks());
function position(extra = true): GameState {
  const s = board([
    counter("b1", "britain", "fleet", 9, "K21"),
    ...(extra ? [counter("b2", "britain", "fleet", 9, "N18")] : []),
    counter("g1", "germany", "fleet", 9, "N18"),
    counter("enemy", "germany", "infantry", 3, "L21"),
  ], undefined, { activeSide: "allies", position: { part: "player-turn", turn: 1, step: "6b" }, frontOptions: { western: { option: "attrition" } }, control: { N18: "britain" } });
  return setManualFleetMove({ ...s, air: newAirTurn(s) }, true);
}
const step = (s: GameState) => s.position?.part === "player-turn" ? s.position.step : undefined;
function apply(s: GameState, a: Action): GameState {
  const r = applyAction(CTX, s, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
function at6c(extra = true): GameState {
  let s = apply(position(extra), { type: "MOVE_FLEET", side: "allies", fleet: "b1", to: "N18", front: "western" });
  s = apply(s, { type: "END_STEP", side: "allies", step: "6b" });
  expect(step(s)).toBe("6c");
  return s;
}
const decide = (s: GameState) => chooseAction(CTX, s, { seed: 1 });

describe("spec 12 Part E / spec 05 fleet policy (AER110–AER115)", () => {
  it("AER110/AER116 keeps fleet policy disabled while completing human opted-in steps", () => {
    expect(policies.AI_USES_FLEETS).toBe(false);
    const moving = position();
    expect(legalActions(CTX, moving).some(a => a.type === "MOVE_FLEET")).toBe(true);
    expect(chooseFleetMove(CTX, moving, legalActions(CTX, moving))).toBeUndefined();
    expect(decide(moving)?.action).toEqual({ type: "END_STEP", side: "allies", step: "6b" });
    let passing = at6c();
    expect(legalActions(CTX, passing).some(a => a.type === "DECLARE_INTERCEPT")).toBe(true);
    expect(chooseFleetIntercept(CTX, passing, legalActions(CTX, passing))).toBeUndefined();
    for (const side of ["axis", "allies"] as const) {
      const choice = decide(passing)!;
      expect(choice.action).toEqual({ type: "PASS_INTERCEPT", side });
      expect(legalActions(CTX, passing)).toContainEqual(choice.action);
      passing = apply(passing, choice.action);
    }
    expect(step(passing)).not.toMatch(/^6[cd]$/);
    // A human declaration still requires the computer to complete resolution (spec 09 AER116).
    let s = at6c();
    const declaration = legalActions(CTX, s).find(a => a.type === "DECLARE_INTERCEPT")!;
    s = apply(s, declaration);
    s = apply(s, { type: "PASS_INTERCEPT", side: "axis" });
    s = apply(s, { type: "PASS_INTERCEPT", side: "allies" });
    expect(step(s)).toBe("6d");
    const resolve = decide(s)!;
    expect(resolve.action).toEqual({ type: "RESOLVE_INTERCEPTIONS", side: "allies" });
    expect(legalActions(CTX, s)).toContainEqual(resolve.action);
    expect(apply(s, resolve.action).naval?.interceptsResolved).toBe(true);
    expect(policies.AI_USES_FLEETS).toBe(false);
  });
  it("AER110 leaves old saves without a naval record unchanged", () => {
    enable(); const s = position(); delete s.naval;
    const before = structuredClone(s);
    expect(decide(s)?.action.type).toBe("END_STEP");
    expect(s).toEqual(before);
    expect(s).not.toHaveProperty("naval");
  });
  it.each([undefined, false])("AER110 keeps the independent human gate %s at 6b–6d", flag => {
    enable();
    for (const id of ["6b", "6c", "6d"]) {
      const base = id === "6b" ? position() : at6c();
      const s = { ...base, naval: { ...base.naval!, manualFleetMove: flag }, position: { part: "player-turn" as const, turn: 1 as const, step: id } };
      expect(decide(s)?.action).toEqual({ type: "END_STEP", side: "allies", step: id });
      expect(chooseFleetMove(CTX, s, legalActions(CTX, position()))).toBeUndefined();
      expect(chooseFleetIntercept(CTX, s, legalActions(CTX, at6c()))).toBeUndefined();
    }
  });
  it("AER111/AER114 escapes adjacent hostile ground using a legal deterministic action without changing inputs", () => {
    enable();
    const s = position(), before = structuredClone(s), legal = legalActions(CTX, s), list = structuredClone(legal);
    const d = decide(s)!;
    expect(d.action.type).toBe("MOVE_FLEET");
    expect(d.why).toMatch(/adjacent/);
    expect(legal).toContainEqual(d.action);
    expect(chooseFleetMove(CTX, s, [...legal].reverse())).toEqual(d);
    expect(decide(structuredClone(s))).toEqual(d);
    expect(playOne(CTX, s, { seed: 1 })?.decision).toEqual(d);
    expect(s).toEqual(before); expect(legal).toEqual(list);
  });
  it("AER111 stays when no pocket or adjacent enemy justifies movement", () => {
    enable(); const s = position(); delete s.units.enemy;
    expect(decide(s)?.action.type).toBe("END_STEP");
  });
  it("AER111 approaches a real unsupplied friendly pocket strictly, then stops", () => {
    enable(); const s = position(false); delete s.units.enemy; delete s.units.g1;
    s.activeSide = "axis";
    s.nations.italy.status = "axis";
    s.units.b1 = counter("b1", "italy", "fleet", 9, "U22");
    s.control = { AA19: "italy" };
    s.frontOptions = { mediterranean: { option: "attrition" } };
    s.units.pocket = counter("pocket", "italy", "infantry", 3, "AA19");
    const d = decide(s)!;
    expect(d.action).toMatchObject({ type: "MOVE_FLEET", to: "AA19" });
    expect(d.why).toMatch(/pocket/);
    const next = apply(s, d.action);
    expect(decide(next)?.action.type).not.toBe("MOVE_FLEET");
  });
  it("AER112 counts two hostile bases even if their fleets are used, but counts one base only once", () => {
    enable(); const s = position(false);
    s.units.g2 = counter("g2", "germany", "fleet", 9, "K28");
    s.naval!.used = { g1: "intercept", g2: "intercept" };
    const move = legalActions(CTX, s).filter(a => a.type === "MOVE_FLEET" && a.to === "N18");
    expect(move.length).toBeGreaterThan(0);
    expect(chooseFleetMove(CTX, s, move)).toBeUndefined();
    s.units.g2.at = "N18";
    expect(chooseFleetMove(CTX, s, move)?.action.type).toBe("MOVE_FLEET");
  });
  it("AER113 intercepts equality at the same base, never breaks off, and rejects inferior or distant forces", () => {
    enable(); const s = at6c();
    const d = decide(s)!;
    expect(d.action).toMatchObject({ type: "DECLARE_INTERCEPT", side: "axis", meetingPoint: "M18" });
    expect(d.action).not.toHaveProperty("breakOff", true);
    s.units.g1!.strength = 8;
    expect(decide(s)?.action).toEqual({ type: "PASS_INTERCEPT", side: "axis" });
    s.units.g1!.strength = 9; s.units.g1!.at = "K28";
    expect(decide(s)?.action.type).toBe("PASS_INTERCEPT");
  });
  it("AER113/AER114 accepts one hexside, rejects break-off and selects independent of legal-list order", () => {
    enable(); const s = at6c();
    const legal = legalActions(CTX, s);
    const d = chooseFleetIntercept(CTX, s, legal)!;
    expect(d.action.type).toBe("DECLARE_INTERCEPT");
    expect(chooseFleetIntercept(CTX, s, [...legal].reverse())).toEqual(d);
    const breaking = legal.map(a => a.type === "DECLARE_INTERCEPT" ? { ...a, breakOff: true } : a);
    expect(chooseFleetIntercept(CTX, s, breaking)?.action.type).toBe("PASS_INTERCEPT");
  });
  it("AER115 plays declarations, passes, counter-interceptions and resolution through the real turn flow, deterministically", () => {
    enable();
    function run() {
      let s = at6c(); const actions: Action[] = []; const before = structuredClone(s);
      for (let i = 0; i < 15 && ["6c", "6d"].includes(step(s)!); i++) {
        const snapshot = structuredClone(s), d = decide(s)!;
        expect(d).not.toBeNull(); expect(legalActions(CTX, s)).toContainEqual(d.action);
        expect("side" in d.action && d.action.side).toBe(sideToAct(s));
        expect(decide(snapshot)).toEqual(d); expect(s).toEqual(snapshot);
        actions.push(d.action); s = apply(s, d.action);
      }
      expect(step(s)).not.toMatch(/^6[cd]$/);
      expect(actions.map(a => a.type)).toEqual(["DECLARE_INTERCEPT", "PASS_INTERCEPT", "DECLARE_INTERCEPT", "PASS_INTERCEPT", "PASS_INTERCEPT", "RESOLVE_INTERCEPTIONS"]);
      expect(s.naval!.interceptsResolved).toBe(true);
      expect(before.naval!.interceptions).toBeUndefined();
      return { s, actions };
    }
    expect(run()).toEqual(run());
  });
  it("AER111 refuses escape destinations threatened by adjacent enemy ground", () => {
    enable(); const s = position(false);
    s.units.block = counter("block", "germany", "infantry", 3, "N19");
    const moves = legalActions(CTX, s).filter(a => a.type === "MOVE_FLEET" && a.to === "N18");
    expect(moves.length).toBeGreaterThan(0);
    expect(chooseFleetMove(CTX, s, moves)).toBeUndefined();
  });
  it("AER113 accepts a same-hex declaration and counts factors already committed to that target", () => {
    enable(); let s = at6c();
    const sameHex = legalActions(CTX, s).filter(a => a.type === "DECLARE_INTERCEPT" && a.meetingPoint === "N18");
    expect(chooseFleetIntercept(CTX, s, sameHex)?.action.type).toBe("DECLARE_INTERCEPT");
    s = apply(s, sameHex[0]!);
    s.units.g2 = counter("g2", "germany", "fleet", 1, "N18");
    const d = decide(s)!;
    expect(d.action).toMatchObject({ type: "DECLARE_INTERCEPT", fleets: ["g2"] });
    expect(legalActions(CTX, s)).toContainEqual(d.action);
  });
  it("AER115 two passes without declarations skip resolution without dice", () => {
    enable(); const s = at6c(false); s.units.g1!.strength = 1;
    const one = apply(s, decide(s)!.action);
    const two = apply(one, decide(one)!.action);
    expect(step(two)).not.toMatch(/^6[cd]$/); expect(two.rngState).toBe(s.rngState);
  });
});
