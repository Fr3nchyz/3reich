import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../src/engine/actions";
import { fleetMoveModel, fleetInterceptModel, destinationKey } from "../src/ui/fleetModel";
import { fleetResultsModel } from "../src/ui/fleetResultsModel";
import { describeEvent } from "../src/ui/eventText";
import { CTX } from "./helpers";
import { position, at6c, at6d, apply, declaration, passAxis, passAllies, resolution } from "./ui-fleet-helpers";

describe("fleet models (spec 12 D3, R10–R13; AER75/AER84–91)", () => {
  it("R10 exposes exactly legal fleets and destination actions, requiring both choices", () => {
    const s = position(), before = structuredClone(s), legal = legalActions(CTX, s);
    const m = fleetMoveModel(CTX, s);
    expect(m.fleets.map(f => f.id)).toEqual(["b1", "b2"]);
    expect(m.action).toBeNull();
    expect(m.destinations).toEqual([]);
    const selected = fleetMoveModel(CTX, s, { fleet: "b1" });
    expect(selected.destinations.map(d => d.action)).toEqual(legal.filter(a => a.type === "MOVE_FLEET" && a.fleet === "b1"));
    const d = selected.destinations.find(d => d.action.to === "N18")!;
    const chosen = fleetMoveModel(CTX, s, { fleet: "b1", destination: d.key });
    expect(chosen.action).toEqual(d.action);
    expect(d.key).toBe(destinationKey(d.action));
    expect(applyAction(CTX, s, chosen.action!).ok).toBe(true);
    expect(chosen.end).toEqual({ type: "END_STEP", side: "allies", step: "6b" });
    expect(s).toEqual(before);
    expect(chosen).toEqual(fleetMoveModel(CTX, structuredClone(s), { fleet: "b1", destination: d.key }));
  });
  it("R10 drops stale/missing fleets and destinations; moved fleets disappear", () => {
    const s = position();
    expect(fleetMoveModel(CTX, s, { fleet: "g1", destination: "western:N18" }).action).toBeNull();
    expect(fleetMoveModel(CTX, s, { fleet: "b1", destination: "missing" }).action).toBeNull();
    const action = fleetMoveModel(CTX, s, { fleet: "b1" }).destinations.find(d => d.action.to === "N18")!.action;
    expect(fleetMoveModel(CTX, apply(s, action).state).fleets.map(f => f.id)).toEqual(["b2"]);
  });
  it.each([false, undefined])("AER75 no new move/interception work with flag %s", flag => {
    const s = position(); s.naval!.manualFleetMove = flag;
    expect(fleetMoveModel(CTX, s).fleets).toEqual([]);
    const c = at6c(); c.naval!.manualFleetMove = flag;
    expect(fleetInterceptModel(CTX, c)).toMatchObject({ targets: [], action: null, pass: null, resolve: null });
  });
  it("R11 lists engine targets, meetings, eligible fleets and exact reach without rolling", () => {
    const s = at6c(), before = structuredClone(s), p = fleetInterceptModel(CTX, s, { point: "N18" });
    const legal = legalActions(CTX, s).filter(a => a.type === "DECLARE_INTERCEPT");
    expect(p.side).toBe("axis");
    expect(p.targets.map(t => t.id)).toEqual(["move:0"]);
    expect(p.targets[0]!.name).toMatch(/British fleet.*Plymouth.*Brest/);
    expect(p.meetings.map(t => t.id)).toEqual(legal.map(a => a.meetingPoint));
    expect(p.fleets.map(f => f.id)).toEqual(["g1", "g2"]);
    expect(p.fleets.map(f => [f.distance, f.needed])).toEqual([[12, [1, 2, 3, 4]], [12, [1, 2, 3, 4]]]);
    expect(p.action).toEqual({ ...declaration, fleets: ["g1", "g2"], breakOff: false });
    expect(p.pass).toEqual(passAxis);
    expect(p).toEqual(fleetInterceptModel(CTX, structuredClone(s), { point: "N18" }));
    expect(s).toEqual(before);
  });
  it("R11/AER90 validates subsets, empty selection and pre-roll break-off", () => {
    const s = at6c();
    for (const breakOff of [false, true]) {
      const p = fleetInterceptModel(CTX, s, { point: "N18", fleets: ["g2"], breakOff });
      expect(p.action).toEqual({ ...declaration, fleets: ["g2"], breakOff });
      expect(applyAction(CTX, s, p.action!).ok).toBe(true);
    }
    expect(fleetInterceptModel(CTX, s, { fleets: [] }).action).toBeNull();
    expect(fleetInterceptModel(CTX, s, { fleets: ["b1", "missing"] }).action).toBeNull();
  });
  it("AER84 hands over on pass and offers counter-targets; 6d offers only Resolve", () => {
    const s = apply(apply(at6c(), declaration).state, passAxis).state;
    const p = fleetInterceptModel(CTX, s);
    expect(p.side).toBe("allies");
    expect(p.targets.map(t => t.id)).toEqual(["intercept:0"]);
    expect(p.fleets.map(f => f.id)).toEqual(["b2"]);
    expect(p.pass).toEqual(passAllies);
    const d = fleetInterceptModel(CTX, at6d());
    expect(d).toMatchObject({ targets: [], action: null, pass: null, resolve: resolution });
  });
  it("AER84 a round without available fleets still has Pass", () => {
    const s = at6c(); s.units = { b1: s.units.b1! }; s.naval!.interceptSide = "axis";
    expect(fleetInterceptModel(CTX, s)).toMatchObject({ targets: [], action: null, pass: passAxis });
  });
  it("R12/AER91 result lines reuse real attempts, dice, modifiers, losses and returns", () => {
    const s = at6d(); s.units.g1 = { ...s.units.g1!, at: "N18" }; s.rngState = 1;
    const before = structuredClone(s), done = apply(s, resolution), r = fleetResultsModel(CTX, s, done.events)!;
    expect(r.lines.some(l => l.includes("automatic; success"))).toBe(true);
    expect(r.lines.some(l => l.includes("nationality +2, advantage +0"))).toBe(true);
    expect(r.lines.some(l => l.includes("remaining counters: 6 + 1"))).toBe(true);
    expect(r.lines.some(l => l.includes("returns from"))).toBe(true);
    const combat = done.events.find(e => e.type === "NAVAL_COMBAT_RESOLVED")!;
    expect(r.lines).toContain(describeEvent(combat, CTX, new Set(), new Map(), s));
    expect(r.lines).toContain(`Interceptors: die ${combat.dice.interceptor}, nationality +2, advantage +0 = ${combat.result.interceptor.modifiedRoll}; ${combat.result.interceptor.loss} naval factors lost.`);
    expect(fleetResultsModel(CTX, s, done.events)).toEqual(r);
    expect(s).toEqual(before);
    expect(fleetResultsModel(CTX, s, [])).toBeNull();
  });
  it("R12 reports failed attempts without inventing a combat or losses", () => {
    const base = at6d();
    const failed = Array.from({ length: 60 }, (_, rngState) => ({ ...base, rngState })).map(s => ({ s, r: apply(s, resolution) })).find(x => !x.r.events.some(e => e.type === "NAVAL_COMBAT_RESOLVED"))!;
    expect(failed).toBeDefined();
    const r = fleetResultsModel(CTX, failed.s, failed.r.events)!;
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/die \d, needs .*failed/);
  });
  it("R12/AER89 includes entirely sunk fleets as well as partial loss events", () => {
    const c = at6c(); c.units.g1 = { ...c.units.g1!, strength: 1, at: "N18" };
    const s = apply(apply(apply(c, declaration).state, passAxis).state, passAllies).state;
    const sunk = Array.from({ length: 60 }, (_, rngState) => ({ ...s, rngState })).map(state => ({ state, r: apply(state, resolution) })).find(x => !x.r.state.units.g1)!;
    expect(sunk).toBeDefined();
    expect(fleetResultsModel(CTX, sunk.state, sunk.r.events)!.lines.join(" ")).toMatch(/Eliminated: 1 German fleet/);
  });
});
