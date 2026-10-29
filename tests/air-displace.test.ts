import { describe, expect, it, vi } from "vitest";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { applyAction } from "../src/engine/actions";
import { airCapacity } from "../src/engine/air-bases";
import { airbaseCapital, displaceAir, displacementBase } from "../src/engine/air-displace";
import { airOf, markFlown } from "../src/engine/air-record";
import type * as AirRules from "../src/engine/air-rules";
import { AIR_DISPLACED_ON_CAPTURE } from "../src/engine/air-rules";
import { afterHexTaken } from "../src/engine/capture";
import type { GameContext } from "../src/engine/context";
import { flightDistances } from "../src/engine/air-range";
import { AIR_BASE_FEATURES } from "../src/engine/terrain";
import type { ForceOwner, GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

// Spec 09 D1 / R9, R2, R3; Ref 20.1, 20.2, 20.51, 5.0. Artificial bases isolate distance/capacity from unrelated map cities.
const plane = (id = "a1", at = "M35", strength = 3, owner: ForceOwner = "poland") => counter(id, owner, "air", strength, at, 4);
const base = (id = "b1", at = "K28", owner: ForceOwner = "germany") => counter(id, owner, "airbase", 1, at);
const onlyBases = (...hexes: string[]): GameContext => ({ ...CTX, map: { ...CTX.map, hexes: Object.fromEntries(Object.entries(CTX.map.hexes).map(([id, h]) => [id, { ...h, features: hexes.includes(id) ? ["city"] : h.features.filter((f) => !AIR_BASE_FEATURES.includes(f)) }])) } });
const held = (units: Unit[], control: GameState["control"]) => board(units, undefined, { control });

describe("captured planes (spec 09 R9, R3)", () => {
  it("enables displacement and chooses the nearest base rather than the farthest", () => {
    expect(AIR_DISPLACED_ON_CAPTURE).toBe(true);
    const u = plane();
    const s = held([u], { M35: "poland", M34: "poland", L31: "poland" });
    expect(flightDistances(CTX, s, u.owner, u.at, 8).get("L31")).toBeGreaterThan(1);
    expect(displacementBase(onlyBases("M34", "L31"), s, u, u.at)).toBe("M34");
    const out = displaceAir(onlyBases("M34", "L31"), s, u.at, [u]);
    expect(out.state.units.a1).toEqual({ ...u, at: "M34" });
    expect(out.events).toEqual([{ type: "AIR_DISPLACED", unitId: "a1", owner: "poland", from: "M35", to: "M34" }]);
    expect(s.units.a1).toBe(u); // pure: the input and its counter are untouched
    expect(out.state.rngState).toBe(s.rngState);
  });

  it("breaks equal flight distances by hex id independently of map insertion order (TODO(verify) A5)", () => {
    const u = plane();
    const ctx = onlyBases("L35", "M34");
    const s = held([u], { L35: "poland", M34: "poland" });
    const d = flightDistances(ctx, s, u.owner, u.at, 8);
    expect(d.get("L35")).toBe(d.get("M34"));
    expect(displacementBase(ctx, s, u, u.at)).toBe("L35");
    const reversed = { ...ctx, map: { ...ctx.map, hexes: Object.fromEntries(Object.entries(ctx.map.hexes).reverse()) } };
    expect(displacementBase(reversed, s, u, u.at)).toBe("L35");
  });

  it("allows eight flight hexes, loses at nine, and routes a loss through the Force Pool (Ref 20.2; spec 17 R1)", () => {
    const u = plane("a1", "J36", 3, "germany");
    const s = held([u], { K28: "germany", M27: "germany" });
    expect(displacementBase(onlyBases("K28"), s, u, u.at)).toBe("K28");
    expect(displacementBase(onlyBases("M27"), s, u, u.at)).toBeNull();
    const lost = displaceAir(onlyBases("M27"), s, u.at, [u]);
    expect(lost.state.units.a1).toBeUndefined();
    expect(lost.events).toEqual(expect.arrayContaining([
      { type: "AIR_DISPLACED", unitId: "a1", owner: "germany", from: "J36", to: null },
      expect.objectContaining({ type: "UNIT_ELIMINATED", unitId: "a1" }),
      expect.objectContaining({ type: "UNIT_RETURNED_TO_POOL", unitId: "a1", pool: "germany" }),
    ]));
    expect(displacementBase(onlyBases("J36"), s, u, u.at)).toBeNull(); // never stay on the captured base
  });

  it("measures a flight route around neutral land rather than straight distance (R9 / R4)", () => {
    const u = plane("a1", "L31", 3, "germany");
    const s = held([u], { K24: "germany", K25: "germany" });
    expect(displacementBase(onlyBases("K24"), s, u, u.at)).toBeNull(); // eight straight, nine by flight
    expect(displacementBase(onlyBases("K25"), s, u, u.at)).toBe("K25"); // eight by flight
  });

  it("fills a city's five factors in numeric unit-id order, then uses the next base (R1 / R9; A5)", () => {
    const a10 = plane("a10"), a2 = plane("a2");
    const s = held([a10, a2], { L35: "poland", M34: "poland" });
    const ctx = onlyBases("L35", "M34");
    const out = displaceAir(ctx, s, "M35", [a10, a2]);
    expect(out.state.units.a2!.at).toBe("L35");
    expect(out.state.units.a10!.at).toBe("M34");
    expect(displaceAir(ctx, s, "M35", [a2, a10])).toEqual(out);
    const full = held([a2, plane("there", "L35", 3)], { L35: "poland" });
    expect(displacementBase(onlyBases("L35"), full, a2, "M35")).toBeNull(); // whole counter needs room
    const fits = plane("small", "M35", 2);
    expect(displacementBase(onlyBases("L35"), full, fits, "M35")).toBe("L35");
  });

  it("uses airbase capacity on open ground, city capacity plus a counter, and the Capital cap (R1)", () => {
    const u = plane("a1", "M35", 5, "germany");
    const s = held([u, base("b1", "M34"), plane("there", "M34", 5, "germany")], { M34: "germany" });
    expect(displacementBase(onlyBases("M34"), s, u, u.at)).toBe("M34");
    expect(displacementBase(onlyBases(), s, u, u.at)).toBeNull(); // counter alone has only five factors
    const empty = held([u, base("b1", "M34")], { M34: "germany" });
    expect(displacementBase(onlyBases(), empty, u, u.at)).toBe("M34");
    const capital = board([base("b1", "L31"), base("b2", "L31"), base("b3", "L31")]);
    expect(airCapacity(CTX, capital, "L31")).toBe(10);
    expect(displacementBase(CTX, { ...capital, units: { ...capital.units, a: plane("a", "L31", 10, "germany") } }, plane("a2", "L30", 1, "germany"), "L30")).not.toBe("L31");
  });

  it("rejects hostile bases, observes printed nationality and Anglo-French/Russian base bans (R3)", () => {
    const ctx = onlyBases("L35", "M34");
    const french = plane("a1", "M35", 3, "france");
    const s = held([french], { L35: "britain", M34: "france" });
    expect(displacementBase(ctx, s, french, french.at)).toBe("M34");
    expect(displacementBase(ctx, { ...s, year: 1942 }, french, french.at)).toBe("L35");
    expect(displacementBase(ctx, { ...s, control: { L35: "germany", M34: "germany" } }, french, french.at)).toBeNull();
    const russian = plane("a1", "M35", 3, "ussr");
    const active = { ...s, nations: { ...s.nations, ussr: { ...s.nations.ussr, status: "allied" as const } }, control: { L35: "britain" as const, M34: "ussr" as const } };
    expect(displacementBase(ctx, active, russian, russian.at)).toBe("M34");
    expect(displacementBase(ctx, active, { ...french, nationality: "ussr" }, french.at)).toBe("M34");
    expect(displacementBase(ctx, held([], { L35: "germany" }), { ...french, owner: "germany", nationality: "italy" }, french.at)).toBe("L35");
  });

  it("respects a fresh airbase's nationality without imposing staging's held-at-start rule (R2 / R9)", () => {
    const u = plane("a1", "M35", 3, "germany");
    const s = held([u, base("b1", "M34", "italy")], { M34: "germany" });
    const fresh = { ...s, nations: { ...s.nations, italy: { ...s.nations.italy, status: "axis" as const } }, air: { ...airOf(s), placed: ["b1"], controlAtStart: { M34: "britain" as const } } };
    expect(displacementBase(onlyBases(), fresh, u, u.at)).toBeNull();
    expect(displacementBase(onlyBases(), fresh, { ...u, nationality: "italy" }, u.at)).toBe("M34");
    expect(displacementBase(onlyBases("M34"), fresh, u, u.at)).toBe("M34"); // city serves independently
  });

  it("preserves flown/staged records, so displacement neither uses nor restores a mission (R9)", () => {
    const u = plane();
    const s = markFlown(held([u], { M34: "poland" }), [u.id], "ground-support");
    const recorded = { ...s, air: { ...airOf(s), staged: [u.id] } };
    const out = displaceAir(onlyBases("M34"), recorded, u.at, [u]);
    expect(out.state.air).toEqual(recorded.air);
    expect(out.state.airFlown).toEqual(recorded.airFlown);
  });
});

describe("captured airbases (spec 09 R2; manager clarification A2-A4)", () => {
  it("returns an airbase to its owner's Capital even if several already stand there; planes use the new capacity", () => {
    const b = base("b3", "L30"), u = plane("a1", "L30", 5, "germany");
    const s = board([b, u, plane("there", "L31", 5, "germany")]);
    const out = displaceAir(CTX, s, "L30", [u, b]);
    expect(out.state.units.b3!.at).toBe("L31");
    expect(out.state.units.a1!.at).toBe("L31");
    const crowded = board([b, base("b1", "L31"), base("b2", "L31")]);
    expect(displaceAir(CTX, crowded, "L30", [b]).state.units.b3!.at).toBe("L31");
    expect(airCapacity(CTX, out.state, "L31")).toBe(10);
  });

  it("reads Moscow from map data for a Soviet airbase (TODO(verify) A2)", () => {
    const ctx = ctxFor(SCENARIO_1942), b = base("b1", "V38", "ussr");
    const s = board([b], SCENARIO_1942);
    expect(airbaseCapital(ctx, s, b, b.at)).toBe("H47");
    expect(displaceAir(ctx, s, b.at, [b]).state.units.b1!.at).toBe("H47");
  });

  it("eliminates a U.S. airbase with no on-map Capital while its planes still displace (TODO(verify) A3)", () => {
    const ctx = ctxFor(SCENARIO_1942), b = base("b1", "L23", "usa"), u = plane("a1", "L23", 3, "usa");
    const s = board([b, u], SCENARIO_1942);
    const out = displaceAir(ctx, s, b.at, [u, b]);
    expect(out.state.units.b1).toBeUndefined();
    expect(out.state.units.a1).toBeDefined();
    expect(out.state.units.a1!.at).not.toBe(b.at);
    expect(out.events).toContainEqual({ type: "AIR_DISPLACED", unitId: "b1", owner: "usa", from: "L23", to: null });
  });

  it("eliminates an airbase if its Capital is enemy-held or is this capture, and still moves the planes (TODO(verify) A4)", () => {
    const b = base(), s = held([b], { L31: "britain" });
    expect(displaceAir(CTX, s, b.at, [b]).state.units.b1).toBeUndefined();
    const b2 = base("b2", "L31"), u = plane("a1", "L31", 3, "germany");
    const out = displaceAir(CTX, board([b2, u]), "L31", [b2, u]); // control still German at battle hook
    expect(out.state.units.b2).toBeUndefined();
    expect(out.state.units.a1).toBeDefined();
    expect(out.state.units.a1!.at).not.toBe("L31");
    const occupied = board([b, counter("enemy", "britain", "infantry", 3, "L31")]);
    expect(airbaseCapital(CTX, occupied, b, b.at)).toBeNull();
  });
});

describe("shared capture switch (spec 09 D1 / R9)", () => {
  it("removes air and airbases from destroy and leaves unrelated counters for the caller", () => {
    const units = [plane("a1", "K28", 3, "germany"), base(), counter("bridge", "germany", "bridgehead", 1, "K28")];
    const out = afterHexTaken(CTX, board(units), "K28", units);
    expect(out.destroy.map((u) => u.id)).toEqual(["bridge"]);
    expect(out.state.units.a1!.at).not.toBe("K28");
    expect(out.state.units.b1!.at).toBe("L31");
  });

  it("restores destruction of both planes and airbases through applyAction when the switch is false", async () => {
    vi.resetModules();
    vi.doMock("../src/engine/air-rules", async (original) => ({ ...(await original<typeof AirRules>()), AIR_DISPLACED_ON_CAPTURE: false }));
    try {
      const actions = await import("../src/engine/actions");
      const { attackPreview } = await import("../src/ui/attackPreview");
      const units = [counter("attacker", "britain", "infantry", 3, "K27"), plane("a1", "K28", 3, "germany"), base()];
      const s = board(units, undefined, { activeSide: "allies", position: { part: "player-turn", turn: 1, step: "7h" } });
      const r = actions.applyAction(CTX, s, { type: "ATTACK", side: "allies", units: ["attacker"], target: "K28" });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.error);
      const preview = attackPreview(CTX, s, "K28", ["attacker"]);
      expect(preview.sweep?.destroyed).toHaveLength(2);
      expect(preview.sweep?.moved).toEqual([]);
      expect(r.state.units.a1).toBeUndefined();
      expect(r.state.units.b1).toBeUndefined();
      expect(r.events.filter((e) => e.type === "UNIT_ELIMINATED")).toHaveLength(2);
      expect(r.events.some((e) => e.type === "AIR_DISPLACED")).toBe(false);
      expect(r.state.rngState).toBe(s.rngState);
    } finally {
      vi.doUnmock("../src/engine/air-rules");
      vi.resetModules();
    }
  });

  it("keeps the ordinary sweep legal through the public action entry point", () => {
    const units = [counter("g1", "germany", "infantry", 3, "M34"), plane()];
    const s = board(units, undefined, { activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7h" } });
    const r = applyAction(CTX, s, { type: "ATTACK", side: "axis", units: ["g1"], target: "M35" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.state.units.a1!.at).toBe("M33"); // Warsaw -> Poznan
  });
});
