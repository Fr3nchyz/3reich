import { describe, expect, it } from "vitest";
import { createMemory, exportMemory, importMemory } from "../src/ai/memory";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions, replay } from "../src/engine/actions";
import { newGame } from "../src/engine/game";
import { createSession, newSession, placeTheRest, run } from "../src/ui/session";
import { newWatchSession, takeOver, watchSlice } from "../src/ui/watchPlay";

const memoryFixture = () => {
  const m = createMemory();
  m.targets.set("u1", "M35");
  m.left.set("u1", [{ hex: "M34", turn: 2 }]);
  m.quietSince = { axis: 1, allies: 2 };
  m.stallTurn = { axis: 3 };
  m.distances.set("target", new Map([["M35", 0]]));
  m.nearest.set("owner", { dist: new Map(), from: new Map() });
  m.staging.set("owner", { dist: new Map(), from: new Map() });
  m.distancesTurn = 3;
  return m;
};

describe("record every game (spec 11 ticket 11-3, parts B/G)", () => {
  it("starts with an independent empty record before setup (spec 11 ticket 11-3)", () => {
    const s = newSession(SCENARIO_1939, "axis", 7);
    expect(s.record).toEqual([]);
    expect(s.record).not.toBe(newSession(SCENARIO_1939, "axis", 7).record);
    expect(placeTheRest(s)).toBe(true);
    expect(s.record.length).toBeGreaterThan(0);
    expect(replay(s.ctx, newGame(SCENARIO_1939, 7), s.record).state).toEqual(s.state);
  });
  it("records automatic computer setup (spec 11 part B)", () => {
    const s = createSession(SCENARIO_1939, "axis", 7);
    expect(s.record.length).toBeGreaterThan(0);
    expect(replay(s.ctx, newGame(SCENARIO_1939, 7), s.record).state).toEqual(s.state);
  });
  it("keeps only the accepted prefix of a batch (spec 11 part B)", () => {
    const s = newWatchSession(SCENARIO_1939, 7, "slow", null);
    const before = s.record.length;
    const accepted = legalActions(s.ctx, s.state)[0]!;
    expect(run(s, accepted, { type: "SETUP_REMOVE", owner: "germany", unitId: "missing" })).toBe(false);
    expect(s.record.length).toBe(before + 1);
    expect(replay(s.ctx, newGame(SCENARIO_1939, 7), s.record).state).toEqual(s.state);
  });
  it.each(["axis", "allies"] as const)("retains history and appends after takeover as %s (spec 11 part G)", (side) => {
    const s = newWatchSession(SCENARIO_1939, 7, "slow", null);
    watchSlice(s);
    const record = s.record;
    const history = [...record];
    const state = s.state;
    takeOver(s, side);
    expect(s.record).toBe(record);
    expect(s.record).toEqual(history);
    expect(s.state).toBe(state);
    expect(s.watch).toBeUndefined();
    expect(s.humanSide).toBe(side);
    const action = legalActions(s.ctx, s.state)[0]!;
    expect(run(s, action)).toBe(true);
    expect(s.record).toEqual([...history, action]);
    expect(replay(s.ctx, newGame(SCENARIO_1939, 7), s.record).state).toEqual(s.state);
  });
});

describe("memory save data (spec 11 part B, E5)", () => {
  it("round trips persistent memory through JSON (spec 11 part B)", () => {
    const m = memoryFixture();
    const saved = exportMemory(m);
    expect(saved).toEqual({ targets: [["u1", "M35"]], left: [["u1", [{ hex: "M34", turn: 2 }]]], quietSince: { axis: 1, allies: 2 }, stallTurn: { axis: 3 } });
    const restored = importMemory(JSON.parse(JSON.stringify(saved)));
    expect(restored.targets).toEqual(m.targets);
    expect(restored.left).toEqual(m.left);
    expect(restored.quietSince).toEqual(m.quietSince);
    expect(restored.stallTurn).toEqual(m.stallTurn);
    expect(restored.distances.size).toBe(0);
    expect(restored.nearest.size).toBe(0);
    expect(restored.staging.size).toBe(0);
    expect(restored.distancesTurn).toBe(-1);
  });
  it("copies mutable data on export and import (spec 11 part B)", () => {
    const m = memoryFixture();
    const saved = exportMemory(m);
    const restored = importMemory(saved);
    restored.targets.set("u1", "M36");
    restored.left.get("u1")![0]!.turn = 99;
    restored.quietSince.axis = 99;
    restored.stallTurn.axis = 99;
    expect(saved).toEqual(exportMemory(m));
    saved.left[0]![1][0]!.hex = "M36";
    saved.quietSince.axis = 88;
    saved.stallTurn.axis = 88;
    expect(m.left.get("u1")![0]!.hex).toBe("M34");
    expect(m.quietSince.axis).toBe(1);
    expect(m.stallTurn.axis).toBe(3);
  });
  it("uses fresh memory if absent (spec 11 part B)", () => {
    expect(importMemory()).toEqual(createMemory());
    expect(importMemory()).not.toBe(importMemory());
  });
});
