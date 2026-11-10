import { describe, expect, it } from "vitest";
import { applyAction, legalActions, moveOnAction, replay, type Action, type GameEvent } from "../src/engine/actions";
import { sideToAct } from "../src/engine/actor";
import { newAirTurn } from "../src/engine/air-record";
import { setManualFleetMove } from "../src/engine/naval-actions";
import { navalOf } from "../src/engine/naval-record";
import { advance, settle } from "../src/engine/turn";
import type { GameState } from "../src/engine/types";
import { describeEvent } from "../src/ui/eventText";
import { actorSide, eventSide } from "../src/ui/logSide";
import { board, counter } from "./board";
import { CTX } from "./helpers";

const move: Action = { type: "MOVE_FLEET", side: "allies", fleet: "b1", to: "N18", front: "western" };
const declaration: Action = { type: "DECLARE_INTERCEPT", side: "axis", target: "move:0", fleets: ["g1"], meetingPoint: "N18" };
const passAxis: Action = { type: "PASS_INTERCEPT", side: "axis" };
const passAllies: Action = { type: "PASS_INTERCEPT", side: "allies" };
const resolution: Action = { type: "RESOLVE_INTERCEPTIONS", side: "allies" };
const step = (s: GameState) => s.position?.part === "player-turn" ? s.position.step : undefined;
function position(): GameState {
  const s = board([
    counter("b1", "britain", "fleet", 9, "K21"), counter("b2", "britain", "fleet", 9, "K21"),
    counter("g1", "germany", "fleet", 9, "K28"), counter("g2", "germany", "fleet", 9, "K28"),
  ], undefined, { activeSide: "allies", position: { part: "player-turn", turn: 1, step: "6b" },
    frontOptions: { western: { option: "attrition" } }, control: { N18: "britain" } });
  return setManualFleetMove({ ...s, air: newAirTurn(s) }, true);
}
function apply(s: GameState, a: Action) {
  const result = applyAction(CTX, s, a);
  if (!result.ok) throw new Error(result.error);
  return result;
}
function at6c() {
  return apply(apply(position(), move).state, { type: "END_STEP", side: "allies", step: "6b" }).state;
}
function at6d() {
  let s = apply(at6c(), declaration).state;
  s = apply(s, passAxis).state;
  return apply(s, passAllies).state;
}

describe("interception turn wiring (spec 12 R11/R12, Ref 21.5/21.51; AER84–91)", () => {
  it("enters 6c after MOVE_FLEET, starts with Non-Phasing declarations and offers valid deterministic proposals (R11/AER84)", () => {
    const s = at6c(), before = structuredClone(s);
    expect(step(s)).toBe("6c");
    expect(sideToAct(s)).toBe("axis");
    const actions = legalActions(CTX, s);
    expect(actions).toContainEqual({ ...declaration, fleets: ["g1", "g2"] });
    expect(actions.at(-1)).toEqual(passAxis);
    expect(actions.some(a => a.type === "END_STEP")).toBe(false);
    expect(moveOnAction(s)).toEqual([passAxis]);
    expect(actions).toEqual(legalActions(CTX, structuredClone(s)));
    for (const action of actions) expect(applyAction(CTX, s, action).ok).toBe(true);
    expect(s).toEqual(before);
  });

  it("declarations keep the round; passes hand over, declarations reset passes, two passes end it (R11/AER84)", () => {
    const first = apply(at6c(), declaration);
    expect(sideToAct(first.state)).toBe("axis");
    expect(first.events).toEqual([{ type: "INTERCEPTION_DECLARED", side: "axis", interception: "intercept:0", target: "move:0", fleets: ["g1"], meetingPoint: "N18", breakOff: false }]);
    const passed = apply(first.state, passAxis);
    expect(sideToAct(passed.state)).toBe("allies");
    expect(passed.events).toEqual([{ type: "INTERCEPTION_PASSED", side: "axis", consecutive: 1 }]);
    const countered = apply(passed.state, { type: "DECLARE_INTERCEPT", side: "allies", target: "intercept:0", fleets: ["b2"], meetingPoint: "N18" });
    expect(countered.state.naval!.interceptPasses).toBe(0);
    const one = apply(countered.state, passAllies).state;
    expect(step(one)).toBe("6c");
    const two = apply(one, passAxis).state;
    expect(step(two)).toBe("6d");
    expect(sideToAct(two)).toBe("allies");
    expect(legalActions(CTX, two)).toEqual([resolution]);
    expect(moveOnAction(two)).toEqual([resolution]);
  });

  it("two passes without declarations skip empty 6d without rolling (R11/AER84/AER88)", () => {
    const s = at6c();
    const one = apply(s, passAxis).state;
    expect(step(one)).toBe("6c");
    const two = apply(one, passAllies);
    expect(step(two.state)).not.toBe("6c");
    expect(step(two.state)).not.toBe("6d");
    expect(two.events).toContainEqual({ type: "INTERCEPTION_PASSED", side: "allies", consecutive: 2 });
    expect(two.state.rngState).toBe(s.rngState);
  });

  it("holds rounds and queued combat against END_STEP and direct advance (AER84/AER88)", () => {
    for (const s of [at6c(), at6d()]) {
      expect(applyAction(CTX, s, { type: "END_STEP", side: "allies", step: step(s)! }).ok).toBe(false);
      expect(() => advance(CTX, s)).toThrow(/interceptions/i);
      expect(settle(CTX, s).state).toBe(s);
    }
  });

  it.each([undefined, false])("flag %s preserves old 6c/6d skipping and refuses every interception action (AER75/AER85/AER91)", flag => {
    for (const id of ["6c", "6d"]) {
      const base = id === "6c" ? at6c() : at6d();
      const s = { ...base, naval: { ...base.naval!, manualFleetMove: flag }, position: { part: "player-turn" as const, turn: 1 as const, step: id } };
      const before = structuredClone(s);
      expect(legalActions(CTX, s)).toEqual([{ type: "END_STEP", side: "allies", step: id }]);
      expect(moveOnAction(s)).toEqual(legalActions(CTX, s));
      for (const a of [declaration, passAxis, resolution]) expect(applyAction(CTX, s, a).ok).toBe(false);
      expect(step(settle(CTX, s).state)).not.toMatch(/^6[cd]$/);
      expect(s).toEqual(before);
    }
  });

  it("requires a current course and correct step/side; rejects setup and malformed resolution (AER85/AER88/AER90)", () => {
    const base = at6c();
    for (const s of [{ ...base, naval: { ...base.naval!, moves: [] } }, { ...base, year: base.year + 1 }, { ...base, phase: "setup" as const }, position()]) {
      for (const a of [declaration, passAxis, resolution]) expect(applyAction(CTX, s, a).ok).toBe(false);
    }
    expect(applyAction(CTX, base, passAllies).ok).toBe(false);
    expect(applyAction(CTX, base, { ...declaration, side: "allies" }).ok).toBe(false);
    expect(applyAction(CTX, base, resolution).ok).toBe(false);
    const s = at6d();
    expect(applyAction(CTX, s, { ...resolution, side: "axis" }).ok).toBe(false);
    for (const turnBack of [null, ["intercept:0"], ["move:0", "move:0"], ["missing"], Array(1)]) {
      expect(applyAction(CTX, s, { ...resolution, turnBack } as Action).ok).toBe(false);
    }
  });

  it("resolves once with combat/loss events and deterministic replay, preserving input (R12/AER88/AER89)", () => {
    const s = at6d(), before = structuredClone(s);
    const result = apply(s, resolution);
    expect(result.events.some(e => e.type === "INTERCEPTION_ATTEMPTED")).toBe(true);
    expect(result.events.some(e => e.type === "NAVAL_COMBAT_RESOLVED")).toBe(true);
    expect(result.events.some(e => e.type === "NAVAL_LOSSES_APPLIED" || e.type === "UNIT_ELIMINATED")).toBe(true);
    expect(result.state.naval!.interceptsResolved).toBe(true);
    expect(step(result.state)).not.toBe("6d");
    expect(applyAction(CTX, result.state, resolution).ok).toBe(false);
    expect(applyAction(CTX, { ...result.state, position: s.position }, resolution).ok).toBe(false);
    expect(apply(structuredClone(s), resolution)).toEqual(result);
    expect(replay(CTX, s, [resolution])).toEqual({ state: result.state, events: result.events });
    expect(s).toEqual(before);
  });

  it("splits losses into counters, inherits ledger marks and returns every defeated mover remainder (R12/AER89/AER90)", () => {
    const base = at6d();
    const s: GameState = { ...base, units: { ...base.units, g1: { ...base.units.g1!, at: "N18" } }, rngState: 1 };
    const before = structuredClone(s), done = apply(s, resolution);
    const combat = done.events.find(e => e.type === "NAVAL_COMBAT_RESOLVED")!;
    expect(combat.result).toMatchObject({ winner: "interceptor", interceptor: { loss: 2 }, intercepted: { loss: 4 } });
    const losses = done.events.filter(e => e.type === "NAVAL_LOSSES_APPLIED");
    expect(losses.map(e => [e.before.id, e.after.map(u => u.strength)])).toEqual([["g1", [6, 1]], ["b1", [2, 2, 1]]]);
    const ids = losses.flatMap(e => e.after.map(u => u.id));
    expect(new Set(ids).size).toBe(5);
    for (const e of losses) for (const u of e.after) {
      expect(done.state.units[u.id]!.strength).toBe(u.strength);
      if (e.side === "axis") expect(done.state.naval!.used[u.id]).toBe("intercept");
      else {
        expect(done.state.naval!.moved).toContain(u.id);
        expect(done.state.units[u.id]!.at).toBe("K21");
      }
    }
    expect(done.events.filter(e => e.type === "FLEET_RETURNED")).toHaveLength(3);
    expect(done.state.nextUnitId).toBe(s.nextUnitId + 3);
    expect(done.state.units.g2).toEqual(s.units.g2);
    expect(s).toEqual(before);
  });

  it("allocates smaller counters first and routes sunk partials as permanent losses (R12/RB5/AER89)", () => {
    const base = at6c();
    const s = { ...base, units: { ...base.units, g1: { ...base.units.g1!, strength: 2, at: "N18" }, g2: { ...base.units.g2!, at: "N18" } } };
    let next = apply(s, { ...declaration, fleets: ["g2", "g1"] }).state;
    next = apply(apply(next, passAxis).state, passAllies).state;
    const done = apply(next, resolution);
    expect(done.state.units.g1).toBeUndefined();
    expect(done.state.units.g2).toEqual(s.units.g2);
    expect(done.events).toContainEqual(expect.objectContaining({ type: "UNIT_ELIMINATED", unitId: "g1" }));
    expect(done.events).toContainEqual(expect.objectContaining({ type: "UNIT_LOST_FOR_GOOD", unitId: "g1", reason: "partial-fleet" }));
  });

  it("break-off defaults to continue for a victorious mover, with explicit turn-back supported (R12/AER90)", () => {
    const base = at6c();
    const s = { ...base, units: { ...base.units, g1: { ...base.units.g1!, at: "N18" } } };
    const named = apply(s, { ...declaration, breakOff: true }).state;
    const queued = apply(apply(named, passAxis).state, passAllies).state;
    const continued = apply(queued, resolution);
    expect(continued.events.find(e => e.type === "NAVAL_COMBAT_RESOLVED")).toMatchObject({ result: { breakOff: true, winner: "intercepted", interceptor: { loss: 0 }, intercepted: { loss: 0 } } });
    expect(continued.state.units.b1!.at).toBe("N18");
    const returned = apply(queued, { ...resolution, turnBack: ["move:0"] });
    expect(returned.state.units.b1!.at).toBe("K21");
    expect(returned.events).toContainEqual({ type: "FLEET_RETURNED", side: "allies", unit: "b1", from: "N18", to: "K21" });
    expect(returned.state.units.g1!.at).toBe("N18");
  });

  it("expires interception fields with the Player Turn and keeps old JSON defaults empty (AER91)", () => {
    const s = at6d();
    for (const change of [{ activeSide: "axis" as const }, { year: s.year + 1 }]) {
      const rec = navalOf({ ...s, ...change });
      expect(rec.interceptions).toBeUndefined();
      expect(rec.interceptSide).toBeUndefined();
      expect(rec.interceptPasses).toBeUndefined();
      expect(rec.interceptsResolved).toBeUndefined();
    }
    const old = position(); delete old.naval;
    const loaded = JSON.parse(JSON.stringify(old)) as GameState, before = structuredClone(loaded);
    expect(legalActions(CTX, loaded)).toEqual([{ type: "END_STEP", side: "allies", step: "6b" }]);
    expect(navalOf(loaded).interceptions).toBeUndefined();
    expect(loaded).toEqual(before);
  });

  it("logs declaration/pass, attempts, combat and losses with the correct side (AER91)", () => {
    const s = at6c();
    const events: GameEvent[] = [...apply(s, declaration).events, ...apply(s, passAxis).events, ...apply(at6d(), resolution).events];
    expect(actorSide(declaration)).toBe("axis");
    for (const e of events.filter(e => ["INTERCEPTION_DECLARED", "INTERCEPTION_PASSED", "INTERCEPTION_ATTEMPTED", "NAVAL_COMBAT_RESOLVED", "NAVAL_LOSSES_APPLIED", "FLEET_RETURNED"].includes(e.type))) {
      expect(describeEvent(e, CTX, new Set(), new Map(), s)).toMatch(/intercept|Naval combat|naval factors|returns/i);
      expect(eventSide(e, "allies", s)).toBe(e.type === "NAVAL_COMBAT_RESOLVED" ? null : "side" in e ? e.side : "allies");
    }
  });
});
