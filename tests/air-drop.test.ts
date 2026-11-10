import { describe, expect, it, vi } from "vitest";
import { DROP_IMMEDIATE_AUTO_SUPPLY, DROP_RANGE, DROP_REQUIRE_START_ZOC_CLEAR, dropProblem, dropSupplied, dropTargets, dropUnitProblem, dropUnits, resolveDrop, type DropRecord } from "../src/engine/air-drop";
import * as attackRules from "../src/engine/attack-rules";
import { turnKey } from "../src/engine/combat-record";
import type { GameContext } from "../src/engine/context";
import { turnIndex } from "../src/engine/game";
import { distance, hexsideId, parseHexId } from "../src/engine/hex";
import type { MapHex, MapHexside } from "../src/engine/map";
import type { GameState, Unit } from "../src/engine/types";
import { board } from "./board";
import { CTX } from "./helpers";

const para = (id = "p", at = "A1", owner: Unit["owner"] = "germany", type: Unit["type"] = "airborne"): Unit => ({ id, at, owner, type, strength: 3, movement: 3 });
function context(): GameContext {
  const hexes: Record<string, MapHex> = {};
  const hexsides: Record<string, MapHexside> = {};
  for (const row of ["A", "B"]) for (let n = 1; n <= 8; n++) {
    const id = `${row}${n}`;
    hexes[id] = { id, land: "plain", sea: false, country: "germany", front: "eastern", features: id === "A1" ? ["capital"] : [] };
  }
  for (const a of Object.keys(hexes)) for (const b of Object.keys(hexes)) {
    const x = parseHexId(a)!, y = parseHexId(b)!;
    if (distance(x, y) !== 1) continue;
    const id = hexsideId(x, y);
    hexsides[id] = { id, land: true, sea: false };
  }
  return { ...CTX, map: { hexes, hexsides }, supplyEffects: false };
}
const ctx = context();
const position = (units = [para()], tweak: Partial<GameState> = {}): GameState => board(units, undefined, { activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7g" }, ...tweak });
const rec = (start: GameState): DropRecord => ({ start, dropped: {} });
const resolve = (s: GameState, to = "A2", r = rec(s)) => {
  const out = resolveDrop(ctx, s, r, "p", to);
  if (!out.ok) throw new Error(out.error);
  return out;
};

describe("pure normal airdrops (Ref 23.1; Ops 5.46g)", () => {
  it("selects only Phasing airborne present at turn start (Ref 23.1)", () => {
    const s = position([para(), para("z"), para("enemy", "A8", "britain"), para("ground", "A1", "germany", "infantry")]);
    expect(dropUnits(ctx, s, rec(s))).toEqual(["p", "z"]);
    for (const id of ["enemy", "ground", "missing", "constructor"]) {
      expect(dropUnitProblem(ctx, s, rec(s), id)).not.toBeNull();
      expect(dropTargets(ctx, s, rec(s), id)).toEqual([]);
      expect(dropProblem(ctx, s, rec(s), id, "A2")).not.toBeNull();
    }
    expect(dropUnitProblem(ctx, position([para("p", "A1", "germany", "infantry")]), rec(s), "p")).toMatch(/Only an airborne/);
    expect(dropUnitProblem(ctx, s, rec(s), "enemy")).toMatch(/Phasing/);
    const start = position([]);
    expect(dropUnitProblem(ctx, s, rec(start), "p")).toMatch(/starting base/);
    expect(dropUnitProblem(ctx, s, rec(position([para("p", "A1", "britain")])), "p")).toMatch(/starting base/);
    expect(dropUnitProblem(ctx, s, rec(position([para("p", "A1", "germany", "infantry")])), "p")).toMatch(/starting base/);
  });

  it("requires 7g and a snapshot of this Player Turn (Ops 5.46g)", () => {
    const s = position();
    for (const changed of [position([para()], { phase: "setup" }), position([para()], { position: null }), position([para()], { position: { part: "player-turn", turn: 1, step: "7n" } })]) {
      expect(dropUnitProblem(ctx, changed, rec(s), "p")).toMatch(/7g/);
    }
    expect(dropUnitProblem(ctx, s, rec({ ...s, year: s.year + 1 }), "p")).toMatch(/snapshot/);
  });

  it("requires a city or airbase at start, including off-map rejection (Ref 23.1)", () => {
    for (const at of ["A2", "us-box", "ZZ99"]) {
      const s = position([para("p", at)]);
      expect(dropUnitProblem(ctx, s, rec(s), "p")).toMatch(/airbase or city/);
    }
    const s = position([para("p", "A2"), para("base", "A2", "germany", "airbase")]);
    expect(dropUnitProblem(ctx, s, rec(s), "p")).toBeNull();
    expect(dropUnitProblem(ctx, s, rec(position([para("p", "A2")])), "p")).toMatch(/airbase or city/);
  });

  it("uses starting supply even with effects disabled; later supply cannot qualify it (Ref 23.1, 19.3)", () => {
    const s = position();
    const cut = position([para()], { control: { A1: "britain" } });
    expect(dropUnitProblem(ctx, cut, rec(cut), "p")).toMatch(/out of supply/);
    expect(dropUnitProblem(ctx, s, rec(cut), "p")).toMatch(/out of supply/);
    expect(dropUnitProblem(ctx, cut, rec(s), "p")).toBeNull();
  });

  it("refuses moved, returned, newly placed and already dropped units (Ref 23.1)", () => {
    const s = position();
    expect(dropUnitProblem(ctx, { ...s, moves: { turn: turnKey(s), moved: ["p"] } }, rec(s), "p")).toMatch(/starting base/);
    expect(dropUnitProblem(ctx, position([para("p", "A2")]), rec(s), "p")).toMatch(/starting base/);
    expect(dropUnitProblem(ctx, s, { start: s, dropped: { p: turnIndex(s) } }, "p")).toMatch(/already dropped/);
    const stale = { ...s, moves: { turn: "old", moved: ["p"] } };
    expect(dropUnitProblem(ctx, stale, rec(s), "p")).toBeNull();
  });

  it("reads origin ZOC now, allowing earlier combat to clear it (Ref 23.1; errata 31.1; AER59)", () => {
    expect(DROP_REQUIRE_START_ZOC_CLEAR).toBe(false);
    const s = position();
    const enemy = para("tank", "B1", "britain", "armor");
    const blocked = position([para(), enemy]);
    expect(dropUnitProblem(ctx, blocked, rec(s), "p")).toMatch(/enemy ZOC/);
    expect(dropUnitProblem(ctx, s, rec(blocked), "p")).toBeNull();
  });

  it("allows six flight hexes but refuses seven, sea and missing targets (Ref 23.1)", () => {
    const s = position(), r = rec(s);
    expect(DROP_RANGE).toBe(6);
    expect(dropTargets(ctx, s, r, "p")).toContain("A7");
    expect(dropProblem(ctx, s, r, "p", "A8")).toMatch(/too far/);
    expect(dropProblem(ctx, s, r, "p", "ZZ99")).toMatch(/land hex/);
    const sea = context();
    sea.map = { ...sea.map, hexes: { ...sea.map.hexes, A2: { ...sea.map.hexes.A2!, land: null, sea: true } } };
    expect(dropProblem(sea, s, r, "p", "A2")).toMatch(/land hex/);
    expect(dropTargets(ctx, s, r, "p")).toContain("A1"); // any hex within six
  });

  it("cannot cross neutral land or land on it (Ref 23.1, 20.2)", () => {
    const neutral = context();
    neutral.map = { ...neutral.map, hexes: Object.fromEntries(Object.entries(neutral.map.hexes).map(([id, h]) => [id, id.endsWith("2") ? { ...h, country: "spain" } : h])) };
    const s = position();
    expect(dropProblem(neutral, s, rec(s), "p", "A2")).toMatch(/neutral/);
    expect(dropProblem(neutral, s, rec(s), "p", "A3")).toMatch(/neutral/);
  });

  it("uses the target Front's existing Offensive hook (Ref 11.21; spec 09 R14)", () => {
    const hook = vi.spyOn(attackRules, "frontAllowsAttack").mockReturnValue(false);
    try {
      const s = position();
      expect(dropProblem(ctx, s, rec(s), "p", "A2")).toMatch(/Offensive/);
      expect(hook).toHaveBeenCalledWith(ctx, s, "axis", "eastern");
    } finally { hook.mockRestore(); }
  });

  it("AER117: refuses enemy occupation but permits destination ZOC and airborne stacking (Ref 23.0, 23.1)", () => {
    const s = position([para(), para("enemy", "A3", "britain", "armor"), ...[1, 2, 3].map((n) => para(`friend${n}`, "A2", "germany", "infantry"))], { control: { A3: "britain" } });
    expect(resolveDrop(ctx, s, rec(s), "p", "A3")).toEqual({ ok: false, error: expect.stringMatching(/enemy-occupied.*AER117/) });
    const out = resolve(s, "A2");
    expect(out.state.units.p).toEqual({ ...s.units.p, at: "A2" });
    expect(out.state.units.enemy).toEqual(s.units.enemy);
    expect(out.supplied).toBe(true);
    expect(out.state.control).toEqual(s.control);
    expect(out.record.dropped.p).toBe(turnIndex(s));
  });

  it("reports ordinary landing supply and automatic supply only next Game Turn (Ref 23.1, 19.3; AER60)", () => {
    expect(DROP_IMMEDIATE_AUTO_SUPPLY).toBe(false);
    expect(resolve(position()).supplied).toBe(true);
    const s = position([para()], { control: { A3: "britain" } });
    const out = resolve(s, "A3");
    expect(out.supplied).toBe(false);
    const next = { ...out.state, season: "winter" as const }; // 1939 fall -> winter
    expect(turnIndex(next)).toBe(turnIndex(s) + 1);
    expect(dropSupplied(ctx, next, out.record, "p")).toBe(true);
    expect(dropSupplied(ctx, { ...next, activeSide: "allies" }, out.record, "p")).toBe(true);
    expect(dropSupplied(ctx, { ...next, year: 1940, season: "spring" }, out.record, "p")).toBe(false);
    expect(dropSupplied(ctx, next, out.record, "missing")).toBe(false);
    const neutral = position([para("p", "A1", "spain")]);
    expect(dropSupplied(ctx, neutral, rec(neutral), "p")).toBe(false);
  });

  it("rejects an illegal resolution without changing inputs (Ref 23.1)", () => {
    const s = position(), r = rec(s), before = structuredClone({ s, r });
    expect(resolveDrop(ctx, s, r, "p", "A8")).toEqual({ ok: false, error: expect.stringMatching(/too far/) });
    expect({ s, r }).toEqual(before);
  });

  it("is deterministic, preserves RNG and inputs, and ignores insertion order (spec 09 C1)", () => {
    const s = position([para("z"), para()]), r = rec(s), before = structuredClone({ s, r, map: ctx.map });
    expect(resolve(s, "A2", r)).toEqual(resolve(s, "A2", r));
    const out = resolve(s, "A2", r);
    expect(out.state.rngState).toBe(s.rngState);
    expect({ s, r, map: ctx.map }).toEqual(before);
    const reversed = { ...ctx, map: { ...ctx.map, hexes: Object.fromEntries(Object.entries(ctx.map.hexes).reverse()) } };
    expect(dropTargets(reversed, s, r, "p")).toEqual(dropTargets(ctx, s, r, "p"));
    expect(dropUnits(ctx, { ...s, units: Object.fromEntries(Object.entries(s.units).reverse()) }, r)).toEqual(["p", "z"]);
    expect(out.record.start).toBe(s);
    expect(out.record.dropped).not.toBe(r.dropped);
  });
});
