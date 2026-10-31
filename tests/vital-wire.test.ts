import { describe, expect, it } from "vitest";
import { advance } from "../src/engine/turn";
import { runYearStartSequence } from "../src/engine/yearstart";
import { settleVitalAreas } from "../src/engine/vital-wire";
import type { ForceOwner, GameState } from "../src/engine/types";
import { board } from "./board";
import { CTX } from "./helpers";
import { describeEvent } from "../src/ui/session";

// Spec 14 R8, ticket 14-22b; Ref 32.0, 34.0; TODO(verify) V27: the wiring of the vital production area losses.
const at7p = (control: Record<string, ForceOwner | null>, tweak: Partial<GameState> = {}): GameState =>
  ({ ...board([]), activeSide: "axis", firstSide: "axis", position: { part: "player-turn", turn: 1, step: "7p" }, control, ...tweak });
const britain = (s: GameState) => s.nations.britain.brpTotal;

describe("settleVitalAreas", () => {
  it("costs nothing while the Allies hold all three cities, and writes no flag", () => {
    const s = at7p({});
    const r = settleVitalAreas(CTX, s);
    expect(r.events).toEqual([]);
    expect(r.state).toBe(s);
  });
  it("takes 25 BRPs for Gibraltar with one event naming it, and sets only that flag", () => {
    const s = at7p({ AA7: "germany" });
    const r = settleVitalAreas(CTX, s);
    expect(britain(r.state)).toBe(britain(s) - 25);
    expect(r.state.vitalPaid).toEqual({ gibraltar: true });
    expect(r.events).toEqual([{ type: "BRPS_CHANGED", nation: "britain", delta: -25, total: britain(s) - 25, reason: expect.stringContaining("Gibraltar") }]);
  });
  it("takes 25 for Suez with Alexandria and writes one event per area with a running total", () => {
    const s = at7p({ AA7: "germany", MM30: "germany", LL29: "germany" });
    const r = settleVitalAreas(CTX, s);
    expect(r.events.map((e) => e.type === "BRPS_CHANGED" && [e.delta, e.total])).toEqual([[-25, britain(s) - 25], [-25, britain(s) - 50]]);
    expect(r.state.vitalPaid).toEqual({ gibraltar: true, suez: true });
  });
  it("pays once only, and does not refund a retaken city", () => {
    const first = settleVitalAreas(CTX, at7p({ AA7: "germany" }));
    const again = settleVitalAreas(CTX, first.state);
    expect(again.events).toEqual([]);
    const back = settleVitalAreas(CTX, { ...first.state, control: { AA7: "britain" } });
    expect(britain(back.state)).toBe(britain(first.state));
    expect(back.state.vitalPaid).toEqual({ gibraltar: true });
    expect(settleVitalAreas(CTX, { ...first.state, control: { AA7: "germany" } }).events).toEqual([]);
  });
  it("lets the total go below zero (a deficit) and leaves a conquered Britain and a finished game alone", () => {
    const poor = at7p({ AA7: "germany" });
    const s = { ...poor, nations: { ...poor.nations, britain: { ...poor.nations.britain, brpTotal: 10 } } };
    expect(britain(settleVitalAreas(CTX, s).state)).toBe(-15);
    const gone = { ...s, nations: { ...s.nations, britain: { ...s.nations.britain, status: "conquered" as const } } };
    expect(settleVitalAreas(CTX, gone).events).toEqual([]);
    expect(settleVitalAreas(CTX, { ...s, phase: "game-over" }).events).toEqual([]);
  });
  it("is part of leaving step 7p, for either side", () => {
    const s = at7p({ AA7: "germany" });
    const r = advance(CTX, s);
    expect(britain(r.state)).toBe(britain(s) - 25);
    expect(r.events.filter((e) => e.type === "BRPS_CHANGED")).toHaveLength(1);
    const quiet = advance(CTX, at7p({}));
    expect(britain(quiet.state)).toBe(britain(s));
  });
  it("an older saved game, without the field, still loads and plays", () => {
    const s = at7p({});
    expect("vitalPaid" in s).toBe(false);
    expect(() => advance(CTX, s)).not.toThrow();
  });
});

describe("the deficit and the Year Start Sequence", () => {
  it("a deficit earns no growth and is taken from the new total", () => {
    const s: GameState = { ...board([]), year: 1941, nations: { ...board([]).nations } };
    const at = (total: number) => runYearStartSequence(CTX, { ...s, nations: { ...s.nations, britain: { ...s.nations.britain, brpTotal: total } } }).state.nations.britain;
    expect(at(-15).brpBase).toBe(at(0).brpBase);
    expect(at(-15).brpTotal).toBe(at(0).brpTotal - 15);
    expect(at(40).brpBase).toBeGreaterThanOrEqual(at(0).brpBase);
  });
});

describe("the log", () => {
  it("shows the loss as a BRPs line", () => {
    const e = settleVitalAreas(CTX, at7p({ AA7: "germany" })).events[0]!;
    const st = at7p({ AA7: "germany" });
    expect(describeEvent(e, CTX, new Set(), new Map(), st)).toMatch(/Britain: -25 BRPs \(Gibraltar.*\)/);
  });
});
