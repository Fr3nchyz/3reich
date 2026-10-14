import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { availableBuilds, buildCost, buildPlaces, legalBuilds } from "../src/engine/construction";
import { hex, hexId as hexIdOf, neighbors, ROW_COUNT } from "../src/engine/hex";
import type { GameState, PowerId, Unit } from "../src/engine/types";
import { CTX, atStart, ctxFor } from "./helpers";

/** Spec 02: construction at step 8b (Ref 11.6): costs, the spending limit, Allowable Builds, dates and where a build may stand. */

const ok = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
/** The Axis turn of Fall 1939, moved on to step 8b (past step 3, where Front Options are chosen). */
const at8b = (): GameState => {
  const at3 = ok(applyAction(CTX, atStart(SCENARIO_1939, 1), { type: "END_STEP", side: "axis", step: "1" })).state;
  return ok(applyAction(CTX, at3, { type: "END_STEP", side: "axis", step: "3" })).state;
};
const build = (s: GameState, owner: PowerId, type: Unit["type"], strength: number, at: string) =>
  applyAction(CTX, s, { type: "BUILD", owner, unit: { type, strength }, at });
const berlinArea = (): string => Object.values(CTX.map.hexes).find((h) => h.land && h.country === "germany" && !h.features.includes("capital"))!.id;
const withUnits = (s: GameState, units: Unit[]): GameState => ({ ...s, units: { ...s.units, ...Object.fromEntries(units.map((u) => [u.id, u])) } });
const unit = (id: string, owner: Unit["owner"], at: string, type: Unit["type"] = "infantry"): Unit => ({ id, owner, type, strength: 3, movement: 3, at });

describe("what a build costs", () => {
  it("is the factors times the chart's price per factor: a 9-factor fleet is 27", () => {
    expect(buildCost("infantry", 3)).toBe(3);
    expect(buildCost("armor", 4)).toBe(8);
    expect(buildCost("air", 5)).toBe(15);
    expect(buildCost("fleet", 9)).toBe(27);
    expect(buildCost("airborne", 3)).toBe(9);
    expect(buildCost("replacement", 1)).toBe(1);
    expect(buildCost("airbase", 1)).toBeNull();
    expect(buildCost("bridgehead", 1)).toBeNull();
  });
});

describe("building a counter at step 8b", () => {
  it("pays for it, places it, uses up one of the Allowable Builds and says so", () => {
    const s = at8b();
    expect(s.position).toEqual({ part: "player-turn", turn: 1, step: "8b" });
    const at = berlinArea();
    const before = availableBuilds(s, "germany").find((e) => e.type === "infantry" && e.strength === 3)!;
    const r = ok(build(s, "germany", "infantry", 3, at));
    const unit = Object.values(r.state.units).find((u) => !s.units[u.id])!;
    expect(unit).toMatchObject({ owner: "germany", type: "infantry", strength: 3, movement: 3, at });
    expect(r.state.nations.germany).toMatchObject({ brpTotal: 147, spent: 3 });
    expect(availableBuilds(r.state, "germany").find((e) => e.type === "infantry" && e.strength === 3)!.count).toBe(before.count - 1);
    expect(r.events).toEqual([
      { type: "BRPS_CHANGED", nation: "germany", delta: -3, total: 147, reason: "building a 3-factor infantry" },
      { type: "UNIT_BUILT", unitId: unit.id, owner: "germany", unitType: "infantry", strength: 3, at, cost: 3 },
    ]);
  });

  it("removes the entry when the last counter is built", () => {
    const s = at8b();
    const only = availableBuilds(s, "germany").find((e) => e.type === "airborne")!;
    expect(only.count).toBe(1);
    const next = ok(build(s, "germany", "airborne", 3, berlinArea())).state;
    expect(availableBuilds(next, "germany").some((e) => e.type === "airborne")).toBe(false);
    expect(build(next, "germany", "airborne", 3, berlinArea())).toMatchObject({ ok: false });
  });

  it("is offered as legal actions at 8b only, ahead of the move-on action", () => {
    const s = at8b();
    const legal = legalActions(CTX, s);
    expect(legal.at(-1)).toMatchObject({ type: "END_STEP", step: "8b" });
    expect(legal.filter((a) => a.type === "BUILD").length).toBeGreaterThan(20);
    for (const a of legal) if (a.type === "BUILD") expect(a.owner).toBe("germany");
    expect(legalBuilds(CTX, s)).toHaveLength(legal.filter((a) => a.type === "BUILD").length);
  });

  it("is refused at any other step, naming the step", () => {
    const r = applyAction(CTX, atStart(SCENARIO_1939, 1), { type: "BUILD", owner: "germany", unit: { type: "infantry", strength: 3 }, at: berlinArea() });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Units are built in step 8b.*the game is at step 1 /);
  });

  it("is refused outside the nation's home territory, for a counter it may not build, and for a nation not in the game", () => {
    const s = at8b();
    const poland = Object.values(CTX.map.hexes).find((h) => h.land && h.country === "poland")!.id;
    expect(build(s, "germany", "infantry", 3, poland)).toMatchObject({ ok: false });
    expect(build(s, "germany", "infantry", 9, berlinArea())).toMatchObject({ ok: false });
    expect(build(s, "germany", "air", 3, berlinArea())).toMatchObject({ ok: false });
    expect(build(s, "britain", "infantry", 3, berlinArea())).toMatchObject({ ok: false }); // not their turn
    expect(build(s, "poland" as never, "infantry", 3, berlinArea())).toMatchObject({ ok: false });
  });

  it("is refused beyond the spending limit, naming it", () => {
    const s = at8b();
    const poor = { ...s, nations: { ...s.nations, germany: { ...s.nations.germany, spendLimit: 5 } } };
    const r = build(poor, "germany", "infantry", 3, berlinArea());
    expect(r.ok).toBe(true);
    const spentAll = ok(r).state;
    const second = build(spentAll, "germany", "infantry", 3, Object.values(CTX.map.hexes).filter((h) => h.land && h.country === "germany")[3]!.id);
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error).toMatch(/may spend only 5/);
    expect(legalBuilds(CTX, spentAll).every((a) => buildCost(a.unit.type, a.unit.strength)! <= 2)).toBe(true);
  });

  it("waits for the date printed on the page", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const s = atStart(SCENARIO_1942, 1);
    expect(s.year).toBe(1942);
    expect(availableBuilds(s, "germany").some((e) => e.type === "armor" && e.strength === 5)).toBe(false);
    const later = { ...s, year: 1943 };
    expect(availableBuilds(later, "germany").some((e) => e.type === "armor" && e.strength === 5)).toBe(true);
    expect(ctx.scenario.id).toBe("1942");
  });

  it("respects the stacking limit", () => {
    const s = at8b();
    const spec = { type: "infantry" as const, strength: 3 };
    const hexId = buildPlaces(CTX, s, "germany", spec)[0]!;
    const full = withUnits(s, [unit("x1", "germany", hexId), unit("x2", "germany", hexId)]);
    expect(buildPlaces(CTX, full, "germany", spec)).not.toContain(hexId);
    expect(build(full, "germany", "infantry", 3, hexId)).toMatchObject({ ok: false });
  });

  it("keeps away from an enemy ground unit in the hex or next to it, but not from one two hexes away", () => {
    const s = at8b();
    const spec = { type: "infantry" as const, strength: 3 };
    const hexId = buildPlaces(CTX, s, "germany", spec)[0]!;
    const onMap = (h: { q: number; r: number }) => h.r >= 0 && h.r < ROW_COUNT;
    const next = neighbors(hex(hexId)).filter(onMap).map(hexIdOf)[0]!;
    expect(buildPlaces(CTX, withUnits(s, [unit("e1", "france", hexId)]), "germany", spec)).not.toContain(hexId);
    expect(buildPlaces(CTX, withUnits(s, [unit("e2", "france", next)]), "germany", spec)).not.toContain(hexId);
    // A friend next door, an enemy air unit, and an enemy two hexes away do not matter.
    expect(buildPlaces(CTX, withUnits(s, [unit("f1", "germany", next)]), "germany", spec)).toContain(hexId);
    expect(buildPlaces(CTX, withUnits(s, [unit("a1", "france", next, "air")]), "germany", spec)).toContain(hexId);
    const far = neighbors(hex(next)).filter(onMap).map(hexIdOf).find((id) => id !== hexId && !neighbors(hex(hexId)).map(hexIdOf).includes(id))!;
    expect(buildPlaces(CTX, withUnits(s, [unit("e3", "france", far)]), "germany", spec)).toContain(hexId);
  });

  it("puts the U.S. build in the U.S. Box", () => {
    const s = atStart(SCENARIO_1942, 1);
    const allied = { ...s, activeSide: "allies" as const, position: { part: "player-turn" as const, turn: 2 as const, step: "8b" } };
    expect(buildPlaces(ctxFor(SCENARIO_1942), allied, "usa", { type: "infantry", strength: 3 })).toEqual(["us-box"]);
    const r = ok(applyAction(ctxFor(SCENARIO_1942), allied, { type: "BUILD", owner: "usa", unit: { type: "infantry", strength: 3 }, at: "us-box" }));
    expect(Object.values(r.state.units).find((u) => !s.units[u.id])).toMatchObject({ owner: "usa", at: "us-box" });
  });

  it("step 8b is passed when there is nothing to build", () => {
    const s = atStart(SCENARIO_1939, 1);
    const broke = { ...s, nations: { ...s.nations, germany: { ...s.nations.germany, spendLimit: 0 } } };
    const at3 = ok(applyAction(CTX, broke, { type: "END_STEP", side: "axis", step: "1" })).state;
    const r = ok(applyAction(CTX, at3, { type: "END_STEP", side: "axis", step: "3" }));
    expect(r.state.position).toEqual({ part: "player-turn", turn: 1, step: "10b" });
    expect(r.events.flatMap((e) => (e.type === "STEPS_PASSED" ? e.steps : []))).toContain("8b");
  });

  it("replays exactly", () => {
    const initial = atStart(SCENARIO_1939, 4);
    const actions: Action[] = [
      { type: "END_STEP", side: "axis", step: "1" },
      { type: "END_STEP", side: "axis", step: "3" },
      { type: "BUILD", owner: "germany", unit: { type: "infantry", strength: 3 }, at: berlinArea() },
      { type: "BUILD", owner: "germany", unit: { type: "armor", strength: 4 }, at: Object.values(CTX.map.hexes).filter((h) => h.land && h.country === "germany")[5]!.id },
    ];
    const a = replay(CTX, initial, actions).state;
    expect(a.nations.germany.brpTotal).toBe(150 - 3 - 8);
    expect(replay(CTX, initial, actions).state).toEqual(a);
  });
});
