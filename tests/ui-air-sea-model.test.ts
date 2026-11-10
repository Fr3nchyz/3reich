import { describe, expect, it } from "vitest";
import { legalActions } from "../src/engine/actions";
import { markFlown } from "../src/engine/air-record";
import { airSeaModel } from "../src/ui/airSeaModel";
import { CTX } from "./helpers";
import { counter } from "./board";
import { declaration } from "./ui-fleet-helpers";
import { apply, designation, queued, resolution, seaSession } from "./ui-air-sea-helpers";
const draft = { units: ["p"], target: "move:0", point: "N18" };

describe("12-17 sea-air pure model (spec 12 R15, AER98–103)", () => {
  it("AER98: only engine-listed human planes, courses and points are offered", () => {
    const s = seaSession(), m = airSeaModel(CTX, s.state, "axis", draft)!;
    expect(m.planes.map(p => p.id)).toEqual(["p", "q"]);
    expect(m.targets).toHaveLength(1);
    expect(m.targets[0]!.text).toContain("British fleet");
    expect(m.points.map(p => p.id)).toEqual(legalActions(CTX, s.state).flatMap(a => a.type === "DESIGNATE_SEA_AIR" ? [a.point] : []));
    expect(m.action).toEqual(designation);
    expect(m.factors).toBe(1);
    expect(m.planes.map(p => p.chosen)).toEqual([true, false]);
    expect(m.resolve).toBeNull();
  });
  it("AER98: defaults require a plane and target; empty or stale drafts cannot confirm", () => {
    const { state } = seaSession();
    for (const d of [{}, { ...draft, units: [] }, { ...draft, units: ["missing"] },
      { ...draft, units: ["p", "missing"] }, { ...draft, target: "bad" }, { ...draft, point: "bad" }]) {
      expect(airSeaModel(CTX, state, "axis", d)!.action).toBeNull();
    }
    expect(airSeaModel(CTX, state, "axis", { units: ["p"], target: "move:0" })!.action).not.toBeNull();
  });
  it("AER98/AER103: absent/off, wrong step, setup and expired records create no card", () => {
    const { state } = seaSession();
    for (const manualSeaAir of [undefined, false]) expect(airSeaModel(CTX, { ...state, naval: { ...state.naval!, manualSeaAir } }, "axis")).toBeNull();
    expect(airSeaModel(CTX, { ...state, phase: "setup" }, "axis")).toBeNull();
    expect(airSeaModel(CTX, { ...state, phase: "game-over" }, "axis")).toBeNull();
    expect(airSeaModel(CTX, { ...state, position: null }, "axis")).toBeNull();
    expect(airSeaModel(CTX, { ...state, position: { part: "player-turn", turn: 1, step: "6f" } }, "axis")).toBeNull();
    expect(airSeaModel(CTX, { ...state, activeSide: "axis" }, "axis")).toBeNull();
    expect(airSeaModel(CTX, state, "allies")).toBeNull();
  });
  it("AER99: either side can designate independently of the interception actor", () => {
    const s = seaSession();
    s.state = apply(s.state, { type: "PASS_INTERCEPT", side: "axis" }).state;
    expect(s.state.naval?.interceptSide).toBe("allies");
    expect(airSeaModel(CTX, s.state, "axis", draft)!.action).toEqual(designation);
  });
  it("R15/AER99: moving-side air can target interceptors; naval dice precede air resolution", () => {
    const s = seaSession();
    s.state = { ...s.state, units: { ...s.state.units, r: counter("r", "britain", "air", 1, "N18"), rb: counter("rb", "britain", "airbase", 0, "N18") } };
    s.state = apply(s.state, declaration).state;
    const m = airSeaModel(CTX, s.state, "allies", { units: ["r"], target: "intercept:0", point: "N18" })!;
    expect(m.targets[0]!.text).toContain("German fleet");
    expect(m.action).toMatchObject({ side: "allies", target: "intercept:0", units: ["r"] });
    s.state = apply(s.state, m.action!).state;
    for (const side of ["axis", "allies"] as const) s.state = apply(s.state, { type: "PASS_INTERCEPT", side }).state;
    expect(airSeaModel(CTX, s.state, "allies")!.resolve).toBeNull();
    s.state = apply(s.state, { type: "RESOLVE_INTERCEPTIONS", side: "allies" }).state;
    expect(airSeaModel(CTX, s.state, "allies")!.resolve).toEqual(resolution);
  });
  it("AER99: chosen subset commits immediately, used planes disappear, queue is readable", () => {
    const s = seaSession(), state = apply(s.state, designation).state;
    const m = airSeaModel(CTX, state, "axis", draft)!;
    expect(m.planes.map(p => p.id)).toEqual(["q"]);
    expect(m.action).toBeNull();
    expect(m.assigned[0]).toMatchObject({ point: "Brest (N18)", planes: ["1 German air"] });
    expect(m.assigned[0]!.target).toContain("British fleet");
    expect(airSeaModel(CTX, markFlown(state, ["q"], "new"), "axis")!.planes).toEqual([]);
    expect(m.resolve).toBeNull();
  });
  it("AER99: Resolve belongs to the active side after declarations close", () => {
    const s = queued();
    expect(airSeaModel(CTX, s.state, "allies")!.resolve).toEqual(resolution);
    expect(airSeaModel(CTX, s.state, "axis")!.resolve).toBeNull();
    expect(airSeaModel(CTX, s.state, "axis")!.planes).toEqual([]);
  });
  it("R15/AER102–103: actual result dice, hits and breakdown losses are displayed", () => {
    const s = queued(), done = apply(s.state, resolution).state;
    const m = airSeaModel(CTX, done, "allies")!;
    expect(m.results).toHaveLength(1);
    expect(m.results[0]!.title).toContain("Axis:");
    expect(m.results[0]!.lines).toEqual(["Factor dice: 1.", "Actual losses: 0 air factors; 1 naval hits, 1 naval factors lost."]);
    expect(m.resolve).toBeNull();
    const lost = queued(); lost.state = { ...lost.state, rngState: 4 };
    const lostResult = airSeaModel(CTX, apply(lost.state, resolution).state, "allies")!.results[0]!;
    expect(lostResult.lines).toEqual(["Factor dice: 6.", "Actual losses: 1 air factors; 0 naval hits, 0 naval factors lost."]);
    expect(airSeaModel(CTX, { ...done, activeSide: "axis" }, "axis")).toBeNull();
  });
  it("AER100/AER103: no remaining air or ships means no dice, no invented losses", () => {
    for (const id of ["p", "b1"]) {
      const s = queued(), units = { ...s.state.units }; delete units[id];
      const done = apply({ ...s.state, units }, resolution).state;
      const lines = airSeaModel(CTX, done, "allies")!.results[0]!.lines;
      expect(lines).toEqual([id === "p" ? "No attacking planes remain. No dice rolled." : "No participating fleets remain. No dice rolled."]);
    }
  });
  it("R15/D5: repeated previews preserve state, queue and RNG exactly", () => {
    const s = seaSession(), before = JSON.stringify(s.state);
    expect(airSeaModel(CTX, s.state, "axis", draft)).toEqual(airSeaModel(CTX, s.state, "axis", draft));
    expect(JSON.stringify(s.state)).toBe(before);
  });
});
