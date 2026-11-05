import { describe, expect, it } from "vitest";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { applySr, hasSrWork } from "../src/engine/sr-action";
import { escortOptions, escortProblem } from "../src/engine/sr-escort";
import { fleetMayAct, markUsed, useOf } from "../src/engine/naval-record";
import { srOf } from "../src/engine/sr-record";
import { board, counter } from "./board";
import { CTX } from "./helpers";
import type { GameState, Unit } from "../src/engine/types";

const ground = (id = "g", at = "L22", type: Unit["type"] = "infantry") => counter(id, "britain", type, 4, at, 3);
const fleet = (id = "f", at = "L22", strength = 9) => counter(id, "britain", "fleet", strength, at);
const position = (units = [ground(), fleet()], tweak: Partial<GameState> = {}) => board(units, undefined, {
  activeSide: "allies", position: { part: "player-turn", turn: 2, step: "9e" }, ...tweak,
});
const action = (escort = "f", to = "M21", units = ["g"]): Extract<Action, { type: "SR_UNITS" }> => ({ type: "SR_UNITS", side: "allies", units, to, escort });

// Spec 16 R22, Ref 21.6, 11.72, Q3; AER29: one hop, ground units and Replacements, one full free fleet per counter, one water Front.
describe("Sea Escort, spec 16 R22 (AER29)", () => {
  it("lists and applies a one-hop escort, charges one allowance, and leaves the fleet in its port", () => {
    const s = position();
    expect(legalActions(CTX, s)).toContainEqual(action());
    const r = applySr(CTX, s, action());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.units.g!.at).toBe("M21");
    expect(r.state.units.f).toEqual(s.units.f);
    expect(r.state.sr).toMatchObject({ used: { britain: 1 }, moved: ["g"], escorted: { g: "f" } });
    expect(useOf(r.state, "f")).toBe("escort");
    expect(fleetMayAct(r.state, "f")).toBe(false);
    expect(s.sr).toBeUndefined();
    expect(s.naval).toBeUndefined();
    expect(r.events).toContainEqual({ type: "UNITS_REDEPLOYED", units: ["g"], from: "L22", to: "M21", nation: "britain", left: 6 });
  });

  it("allows a Replacement and an inland land approach to the fleet's port", () => {
    const s = position([ground("g", "J24", "replacement"), fleet()]);
    expect(escortProblem(CTX, s, ["g"], "M21", "f")).toBeNull();
    expect(applyAction(CTX, s, action()).ok).toBe(true);
  });

  it("requires exactly one counter and exactly nine naval factors", () => {
    expect(applySr(CTX, position([ground(), ground("b"), fleet()]), action("f", "M21", ["g", "b"])).ok).toBe(false);
    for (const strength of [1, 6, 8, 10]) expect(applySr(CTX, position([ground(), fleet("f", "L22", strength)]), action()).ok).toBe(false);
    for (const type of ["air", "airbase", "fleet"] as const) expect(applySr(CTX, position([ground("g", "L22", type), fleet()]), action()).ok).toBe(false);
  });

  it("rejects missing, enemy, inland and previously redeployed escorts", () => {
    expect(applySr(CTX, position(), action("missing")).ok).toBe(false);
    expect(applySr(CTX, position([ground(), { ...fleet(), owner: "germany" }]), action()).ok).toBe(false);
    expect(applySr(CTX, position([ground(), fleet("f", "J24")]), action()).ok).toBe(false);
    const s = position();
    expect(applySr(CTX, { ...s, sr: { ...srOf(s), moved: ["f"] } }, action()).ok).toBe(false);
  });

  it("refuses every prior naval use and gray fleets", () => {
    for (const kind of ["supply", "intercept", "mission", "escort", "new"] as const)
      expect(applySr(CTX, markUsed(position(), ["f"], kind), action()).ok).toBe(false);
    expect(applySr(CTX, position(undefined, { grayFleets: { f: { year: 1941, season: "fall" } } }), action()).ok).toBe(false);
  });

  it("requires friendly ports, an approach to the fleet, a sea route and a single Front", () => {
    expect(applySr(CTX, position(undefined, { control: { M21: "germany" } }), action()).ok).toBe(false);
    expect(applySr(CTX, position(undefined, { control: { L22: "germany" } }), action()).ok).toBe(false);
    expect(applySr(CTX, position([ground("g", "M21"), fleet()]), action("f", "L24")).ok).toBe(false);
    expect(applySr(CTX, position(), action("f", "J24")).ok).toBe(false);
    expect(applySr(CTX, position(undefined, { control: { V19: "britain", K32: "britain" } }), action("f", "V19")).ok).toBe(false);
    expect(applySr(CTX, position(undefined, { control: { K32: "britain" } }), action("f", "K32")).ok).toBe(false);
  });

  it("retains the land rules for enemy adjacency at both ends, overstack and allowance", () => {
    for (const at of ["K22", "N21"]) {
      const s = position([ground(), fleet(), counter("enemy", "germany", "infantry", 2, at, 3)]);
      expect(applySr(CTX, s, action()).ok).toBe(false);
    }
    const crowd = position([ground(), fleet(), ground("a", "M21"), ground("b", "M21"), ground("c", "M21")]);
    expect(applySr(CTX, crowd, action()).ok).toBe(false);
    const s = position();
    expect(applySr(CTX, { ...s, sr: { ...srOf(s), used: { britain: 7 } } }, action()).ok).toBe(false);
    expect(applySr(CTX, { ...s, sr: { ...srOf(s), moved: ["g"] } }, action()).ok).toBe(false);
  });

  it("blocks a second escort and retains use through the other Player Turn, resetting next Game Turn", () => {
    const s = position([ground(), ground("b"), fleet()]);
    const r = applySr(CTX, s, action());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(applySr(CTX, r.state, action("f", "M21", ["b"])).ok).toBe(false);
    expect(useOf({ ...r.state, activeSide: "axis" }, "f")).toBe("escort");
    expect(useOf({ ...r.state, year: r.state.year + 1 }, "f")).toBeUndefined();
  });

  it("keeps an escort-only position at step 9e, but does not offer a non-port onward destination", () => {
    const s = position([ground("g", "GG19"), fleet("f", "GG19")], { control: { GG19: "britain", LL29: "britain" } });
    expect(hasSrWork(CTX, s)).toBe(true);
    expect(escortOptions(CTX, s, s.units.g!).some(o => o.to === "LL29")).toBe(true);
    expect(applySr(CTX, s, action("f", "LL28")).ok).toBe(false);
  });

  it("replays deterministically without touching the input", () => {
    const s = position([ground(), ground("b"), fleet()]);
    expect(replay(CTX, s, [action()])).toEqual(replay(CTX, s, [action()]));
    expect(s.units.g!.at).toBe("L22");
  });
});
