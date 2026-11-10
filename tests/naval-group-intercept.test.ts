import { describe, expect, it } from "vitest";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { newAirTurn } from "../src/engine/air-record";
import { fleetMoveGroups } from "../src/engine/fleet-move";
import { setManualFleetMove } from "../src/engine/naval-actions";
import { interceptTargets } from "../src/engine/naval-intercept";
import { navalOf } from "../src/engine/naval-record";
import type { GameState } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

function position() {
  const s = board([
    counter("b1", "britain", "fleet", 9, "K21"), counter("b2", "britain", "fleet", 9, "K21"),
    counter("b3", "britain", "fleet", 9, "K21"), counter("b4", "britain", "fleet", 9, "F24"),
    counter("g1", "germany", "fleet", 9, "K28"), counter("g2", "germany", "fleet", 9, "K28"),
  ], undefined, { activeSide: "allies", position: { part: "player-turn", turn: 1, step: "6b" },
    frontOptions: { western: { option: "attrition" } }, control: { N18: "britain", C33: "britain" } });
  return setManualFleetMove({ ...s, air: newAirTurn(s) }, true);
}
function apply(s: GameState, a: Action) {
  const r = applyAction(CTX, s, a);
  if (!r.ok) throw new Error(r.error);
  return r;
}
const move = (fleet: string, to = "N18"): Action => ({ type: "MOVE_FLEET", side: "allies", fleet, to, front: "western" });
const end: Action = { type: "END_STEP", side: "allies", step: "6b" };
const declare: Extract<Action, { type: "DECLARE_INTERCEPT" }> = { type: "DECLARE_INTERCEPT", side: "axis", target: "move:0", fleets: ["g1", "g2"], meetingPoint: "N18" };
const resolve: Action = { type: "RESOLVE_INTERCEPTIONS", side: "allies" };
function moved() {
  return apply(apply(position(), move("b1")).state, move("b2")).state;
}
function queued(seed = 1, breakOff = false) {
  const s = moved();
  // Same-hex attempts are automatic (R11), isolating the R12 combined-force combat dice.
  const ready = { ...s, rngState: seed, units: { ...s.units, g1: { ...s.units.g1!, at: "N18" }, g2: { ...s.units.g2!, at: "N18" } } };
  let next = apply(apply(ready, end).state, { ...declare, breakOff }).state;
  next = apply(next, { type: "PASS_INTERCEPT", side: "axis" }).state;
  return apply(next, { type: "PASS_INTERCEPT", side: "allies" }).state;
}

describe("one moving interception force (spec 12 R10/R11/R12; TODO(verify) AER119–AER120, N21 open)", () => {
  it("offers only the first move target and refuses the absorbed index after real 6b moves (AER119)", () => {
    const s = apply(moved(), end).state, before = structuredClone(s);
    expect(interceptTargets(s).map(t => [t.id, t.fleets])).toEqual([["move:0", ["b1", "b2"]]]);
    const proposals = legalActions(CTX, s).filter(a => a.type === "DECLARE_INTERCEPT");
    expect(proposals.length).toBeGreaterThan(0);
    expect(new Set(proposals.map(a => a.target))).toEqual(new Set(["move:0"]));
    expect(applyAction(CTX, s, { ...declare, target: "move:1" }).ok).toBe(false);
    expect(s).toEqual(before);
  });

  it("fights 18 against 18 with no advantage, replays deterministically and preserves per-fleet records (AER119/AER120)", () => {
    const s = queued(), before = structuredClone(s), done = apply(s, resolve);
    const combat = done.events.find(e => e.type === "NAVAL_COMBAT_RESOLVED")!;
    expect(combat.intercepted).toEqual(["b1", "b2"]);
    expect(combat.result).toMatchObject({ interceptor: { factors: 18, advantageDrm: 0 }, intercepted: { factors: 18, advantageDrm: 0 } });
    expect(s.naval!.moves!.map(m => m.fleet)).toEqual(["b1", "b2"]);
    expect(replay(CTX, s, [resolve])).toEqual({ state: done.state, events: done.events });
    expect(s).toEqual(before);
  });

  it("replays both moves through declarations and combat from 6b with individual events (AER119/AER120)", () => {
    const s = position(), before = structuredClone(s);
    const actions: Action[] = [move("b1"), move("b2"), end, declare,
      { type: "PASS_INTERCEPT", side: "axis" }, { type: "PASS_INTERCEPT", side: "allies" }, resolve];
    const done = replay(CTX, s, actions);
    expect(done.events.filter(e => e.type === "FLEET_MOVED").map(e => e.fleet)).toEqual(["b1", "b2"]);
    expect(done.events.find(e => e.type === "NAVAL_COMBAT_RESOLVED")).toMatchObject({
      intercepted: ["b1", "b2"], result: { intercepted: { factors: 18 } },
    });
    expect(replay(CTX, JSON.parse(JSON.stringify(s)) as GameState, actions)).toEqual(done);
    expect(s).toEqual(before);
  });

  it("groups nonconsecutive moves but keeps different origins and destinations separate with stable indices (AER119)", () => {
    const actions = [move("b1"), move("b3", "C33"), move("b2"), move("b4")];
    const s = actions.reduce((s, a) => apply(s, a).state, position());
    expect(interceptTargets(apply(s, end).state).map(t => [t.id, t.fleets])).toEqual([
      ["move:0", ["b1", "b2"]], ["move:1", ["b3"]], ["move:3", ["b4"]],
    ]);
  });

  it("keeps distinct Fronts separate and unions recorded courses without mutating them (AER119/AER120)", () => {
    // Supplement real moves with a recorded alternate Front/course to pin the provisional grouping key.
    const s = moved(), moves = s.naval!.moves!;
    const altered = { ...s, naval: { ...s.naval!, moves: [moves[0]!, { ...moves[1]!, front: "eastern" as const }] } };
    expect(fleetMoveGroups(altered).map(g => g.id)).toEqual(["move:0", "move:1"]);
    const extra = { ...s, naval: { ...s.naval!, moves: [moves[0]!, { ...moves[1]!, path: ["K21", "F24", "N18"] }] } };
    const before = structuredClone(extra);
    const groups = fleetMoveGroups(extra);
    expect(groups[0]!.path).toEqual([...moves[0]!.path, "F24"]);
    groups[0]!.fleets.push("other"); groups[0]!.path.pop();
    expect(extra).toEqual(before);
  });

  it("returns every defeated survivor and replacement to the common origin (AER120)", () => {
    const s = queued(5), done = apply(s, resolve);
    expect(done.events.find(e => e.type === "NAVAL_COMBAT_RESOLVED")!.result).toMatchObject({ winner: "interceptor", intercepted: { loss: 2 } });
    const returned = done.events.filter(e => e.type === "FLEET_RETURNED");
    expect(returned.map(e => e.unit)).toContain("b2");
    expect(returned.length).toBeGreaterThan(2);
    for (const e of returned) expect(done.state.units[e.unit]!.at).toBe("K21");
    expect(done.state.units.b3).toEqual(s.units.b3);
  });

  it("turn-back accepts only the group id and returns all surviving members (AER119/AER120)", () => {
    const s = queued(1, true);
    expect(applyAction(CTX, s, { ...resolve, turnBack: ["move:1"] }).ok).toBe(false);
    const done = apply(s, { ...resolve, turnBack: ["move:0"] });
    const returned = done.events.filter(e => e.type === "FLEET_RETURNED");
    expect(returned.map(e => e.unit)).toContain("b2");
    for (const e of returned) expect(done.state.units[e.unit]!.at).toBe("K21");
  });

  it("exposes combined continuing survivors and cancels the whole returned force for sea-air (AER120/AER100)", () => {
    const base = queued(1, true), s = { ...base, naval: { ...base.naval!, manualSeaAir: true } };
    const continued = apply(s, resolve);
    const ids = continued.state.naval!.seaAirForces!["move:0"]!;
    expect(ids).toContain("b2");
    expect(ids.reduce((n, id) => n + continued.state.units[id]!.strength, 0)).toBe(18);
    expect(continued.state.naval!.seaAirForces!["move:1"]).toBeUndefined();
    expect(apply(s, { ...resolve, turnBack: ["move:0"] }).state.naval!.seaAirForces!["move:0"]).toEqual([]);
  });

  it("resolves a queued air mission against both moved fleets through the real turn flow (AER120/R15)", () => {
    const base = moved();
    const s = { ...base, units: { ...base.units, p: counter("p", "germany", "air", 1, "N19"),
      pb: counter("pb", "germany", "airbase", 0, "N19") }, control: { ...base.control, N19: "germany" as const },
      naval: { ...base.naval!, manualSeaAir: true } };
    let next = apply(s, end).state;
    const mission: Action = { type: "DESIGNATE_SEA_AIR", side: "axis", target: "move:0", point: "N18", units: ["p"] };
    expect(legalActions(CTX, next)).toContainEqual(mission);
    expect(applyAction(CTX, next, { ...mission, target: "move:1" }).ok).toBe(false);
    next = apply(next, mission).state;
    next = apply(next, { type: "PASS_INTERCEPT", side: "axis" }).state;
    next = apply(next, { type: "PASS_INTERCEPT", side: "allies" }).state;
    const done = apply(next, { type: "RESOLVE_SEA_AIR", side: "allies" });
    expect(done.state.naval!.seaAirResults![0]!.result!.fleets.map(f => f.id)).toEqual(["b1", "b2"]);
    expect(done.state.naval!.seaAirForces!["move:1"]).toBeUndefined();
  });

  it.each([undefined, false])("preserves ungrouped opt-out records (%s) and expires groups with the turn (AER119/AER120)", flag => {
    const s = moved(), off = { ...s, naval: { ...s.naval!, manualFleetMove: flag } };
    expect(fleetMoveGroups(off).map(g => g.id)).toEqual(["move:0", "move:1"]);
    expect(applyAction(CTX, off, move("b3")).ok).toBe(false);
    for (const change of [{ activeSide: "axis" as const }, { year: s.year + 1 }]) {
      const later = { ...s, ...change };
      expect(navalOf(later).moves).toBeUndefined();
      expect(interceptTargets(later)).toEqual([]);
    }
  });
});
