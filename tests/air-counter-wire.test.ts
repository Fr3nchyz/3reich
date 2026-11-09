import { describe, expect, it } from "vitest";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { newGame } from "../src/engine/game";
import { fingerprint } from "../src/save/fingerprint";
import type { JsonObject, SaveFile } from "../src/save/format";
import { restore } from "../src/save/restore";
import { createSnapshotValidator } from "../src/save/snapshotInvariants";
import { counterAirOf } from "../src/engine/air-counter-wire";
import { resolveCounterAir } from "../src/engine/air-counter";
import { autoAirLosses } from "../src/engine/air-losses";
import { airOf, hasFlown, markFlown, newAirTurn } from "../src/engine/air-record";
import { chooseAction } from "../src/ai/choose";
import { describeEvent } from "../src/ui/eventText";
import { eventSide } from "../src/ui/logSide";
import type { GameState, Unit } from "../src/engine/types";
import { CTX, NO_AIRBASES_LEFT } from "./helpers";
import { at6f, inf, okOf } from "./helpers-move";

const air = (id: string, at: string, strength = 3, owner: Unit["owner"] = "germany"): Unit => inf(id, owner, at, strength, 4, "air");
// Spec 09 R12/R15: real map, M32 attacks Polish Poznan (M33), with air from J32.
function start(seed = 13, a = 5, d = 5): GameState {
  return at6f([inf("g", "germany", "M32"), inf("p", "poland", "M33"), air("a", "J32", a), air("d", "M33", d, "britain")], "axis", undefined,
    { rngState: seed, airbasesPlaced: NO_AIRBASES_LEFT });
}
const end = (step: string): Action => ({ type: "END_STEP", side: "axis", step });
const commit = (units = ["a"], target = "M33"): Action => ({ type: "DESIGNATE_AIR", side: "axis", mission: "counter-air", units, target });
const resolve: Action = { type: "RESOLVE_COUNTER_AIR", side: "axis" };
const at7b = (s = start()) => okOf(applyAction(CTX, s, end("6f"))).state;
const assigned = (s = start()) => okOf(applyAction(CTX, at7b(s), commit())).state;
const at7c = (s = start()) => okOf(applyAction(CTX, assigned(s), end("7b"))).state;

describe("09-9b: counter-air through the real turn flow", () => {
  it("AER73: leaving 7b reaches 7c without rolling; only explicit resolution rolls once", () => {
    const b = assigned();
    expect(b.position).toMatchObject({ step: "7b" });
    const c = okOf(applyAction(CTX, b, end("7b")));
    expect(c.state.position).toMatchObject({ step: "7c" });
    expect(c.state.rngState).toBe(13);
    expect(c.state.units).toEqual(b.units);
    expect(c.events.some((e) => e.type === "AIR_COMBAT_RESOLVED")).toBe(false);
    expect(legalActions(CTX, c.state)).toEqual([resolve]);
    expect(applyAction(CTX, c.state, end("7c")).ok).toBe(false);
    const done = okOf(applyAction(CTX, c.state, resolve));
    expect(done.state.rngState).not.toBe(13);
    expect(counterAirOf(done.state)).toEqual([]);
    expect(applyAction(CTX, done.state, resolve).ok).toBe(false);
    expect(okOf(applyAction(CTX, done.state, end("7c"))).state.position).toMatchObject({ step: "7h" });
  });

  it("AER73: no assignment skips 7c; computer never assigns or chooses the new action", () => {
    const b = at7b();
    expect(legalActions(CTX, b).some((a) => a.type === "DESIGNATE_AIR" && a.mission === "counter-air")).toBe(false);
    expect(chooseAction(CTX, b, { seed: 1 })?.action).toEqual(end("7b"));
    const done = okOf(applyAction(CTX, b, end("7b")));
    expect(done.state.position).toMatchObject({ step: "7h" });
    expect(done.state.rngState).toBe(b.rngState);
    expect(applyAction(CTX, done.state, resolve).ok).toBe(false);
    // Even a hand-built 7c with no work does not list resolution.
    const empty = { ...b, position: { part: "player-turn" as const, turn: 1, step: "7c" } };
    expect(legalActions(CTX, empty)).toEqual([end("7c")]);
    expect(applyAction(CTX, empty, resolve).ok).toBe(false);
    expect(chooseAction(CTX, at7c(), { seed: 1 })?.action.type).not.toBe("RESOLVE_COUNTER_AIR");
  });

  it("AER73: either phasing side resolves its assigned planes at 7c", () => {
    const s = at6f([inf("g", "britain", "M32"), inf("p", "germany", "M33"),
      air("a", "J32", 3, "britain"), air("d", "M33", 3)], "allies", undefined,
    { airbasesPlaced: NO_AIRBASES_LEFT });
    const b = okOf(applyAction(CTX, s, { ...end("6f"), side: "allies" })).state;
    expect(b.position).toMatchObject({ step: "7b" });
    const designated = okOf(applyAction(CTX, b, { ...commit(), side: "allies" })).state;
    expect(legalActions(CTX, designated).some((a) => a.type === "RESOLVE_COUNTER_AIR")).toBe(false);
    const c = okOf(applyAction(CTX, designated, { ...end("7b"), side: "allies" })).state;
    expect(c.position).toMatchObject({ step: "7c" });
    const action: Action = { type: "RESOLVE_COUNTER_AIR", side: "allies" };
    expect(legalActions(CTX, c)).toEqual([action]);
    expect(okOf(applyAction(CTX, c, action)).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "AIR_COMBAT_RESOLVED", kind: "counter-air" }),
    ]));
  });

  it("C1/AER73: old saved state without assignments loads unchanged and adds no 7c work", async () => {
    const old = newGame(CTX.scenario, 13);
    const snapshot = JSON.stringify(old);
    const saved = JSON.parse(snapshot) as JsonObject;
    const save: SaveFile = { format: 2, app: "3reich", title: "Before counter-air assignments",
      savedAt: "2026-11-09T00:00:00.000Z", gameVersion: "old", stateVersion: 1,
      scenario: CTX.scenario.id, seed: 13, humanSide: "axis", start: { kind: "snapshot", state: saved },
      actions: [], setupActions: 0, snapshot: saved, fingerprint: fingerprint(old) };
    const opened = await restore(JSON.stringify(save), CTX, { now: () => 0,
      yield: async () => {}, cancelled: () => false, validateSnapshot: createSnapshotValidator() });
    if (opened.kind !== "opened") throw Error(opened.message);
    expect(opened.via).toBe("replay");
    expect(opened.state).toEqual(old);
    expect(fingerprint(opened.state)).toBe(save.fingerprint);
    expect(opened.state.air).toBeUndefined();
    expect(counterAirOf(opened.state)).toEqual([]);
    expect(JSON.stringify(opened.state)).toBe(snapshot);
    const b = at7b();
    const legacy = JSON.parse(JSON.stringify({ ...b, air: newAirTurn(b) })) as GameState;
    const before = JSON.stringify(legacy);
    expect(airOf(legacy)).toBe(legacy.air);
    expect(counterAirOf(legacy)).toEqual([]);
    expect(legalActions(CTX, legacy)).toEqual(legalActions(CTX, b));
    const continued = replay(CTX, legacy, [end("7b")]);
    expect(continued).toEqual(replay(CTX, b, [end("7b")]));
    expect(continued.state.position).toMatchObject({ step: "7h" });
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it("R12/R5: designation consumes the mission, coalesces a target and keeps the first target's order", () => {
    const s = at7b({ ...start(), units: { ...start().units, base: inf("base", "germany", "J32", 0, 0, "airbase"), b: air("b", "K32", 1), c: air("c", "J32", 1), e: air("e", "N33", 1, "poland") } });
    const one = okOf(applyAction(CTX, s, commit()));
    expect(one.events).toEqual([{ type: "AIR_MISSION_DESIGNATED", mission: "counter-air", units: ["a"], target: "M33" }]);
    expect(hasFlown(one.state, "a")).toBe(true);
    expect(applyAction(CTX, one.state, commit()).ok).toBe(false);
    const two = okOf(applyAction(CTX, one.state, commit(["b"], "N33"))).state;
    const three = okOf(applyAction(CTX, two, commit(["c"]))).state;
    expect(counterAirOf(three)).toEqual([{ target: "M33", units: ["a", "c"] }, { target: "N33", units: ["b"] }]);
    expect(counterAirOf({ ...three, activeSide: "allies" })).toEqual([]);
    expect(newAirTurn(three).counterAir).toBeUndefined(); // no extra serialized field without assignment
  });

  it("R12/R4/R5: refuses wrong side, step, kind, range, neutral target and missing enemy base", () => {
    const b = at7b();
    const cases: Action[] = [
      { ...commit(), side: "allies" } as Action, commit(["g"]), commit(["d"]), commit(["missing"]),
      commit([], "M33"), commit(["a", "a"]), commit(["a"], "ZZ99"), commit(["a"], "M32"),
      commit(["a"], "Q27"), commit(["a"], "I32"),
    ];
    for (const a of cases) expect(applyAction(CTX, b, a).ok).toBe(false);
    expect(applyAction(CTX, start(), commit()).ok).toBe(false);
    expect(applyAction(CTX, b, resolve).ok).toBe(false);
    expect(applyAction(CTX, at7c(), { ...resolve, side: "allies" }).ok).toBe(false);
    expect(applyAction(CTX, markFlown(b, ["a"], "new"), commit()).ok).toBe(false);
    expect(applyAction(CTX, markFlown(b, ["a"], "ground-support"), commit()).ok).toBe(false);
    const noBase = { ...b, units: { ...b.units, d: air("d", "M32", 3, "poland") } };
    expect(applyAction(CTX, noBase, commit(["a"], "M32")).ok).toBe(false);
  });

  it("C2: malformed designation is refused without throwing", () => {
    const b = at7b();
    for (const units of [null, 3, [null], Array(2), Array(101).fill("a"), ["constructor"]]) {
      expect(applyAction(CTX, b, { ...commit(), units } as Action).ok).toBe(false);
    }
    expect(applyAction(CTX, b, { ...commit(), target: null } as unknown as Action).ok).toBe(false);
  });

  it("R7/R6/AER74: automatic breakdown and actual losses return to pools, with a readable log", () => {
    const c = at7c();
    const done = okOf(applyAction(CTX, c, resolve));
    expect(done.state.units.a?.strength).toBe(3);
    expect(done.state.units.d?.strength).toBe(3);
    expect(done.state.units.a?.at).toBe("J32");
    expect(done.state.units.d?.at).toBe("M33");
    expect(done.state.pools.germany!.allowableBuilds).toEqual(expect.arrayContaining([expect.objectContaining({ type: "air", strength: 2, count: 1, returned: true })]));
    expect(done.events.filter((e) => e.type === "UNIT_RETURNED_TO_POOL")).toHaveLength(2);
    const event = done.events.find((e) => e.type === "AIR_COMBAT_RESOLVED")!;
    expect(event).toMatchObject({ rolls: [4, 3], lost: { attacker: 2, defender: 2 } });
    const line = describeEvent(event, CTX, new Set(), new Map(), c);
    expect(line).toMatch(/Counter-air on.*5 against 5.*rolls 4.*3.*losses 2 attacking, 2 defending/);
    expect(line).not.toMatch(/\bu[0-9]+\b/);
    expect(eventSide(event, "axis", c)).toBeNull();
    expect(hasFlown(done.state, "d")).toBe(true);
  });

  it("R7/AER74: automatic losses choose the same counter by id regardless of unit insertion order", () => {
    const s = start(13, 2, 1);
    const withTwo = { ...s, units: { ...s.units, e: air("e", "M33", 1, "britain") } };
    const done = okOf(applyAction(CTX, at7c(withTwo), resolve));
    expect(done.state.units.d).toBeUndefined();
    expect(done.state.units.e).toEqual(withTwo.units.e);
    expect(done.state.units.a).toEqual(withTwo.units.a);
    expect(done.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "AIR_COMBAT_RESOLVED", lost: { attacker: 0, defender: 1 } }),
    ]));
    const reversed = { ...withTwo, units: Object.fromEntries(Object.entries(withTwo.units).reverse()) };
    expect(okOf(applyAction(CTX, at7c(reversed), resolve))).toEqual(done);
  });

  it("R7: elimination routes once, zero-participant defenders stay used, larger winning defenders remain free", () => {
    const c = at7c(start(44, 5, 1));
    const gone = okOf(applyAction(CTX, c, resolve));
    expect(gone.state.units.d).toBeUndefined();
    expect(gone.events.filter((e) => e.type === "UNIT_RETURNED_TO_POOL" && e.unitId === "d")).toHaveLength(1);
    const used = okOf(applyAction(CTX, at7c(markFlown(start(7, 3, 5), ["d"], "ground-support")), resolve));
    expect(used.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "AIR_COMBAT_RESOLVED", combat: expect.objectContaining({ defender: expect.objectContaining({ factors: 0, nationalityDrm: 0 }) }) })]));
    expect(hasFlown(used.state, "d")).toBe(true);
    const free = okOf(applyAction(CTX, at7c(start(11, 3, 5)), resolve));
    expect(free.state.units.d).toBeDefined();
    expect(hasFlown(free.state, "d")).toBe(false);
    expect(hasFlown(free.state, "a")).toBe(true);
  });

  it("R15/AER74: deterministic JSON replay, immutable input, tie die and two targets in designation order", () => {
    const initial = { ...start(14, 5, 5), units: { ...start(14, 5, 5).units, base: inf("base", "germany", "J32", 0, 0, "airbase"), b: air("b", "K32", 2), e: air("e", "N33", 3, "britain") } };
    const actions = [end("6f"), commit(), commit(["b"], "N33"), end("7b"), resolve];
    const snapshot = JSON.stringify(initial);
    Object.values(initial.units).forEach(Object.freeze);
    Object.freeze(initial.units);
    Object.freeze(initial);
    const first = replay(CTX, initial, actions);
    expect(replay(CTX, JSON.parse(snapshot) as GameState, JSON.parse(JSON.stringify(actions)) as Action[])).toEqual(first);
    expect(JSON.stringify(initial)).toBe(snapshot);
    const pure1 = resolveCounterAir({ target: "M33", attacker: [initial.units.a!], defender: [initial.units.d!], rngState: 14 }, (_s, p, n) => autoAirLosses(p, n));
    const pure2 = resolveCounterAir({ target: "N33", attacker: [initial.units.b], defender: [initial.units.e], rngState: pure1.rngState }, (_s, p, n) => autoAirLosses(p, n));
    expect(first.events.filter((e) => e.type === "AIR_COMBAT_RESOLVED")).toEqual([...pure1.events, ...pure2.events]);
    expect(first.state.rngState).toBe(pure2.rngState);
    expect(pure1.events[0]!.combat.tieRoll).not.toBeNull();
    expect(airOf(first.state).counterAir).toEqual([]);
  });
});
