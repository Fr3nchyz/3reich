import { describe, expect, it } from "vitest";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { hasFlown } from "../src/engine/air-record";
import { seaAirOf } from "../src/engine/air-sea-wire";
import { setManualFleetMove } from "../src/engine/naval-actions";
import { navalOf } from "../src/engine/naval-record";
import { advance, settle } from "../src/engine/turn";
import type { GameState } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

const move: Action = { type: "MOVE_FLEET", side: "allies", fleet: "b", to: "N18", front: "western" };
const mission = (units = ["p"]): Extract<Action, { type: "DESIGNATE_SEA_AIR" }> => ({ type: "DESIGNATE_SEA_AIR", side: "axis", target: "move:0", point: "N18", units });
const resolve: Action = { type: "RESOLVE_SEA_AIR", side: "allies" };
const intercept: Action = { type: "DECLARE_INTERCEPT", side: "axis", target: "move:0", fleets: ["g"], meetingPoint: "N18" };
const navalResolve: Action = { type: "RESOLVE_INTERCEPTIONS", side: "allies" };
const end = (step: string): Action => ({ type: "END_STEP", side: "allies", step });
function apply(s: GameState, a: Action) {
  const r = applyAction(CTX, s, a);
  if (!r.ok) throw Error(r.error);
  return r;
}
function position(flag: boolean | undefined = true, strength = 1, seed = 7): GameState {
  const s = board([
    counter("b", "britain", "fleet", 9, "K21"), counter("g", "germany", "fleet", 9, "K28"),
    counter("p", "germany", "air", strength, "N19"), counter("q", "germany", "air", 1, "N19"),
    counter("base", "germany", "airbase", 0, "N19"),
  ], undefined, { activeSide: "allies", position: { part: "player-turn", turn: 1, step: "6b" }, rngState: seed,
    control: { N18: "britain", N19: "germany" }, frontOptions: { western: { option: "attrition" } } });
  const enabled = setManualFleetMove(s, true);
  return { ...enabled, naval: { ...navalOf(enabled), manualSeaAir: flag } };
}
const at6c = (s = position()) => apply(apply(s, move).state, end("6b")).state;
function close(s: GameState) {
  return apply(apply(s, { type: "PASS_INTERCEPT", side: "axis" }).state, { type: "PASS_INTERCEPT", side: "allies" }).state;
}
const queued = (s = position()) => close(apply(at6c(s), mission()).state);

describe("12-16 sea air real turn flow (Ref 20.431/20.45/20.52, AER98–103)", () => {
  it("AER98/AER103: absent/off keeps legal actions, RNG and old JSON unchanged", () => {
    for (const flag of [undefined, false]) {
      const base = position();
      base.naval!.manualSeaAir = flag;
      const s = at6c(base), before = JSON.stringify(s);
      expect(legalActions(CTX, s).some(a => a.type === "DESIGNATE_SEA_AIR")).toBe(false);
      expect(applyAction(CTX, s, mission()).ok).toBe(false);
      const done = close(s);
      expect(done.position).not.toMatchObject({ step: "6d" });
      expect(done.rngState).toBe(s.rngState);
      expect(done.naval?.seaAir).toBeUndefined();
      expect(JSON.stringify(s)).toBe(before);
      expect(legalActions(CTX, JSON.parse(before) as GameState)).toEqual(legalActions(CTX, s));
    }
  });

  it("AER98/AER99/AER101: useful proposals under a defensive Option consume the mission immediately without dice", () => {
    const base = at6c();
    const s: GameState = { ...base, frontOptions: { western: { option: "defensive" } } }, before = structuredClone(s);
    expect(legalActions(CTX, s)).toContainEqual(mission(["p", "q"]));
    const b = apply(s, mission()).state;
    expect(hasFlown(b, "p")).toBe(true);
    expect(b.airFlown?.units.p).toBe("sea-attack");
    expect(b.rngState).toBe(s.rngState);
    expect(applyAction(CTX, b, mission()).ok).toBe(false);
    expect(s).toEqual(before);
    expect(seaAirOf({ ...b, activeSide: "axis" })).toEqual([]);
  });

  it("AER98/AER101: rejects malformed, friendly, used, out-of-range and unusable assignments", () => {
    const s = at6c();
    for (const a of [mission([]), mission(["p", "p"]), mission(["missing"]), mission(["b"]), mission(["__proto__"]),
      { ...mission(), units: Array<string>(1) }, { ...mission(), units: null }, { ...mission(), side: "allies" },
      { ...mission(), target: "missing" }, { ...mission(), point: "A1" }]) {
      expect(applyAction(CTX, s, a as Action).ok).toBe(false);
    }
    for (const at of ["A1", "N18"]) {
      expect(applyAction(CTX, { ...s, units: { ...s.units, p: { ...s.units.p!, at } } }, mission()).ok).toBe(false);
    }
    expect(applyAction(CTX, position(), mission()).ok).toBe(false);
    expect(applyAction(CTX, { ...s, phase: "setup" }, mission()).ok).toBe(false);
  });

  it("AER99: queued work holds 6d, rejects skipping, resolves once explicitly", () => {
    const s = queued();
    expect(s.position).toMatchObject({ step: "6d" });
    expect(legalActions(CTX, s)).toEqual([resolve]);
    expect(settle(CTX, s).state).toBe(s);
    expect(() => advance(CTX, s)).toThrow(/sea air/i);
    expect(applyAction(CTX, s, end("6d")).ok).toBe(false);
    expect(applyAction(CTX, s, { ...resolve, side: "axis" }).ok).toBe(false);
    const done = apply(s, resolve);
    expect(done.state.naval?.seaAirResults?.[0]?.result).toMatchObject({ navalHits: 1, navalLost: 1 });
    expect(seaAirOf(done.state)).toEqual([]);
    expect(applyAction(CTX, done.state, resolve).ok).toBe(false);
    expect(apply(done.state, end("6d")).state.position).not.toMatchObject({ step: "6d" });
  });

  it("R15/AER102: partial fleets retain replacement membership and movement marks for subsequent missions", () => {
    const s = at6c();
    const a = apply(apply(s, mission()).state, mission(["q"])).state;
    const done = apply(close(a), resolve);
    const results = done.state.naval!.seaAirResults!;
    expect(results).toHaveLength(2);
    expect(results[0]!.result!.fleets).toEqual([{ id: "b", counters: [6, 2], lost: 1 }]);
    expect(results[1]!.result!.fleets.map(f => f.id)).toEqual(["b", `u${s.nextUnitId}`]);
    expect(done.state.naval!.moved).toContain(`u${s.nextUnitId}`);
    expect(done.state.units[`u${s.nextUnitId}`]).toMatchObject({ owner: "britain", at: "N18" });
  });

  it("AER99/AER100: naval combat resolves before air, returning moves cancel without air dice", () => {
    const s = apply(at6c(), intercept).state;
    const d = close(apply(s, mission()).state);
    expect(legalActions(CTX, d)).toEqual([navalResolve]);
    expect(applyAction(CTX, d, resolve).ok).toBe(false);
    const fought = apply(d, { ...navalResolve, turnBack: ["move:0"] }).state;
    expect(fought.position).toMatchObject({ step: "6d" });
    const done = apply(fought, resolve).state;
    expect(done.rngState).toBe(fought.rngState);
    expect(done.naval!.seaAirResults![0]!.result).toMatchObject({ status: "no-fleets", rolls: [] });
  });

  it("AER100/AER101: attacks a successful interceptor without Counter-Air at its stored base", () => {
    const base = at6c();
    const s: GameState = { ...base, units: { ...base.units, g: { ...base.units.g!, at: "N18" },
      r: counter("r", "britain", "air", 1, "N18"), rb: counter("rb", "britain", "airbase", 0, "N18") },
      control: { ...base.control, N17: "britain" } };
    const declared = apply(s, { ...intercept, breakOff: true }).state;
    const assigned = apply(declared, { ...mission(["r"]), side: "allies", target: "intercept:0" }).state;
    const fought = apply(close(assigned), navalResolve).state;
    expect(fought.naval!.seaAirForces!["intercept:0"]).toEqual(["g"]);
    const done = apply(fought, resolve).state;
    expect(done.naval!.seaAirResults![0]!.result).toMatchObject({ status: "resolved", fleets: [{ id: "g" }] });
  });

  it("AER100: failed interception consumes its queued air mission without air dice", () => {
    const base = at6c(position(true, 1, 4));
    const s = { ...base, units: { ...base.units, r: counter("r", "britain", "air", 1, "N18") } };
    const declared = apply(s, intercept).state;
    const assigned = apply(declared, { ...mission(["r"]), side: "allies", target: "intercept:0" }).state;
    const fought = apply(close(assigned), navalResolve);
    expect(fought.events).toContainEqual(expect.objectContaining({ type: "INTERCEPTION_ATTEMPTED", success: false }));
    const done = apply(fought.state, resolve).state;
    expect(done.rngState).toBe(fought.state.rngState);
    expect(done.naval!.seaAirResults![0]!.result).toMatchObject({ status: "no-fleets", rolls: [] });
    expect(hasFlown(done, "r")).toBe(true);
  });

  it("AER101: endpoint air does not require Counter-Air; neutral endpoints and distant bases are rejected", () => {
    const s = at6c();
    const defended = { ...s, units: { ...s.units, d: counter("d", "britain", "air", 3, "N18") } };
    expect(apply(close(apply(defended, mission()).state), resolve).state.naval!.seaAirResults![0]!.result!.rolls).toHaveLength(1);
    const neutral = { ...s, control: { ...s.control, N18: "spain" as const } };
    const blocked = applyAction(CTX, neutral, mission());
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatch(/neutral/);
    const far = { ...s, units: { ...s.units, p: { ...s.units.p!, at: "K28" } } };
    const tooFar = applyAction(CTX, far, mission());
    expect(tooFar.ok).toBe(false);
    if (!tooFar.ok) expect(tooFar.error).toMatch(/too far/);
  });

  it("R15/AER102: whole air losses and sinks use existing loss and pool events", () => {
    const lost = apply(queued(position(true, 1, 4)), resolve);
    expect(lost.state.units.p).toBeUndefined();
    expect(lost.events).toContainEqual(expect.objectContaining({ type: "UNIT_RETURNED_TO_POOL", unitId: "p" }));
    const base = position();
    base.units.b = { ...base.units.b!, strength: 1 };
    const sunk = apply(queued(base), resolve);
    expect(sunk.state.units.b).toBeUndefined();
    expect(sunk.events).toContainEqual(expect.objectContaining({ type: "UNIT_ELIMINATED", unitId: "b" }));
  });

  it("AER103: missing attackers or fleets consume work without dice", () => {
    for (const id of ["p", "b"]) {
      const s = queued(), units = { ...s.units }; delete units[id];
      const done = apply({ ...s, units }, resolve).state;
      expect(done.rngState).toBe(s.rngState);
      expect(seaAirOf(done)).toEqual([]);
      expect(done.naval!.seaAirResults![0]!.result).toEqual(id === "p" ? null : expect.objectContaining({ status: "no-fleets" }));
    }
  });

  it("R21/AER103: immutable deterministic JSON replay preserves assignment order", () => {
    const s = at6c(), before = JSON.stringify(s);
    const actions: Action[] = [mission(), mission(["q"]), { type: "PASS_INTERCEPT", side: "axis" }, { type: "PASS_INTERCEPT", side: "allies" }, resolve];
    const result = replay(CTX, s, actions);
    expect(replay(CTX, JSON.parse(before) as GameState, actions)).toEqual(result);
    expect(result.state.naval!.seaAirResults!.map(r => r.result!.flown)).toEqual([["p"], ["q"]]);
    expect(JSON.stringify(s)).toBe(before);
  });
});
