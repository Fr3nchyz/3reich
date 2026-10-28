import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { applyAction, legalActions, replay, type Action, type GameEvent } from "../src/engine/actions";
import { applySweep } from "../src/engine/attack-losses";
import { availableBuilds, buildPlaces, legalBuilds } from "../src/engine/construction";
import { fall } from "../src/engine/conquest";
import { newGame } from "../src/engine/game";
import { eliminateUnits, FLEETS_NEVER_REBUILT, lossFate, routeLosses, WHOLE_FLEET_FACTORS } from "../src/engine/losses";
import { replayRecord, waitsOnlyForReturned } from "../src/engine/old-records";
import { rollD6 } from "../src/engine/rng";
import type { ForceEntry, ForceOwner, GameState, Unit } from "../src/engine/types";
import { MAP } from "../src/data/map";
import { runGame } from "../scripts/selfplay/runner";
import { CTX, atStart, ctxFor } from "./helpers";
import { at6f, inf } from "./helpers-move";
import { at8a, withPool } from "./helpers-siberian";

// Spec 17, ticket 17-1: a lost unit goes back to its nation's Force Pool and is built again at step 8b (R1, R2), unless the loss is for good (R4); old records
// still replay (R7). The readings are TODO(verify) RB1 to RB3, RB5, RB9 to RB11, RB13 to RB15 (docs/TODO-VERIFY.md); the tests pin them.

const ok = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const fleet = (id: string, owner: ForceOwner, at: string, strength = 9): Unit => ({ id, owner, type: "fleet", strength, at });
const returnedOf = (s: GameState, owner: ForceOwner): ForceEntry[] => (s.pools[owner]?.allowableBuilds ?? []).filter((e) => e.returned);
const kinds = (events: GameEvent[]) => events.map((e) => e.type);
/** Axis to move at step 8b of Fall 1939 with these counters on the map as well; the dice at `rng`. */
const at = (step: string, units: Unit[], tweak: Partial<GameState> = {}): GameState => {
  const s = atStart(SCENARIO_1939, 1);
  return { ...s, activeSide: "axis", position: { part: "player-turn", turn: 1, step }, units: { ...s.units, ...Object.fromEntries(units.map((u) => [u.id, u])) }, nextUnitId: 900, ...tweak };
};
const seedRolling = (n: number) => {
  for (let seed = 1; seed < 10000; seed++) if (rollD6(seed).roll === n) return seed;
  throw new Error("no seed");
};
const s1942 = (): GameState => atStart(SCENARIO_1942, 1);

describe("R1: a lost unit goes back to the pool of its own nation, as it was, with no date (Ref 11.6; TODO(verify) RB1, RB3)", () => {
  it("adds the counter, with its factors and movement and the returned mark, and says so right after the elimination", () => {
    const s = at("8b", [inf("g1", "germany", "M32", 3, 3)]);
    const before = s.pools.germany!.allowableBuilds.length;
    const r = eliminateUnits(s, ["g1"]);
    expect(r.state.units.g1).toBeUndefined();
    expect(r.state.pools.germany!.allowableBuilds).toHaveLength(before + 1);
    expect(returnedOf(r.state, "germany")).toEqual([{ type: "infantry", strength: 3, movement: 3, count: 1, returned: true }]);
    expect(r.events).toEqual([
      { type: "UNIT_ELIMINATED", unitId: "g1", owner: "germany", at: "M32" },
      { type: "UNIT_RETURNED_TO_POOL", unitId: "g1", owner: "germany", unitType: "infantry", strength: 3, at: "M32", pool: "germany" },
    ]);
  });

  it("a second counter of the same kind adds to the count; a different movement is a different counter; ids not on the map are skipped", () => {
    const s = at("8b", [inf("g1", "germany", "M32", 3, 3), inf("g2", "germany", "M32", 3, 3), inf("g3", "germany", "M32", 3, 4)]);
    const r = eliminateUnits(s, ["g1", "nobody", "g2", "g3"]);
    expect(returnedOf(r.state, "germany")).toEqual([
      { type: "infantry", strength: 3, movement: 3, count: 2, returned: true },
      { type: "infantry", strength: 3, movement: 4, count: 1, returned: true },
    ]);
    expect(r.removed.map((u) => u.id)).toEqual(["g1", "g2", "g3"]);
    expect(kinds(r.events).filter((k) => k === "UNIT_RETURNED_TO_POOL")).toHaveLength(3);
  });

  it("goes to the pool of the counter's nationality, not of the Power that holds it", () => {
    const s = at("8b", [{ ...fleet("f1", "germany", "M32"), nationality: "italy" }]);
    const r = routeLosses({ ...s, units: {} }, [s.units.f1!]);
    expect(returnedOf(r.state, "italy")).toEqual([{ type: "fleet", strength: 9, count: 1, returned: true }]);
    expect(returnedOf(r.state, "germany")).toEqual([]);
  });

  it("a battle: the attackers eliminated by an A go back (Ref 12.1)", () => {
    const s = at("7h", [inf("g1", "germany", "M32", 1, 3), inf("p1", "poland", "M33", 1, 3)], { rngState: seedRolling(5) });
    const r = ok(applyAction(CTX, s, { type: "ATTACK", side: "axis", units: ["g1"], target: "M33" }));
    expect(r.state.units.g1).toBeUndefined();
    expect(r.events).toContainEqual({ type: "UNIT_RETURNED_TO_POOL", unitId: "g1", owner: "germany", unitType: "infantry", strength: 1, at: "M32", pool: "germany" });
    expect(returnedOf(r.state, "germany")).toEqual([{ type: "infantry", strength: 1, movement: 3, count: 1, returned: true }]);
  });

  it("the sweep of counters left alone in a hex: an air unit swept goes back", () => {
    const s = at("7h", [inf("g1", "germany", "M32", 3, 3), inf("a1", "britain", "M33", 3, 4, "air")]);
    const r = applySweep(CTX, s, [s.units.g1!], "M33");
    expect(kinds(r.events)).toEqual(expect.arrayContaining(["UNITS_SWEPT", "UNIT_ELIMINATED", "UNIT_RETURNED_TO_POOL"]));
    expect(returnedOf(r.state, "britain")).toEqual([{ type: "air", strength: 3, movement: 4, count: 1, returned: true }]);
  });
});

describe("R1, RB2: bought back at the very next step 8b, even when the loss is made by ending step 7h (ground support not used, Ref 20.41)", () => {
  it("the air unit lost when 7h ends is offered at the 8b the same action reaches", () => {
    const s0 = at6f([inf("u1", "germany", "M32", 4, 3), inf("p1", "poland", "M33", 2, 3), inf("a1", "germany", "J32", 3, 4, "air")], "axis", SCENARIO_1939, { nextUnitId: 100, position: { part: "player-turn", turn: 1, step: "7b" } });
    const committed = ok(applyAction(CTX, s0, { type: "DESIGNATE_AIR", side: "axis", mission: "ground-support", units: ["a1"], target: "M33" })).state;
    const s7h: GameState = { ...committed, position: { part: "player-turn", turn: 1, step: "7h" } };
    const r = ok(applyAction(CTX, s7h, { type: "END_STEP", side: "axis", step: "7h" }));
    const lost = kinds(r.events).indexOf("GROUND_SUPPORT_LOST");
    expect(r.events.slice(lost + 1, lost + 3).map((e) => e.type)).toEqual(["UNIT_ELIMINATED", "UNIT_RETURNED_TO_POOL"]);
    expect(r.state.position).toMatchObject({ step: "8b" });
    expect(legalBuilds(CTX, r.state)).toContainEqual(expect.objectContaining({ owner: "germany", unit: { type: "air", strength: 3, returned: true } }));
  });
});

describe("R4: losses that are for good, with the reason (UNIT_LOST_FOR_GOOD)", () => {
  const fate = (s: GameState, u: Unit) => lossFate(s, u);
  it("a minor country that is not an active Minor-Ally, Poland included (Ref 14.0; TODO(verify) RB9)", () => {
    const s = at("7h", [inf("p1", "poland", "M33", 2, 3)]);
    const r = eliminateUnits(s, ["p1"]);
    expect(r.events[1]).toEqual({ type: "UNIT_LOST_FOR_GOOD", unitId: "p1", owner: "poland", unitType: "infantry", strength: 2, at: "M33", reason: "minor-country" });
    expect(r.state.pools.poland).toEqual(s.pools.poland);
  });
  it("a Major Power that is out of the game or has no pool left (TODO(verify) RB14), whatever Power holds the counter", () => {
    const s = at("8b", []);
    const g = inf("g1", "germany", "M32");
    expect(fate({ ...s, nations: { ...s.nations, germany: { ...s.nations.germany, status: "conquered" } } }, g)).toEqual({ lost: "out-of-game" });
    expect(fate({ ...s, nations: { ...s.nations, germany: { ...s.nations.germany, status: "out" } } }, g)).toEqual({ lost: "out-of-game" });
    const { germany: _gone, ...pools } = s.pools;
    expect(fate({ ...s, pools }, g)).toEqual({ lost: "out-of-game" });
    // Italian naval factors Germany keeps after Italy has left the game (Ref 18.2; V16)
    expect(fate({ ...s, nations: { ...s.nations, italy: { ...s.nations.italy, status: "conquered" } } }, { ...fleet("f1", "germany", "M32"), nationality: "italy" })).toEqual({ lost: "out-of-game" });
    expect(fate(s, g)).toEqual({ pool: "germany" });
  });
  it("counters no pool holds: airbases and bridgeheads (TODO(verify) RB15)", () => {
    const s = at("8b", []);
    expect(fate(s, { id: "b1", owner: "germany", type: "airbase", strength: 1, at: "M32" })).toEqual({ lost: "not-in-pool" });
    expect(fate(s, { id: "b2", owner: "germany", type: "bridgehead", strength: 1, at: "M32" })).toEqual({ lost: "not-in-pool" });
    expect(fate(s, { id: "r1", owner: "germany", type: "replacement", strength: 1, at: "M32" })).toEqual({ pool: "germany" });
  });
  it("partial fleets: only a whole 9-factor fleet goes back (Ref 11.62; TODO(verify) RB5)", () => {
    const s = at("8b", []);
    expect(WHOLE_FLEET_FACTORS).toBe(9);
    expect(fate(s, fleet("f1", "germany", "M32", 9))).toEqual({ pool: "germany" });
    expect(fate(s, fleet("f2", "germany", "M32", 8))).toEqual({ lost: "partial-fleet" });
    expect(fate(s, fleet("f3", "germany", "M32", 4))).toEqual({ lost: "partial-fleet" });
  });
  it("the fleets of Turkey, Spain, Vichy France, Sweden and the Free French are never rebuilt; Vichy and Free French ground and air go back (Ref 11.62; TODO(verify) RB10, RB11)", () => {
    expect(FLEETS_NEVER_REBUILT).toEqual(["turkey", "spain", "vichy-france", "sweden", "free-france"]);
    const s = s1942();
    expect(fate(s, fleet("f1", "vichy-france", "M21"))).toEqual({ lost: "fleet-never-rebuilt" });
    expect(fate(s, fleet("f2", "free-france", "M21"))).toEqual({ lost: "fleet-never-rebuilt" });
    expect(fate(s, inf("v1", "vichy-france", "M21"))).toEqual({ pool: "vichy-france" });
    expect(fate(s, inf("v2", "vichy-france", "M21", 2, 4, "air"))).toEqual({ pool: "vichy-france" });
    expect(fate(s, inf("ff1", "free-france", "M21"))).toEqual({ pool: "free-france" });
  });
  it("an active Minor-Ally's losses wait in its own pool; once it is not active they are for good (TODO(verify) RB9, MC18)", () => {
    const s = s1942();
    expect(s.minorAllies).toContainEqual({ owner: "finland", of: "germany", active: true });
    const fin = inf("fi1", "finland", "A40", 2, 3);
    expect(fate(s, fin)).toEqual({ pool: "finland" });
    const inactive = { ...s, minorAllies: s.minorAllies.map((m) => (m.owner === "finland" ? { ...m, active: false } : m)) };
    expect(fate(inactive, fin)).toEqual({ lost: "minor-country" });
    const r = routeLosses(s, [fin]);
    expect(returnedOf(r.state, "finland")).toEqual([{ type: "infantry", strength: 2, movement: 3, count: 1, returned: true }]);
    expect(legalBuilds(ctxFor(SCENARIO_1942), { ...r.state, activeSide: "axis", position: { part: "player-turn", turn: 1, step: "8b" } }).some((a) => a.pool === "finland")).toBe(false); // ticket 15-19 builds them
  });
  it("a conquest still takes the Power's units and pools away for good (V10): a counter back in the pool goes with it", () => {
    const s = at("7h", []);
    const back = routeLosses(s, [inf("f1", "france", "M21")]).state;
    expect(returnedOf(back, "france")).toHaveLength(1);
    const fallen = fall(CTX, back, "france", "germany");
    expect(fallen.state.pools.france).toBeUndefined();
    expect(kinds(fallen.events)).not.toContain("UNIT_RETURNED_TO_POOL");
  });
});

describe("R2: a returned counter is bought like any other at step 8b (Ref 11.6, 11.64; TODO(verify) RB2, RB13)", () => {
  const lost = (): GameState => eliminateUnits(at("8b", [inf("g1", "germany", "M32", 3, 3), inf("g2", "germany", "M32", 3, 3)]), ["g1", "g2"]).state;
  const place = (s: GameState) => legalBuilds(CTX, s).find((a) => a.unit.returned)!.at;

  it("is offered apart from the scenario's counter of the same kind, in the same places, at the chart price", () => {
    const s = lost();
    const fresh = legalBuilds(CTX, s).filter((a) => a.owner === "germany" && a.unit.type === "infantry" && a.unit.strength === 3 && !a.unit.returned).map((a) => a.at);
    const back = legalBuilds(CTX, s).filter((a) => a.unit.returned).map((a) => a.at);
    expect(back.length).toBeGreaterThan(0);
    expect(back).toEqual(fresh);
    const r = ok(applyAction(CTX, s, { type: "BUILD", owner: "germany", unit: { type: "infantry", strength: 3, returned: true }, at: back[0]! }));
    const unit = Object.values(r.state.units).find((u) => !s.units[u.id])!;
    expect(unit).toMatchObject({ owner: "germany", type: "infantry", strength: 3, movement: 3, at: back[0] });
    expect(r.state.nations.germany.brpTotal).toBe(s.nations.germany.brpTotal - 3);
    expect(r.events).toContainEqual({ type: "UNIT_BUILT", unitId: unit.id, owner: "germany", unitType: "infantry", strength: 3, at: back[0], cost: 3, returned: true });
    expect(returnedOf(r.state, "germany")).toEqual([{ type: "infantry", strength: 3, movement: 3, count: 1, returned: true }]);
    // the scenario's entry is untouched
    expect(availableBuilds(r.state, "germany").filter((e) => !e.returned)).toEqual(availableBuilds(s, "germany").filter((e) => !e.returned));
  });

  it("no limit but the money (RB13): both come back one after the other, then none is left", () => {
    const one = ok(applyAction(CTX, lost(), { type: "BUILD", owner: "germany", unit: { type: "infantry", strength: 3, returned: true }, at: place(lost()) })).state;
    const two = ok(applyAction(CTX, one, { type: "BUILD", owner: "germany", unit: { type: "infantry", strength: 3, returned: true }, at: place(one) })).state;
    expect(returnedOf(two, "germany")).toEqual([]);
    expect(legalBuilds(CTX, two).some((a) => a.unit.returned)).toBe(false);
    expect(applyAction(CTX, two, { type: "BUILD", owner: "germany", unit: { type: "infantry", strength: 3, returned: true }, at: place(one) })).toMatchObject({ ok: false });
  });

  it("a BUILD without the mark takes the scenario's counter, never the returned one; with the mark, never the scenario's", () => {
    const s0 = at("8b", [inf("x1", "germany", "M32", 3, 3, "airborne")]);
    const airborne = availableBuilds(s0, "germany").find((e) => e.type === "airborne")!;
    expect(airborne.count).toBe(1);
    const where = legalBuilds(CTX, s0).find((a) => a.unit.type === "airborne")!.at;
    expect(applyAction(CTX, s0, { type: "BUILD", owner: "germany", unit: { type: "airborne", strength: 3, returned: true }, at: where })).toMatchObject({ ok: false });
    const used = ok(applyAction(CTX, s0, { type: "BUILD", owner: "germany", unit: { type: "airborne", strength: 3 }, at: where })).state;
    const back = eliminateUnits(used, ["x1"]).state;
    expect(applyAction(CTX, back, { type: "BUILD", owner: "germany", unit: { type: "airborne", strength: 3 }, at: where })).toMatchObject({ ok: false });
    expect(ok(applyAction(CTX, back, { type: "BUILD", owner: "germany", unit: { type: "airborne", strength: 3, returned: true }, at: where })).state.pools.germany!.allowableBuilds.some((e) => e.type === "airborne")).toBe(false);
  });

  it("inside the spending limit: not offered when it costs more than the BRPs left to spend this turn", () => {
    const s = lost();
    const g = s.nations.germany;
    const poor = { ...s, nations: { ...s.nations, germany: { ...g, spent: g.spendLimit - 2 } } };
    expect(legalBuilds(CTX, poor).some((a) => a.unit.returned)).toBe(false);
    expect(applyAction(CTX, poor, { type: "BUILD", owner: "germany", unit: { type: "infantry", strength: 3, returned: true }, at: place(s) })).toMatchObject({ ok: false });
  });

  it("refuses a mark that is not true, and a pool the builder may not build from", () => {
    const s = lost();
    expect(applyAction(CTX, s, { type: "BUILD", owner: "germany", unit: { type: "infantry", strength: 3, returned: "yes" as unknown as true }, at: place(s) })).toMatchObject({ ok: false, error: expect.stringMatching(/returned/) });
    expect(applyAction(CTX, s, { type: "BUILD", owner: "germany", pool: "italy", unit: { type: "infantry", strength: 3, returned: true }, at: place(s) })).toMatchObject({ ok: false, error: expect.stringMatching(/italy pool/) });
  });
});

describe("RB10: Britain builds the Free French losses, in Britain, and they stay Free French", () => {
  const ctx = ctxFor(SCENARIO_1942);
  const allied = (s: GameState): GameState => ({ ...s, activeSide: "allies", position: { part: "player-turn", turn: 2, step: "8b" } });
  it("only the returned ones: the Free French counters the scenario lists are not Britain's to build", () => {
    const s = allied(s1942());
    expect(legalBuilds(ctx, s).some((a) => a.pool === "free-france")).toBe(false);
    const back = allied(routeLosses(s, [inf("ff1", "free-france", "M21", 2, 3)]).state);
    const offer = legalBuilds(ctx, back).filter((a) => a.pool === "free-france");
    expect(offer.length).toBeGreaterThan(0);
    for (const a of offer) expect(a).toMatchObject({ owner: "britain", pool: "free-france", unit: { type: "infantry", strength: 2, returned: true } });
    // placed where Britain places its own builds (spec 02, Ref 11.64: its home territory as built, O6), not in a Free French place
    expect(offer.map((a) => a.at)).toEqual(buildPlaces(ctx, back, "britain", { type: "infantry", strength: 2 }));
    expect(offer.some((a) => MAP.hexes[a.at]?.country === "britain")).toBe(true);
    const r = ok(applyAction(ctx, back, offer[0]!));
    const unit = Object.values(r.state.units).find((u) => !back.units[u.id])!;
    expect(unit).toMatchObject({ owner: "free-france", type: "infantry", strength: 2, movement: 3 });
    expect(r.state.nations.britain.brpTotal).toBe(back.nations.britain.brpTotal - 2);
    expect(r.events).toContainEqual(expect.objectContaining({ type: "UNIT_BUILT", owner: "britain", pool: "free-france", returned: true }));
    expect(returnedOf(r.state, "free-france")).toEqual([]);
  });
});

describe("R7: a record made before ticket 17-1 still replays to its end", () => {
  // surrender-question.json was rewritten by this ticket with the END_STEP actions `replayRecord` puts in (the browser test cuts it one action before its end);
  // the six others are the records made on the old engine.
  const fixtures = ["axis-at-7h", "ended-1939", "siberian-card", "surrender-build", "winter-question", "winter-started"];
  const scenarios = { "1939": SCENARIO_1939, "1942": SCENARIO_1942 } as Record<string, typeof SCENARIO_1939>;
  for (const name of fixtures) {
    it(`${name}.json (recorded on the old engine): every recorded action is applied, in order; a step is ended only at 8a, 8b or 9e`, () => {
      const rec = JSON.parse(readFileSync(`tests/e2e/fixtures/${name}.json`, "utf8")) as { scenario: string; seed: number; end?: { year: number; season: "spring" | "summer" | "fall" | "winter" }; actions: Action[] };
      const scenario = rec.end ? { ...scenarios[rec.scenario]!, end: rec.end } : scenarios[rec.scenario]!;
      const ctx = ctxFor(scenario);
      const r = replayRecord(ctx, newGame(scenario, rec.seed), rec.actions);
      const inserted = r.actions.filter((a) => !rec.actions.includes(a));
      expect(inserted).toHaveLength(r.ended.length);
      for (const a of inserted) expect(a.type === "END_STEP" && /^(8[ab]|9e)$/.test(a.step), JSON.stringify(a)).toBe(true);
      expect(r.actions.filter((a) => rec.actions.includes(a))).toEqual(rec.actions);
      expect(replay(ctx, newGame(scenario, rec.seed), r.actions).state).toEqual(r.state);
    });
  }
  it("the surrender-build record needed it (its game lost units before Spring 1942); a game recorded now needs nothing", () => {
    const rec = JSON.parse(readFileSync("tests/e2e/fixtures/surrender-build.json", "utf8")) as { seed: number; actions: Action[] };
    expect(replayRecord(CTX, newGame(SCENARIO_1939, rec.seed), rec.actions).ended.length).toBeGreaterThan(0);
    const now = runGame({ scenario: "1939", seed: 1, turns: 3, verify: false });
    const again = replayRecord(CTX, now.initial, now.actions);
    expect(again.ended).toEqual([]);
    expect(again.state).toEqual(now.final);
  });
  it("a step is ended only when it offers nothing but returned counters, and a refusal for any other reason still throws", () => {
    const s = lost8b();
    expect(waitsOnlyForReturned(CTX, s)).toBeNull(); // the scenario's builds are on offer too
    const onlyReturned = { ...s, pools: { ...s.pools, germany: { ...s.pools.germany!, allowableBuilds: returnedOf(s, "germany") } } };
    expect(waitsOnlyForReturned(CTX, onlyReturned)).toBe("8b");
    expect(waitsOnlyForReturned(CTX, { ...onlyReturned, position: { part: "player-turn", turn: 1, step: "7h" } })).toBeNull();
    const r = replayRecord(CTX, onlyReturned, [{ type: "END_PLAYER_TURN", side: "axis" }]);
    expect(r.actions[0]).toEqual({ type: "END_STEP", side: "axis", step: "8b" });
    expect(r.ended).toEqual([0]);
    expect(() => replayRecord(CTX, s, [{ type: "END_STEP", side: "axis", step: "9a" }])).toThrow(/Action 0 is illegal/);
  });
  it("a game saved before spec 17 (no returned entries) loads and plays: nothing was destroyed yet", () => {
    const s = at("8b", []);
    expect(Object.values(s.pools).every((p) => p.allowableBuilds.every((e) => e.returned === undefined))).toBe(true);
    expect(legalActions(CTX, s).length).toBeGreaterThan(0);
  });
});

describe("case by case (the checks the mutation run asked for)", () => {
  const emptyGermanPool = (s: GameState): GameState => ({ ...s, pools: { ...s.pools, germany: { ...s.pools.germany!, allowableBuilds: [] } } });
  it("a returned counter adds to an entry only of the same type, factors and movement, the first entry of the pool included", () => {
    const r = routeLosses(emptyGermanPool(at("7h", [])), [inf("a", "germany", "M32", 3, 3), inf("b", "germany", "M32", 3, 3), inf("c", "germany", "M32", 2, 3), inf("d", "germany", "M32", 3, 3, "armor")]);
    expect(r.state.pools.germany!.allowableBuilds).toEqual([
      { type: "infantry", strength: 3, movement: 3, count: 2, returned: true },
      { type: "infantry", strength: 2, movement: 3, count: 1, returned: true },
      { type: "armor", strength: 3, movement: 3, count: 1, returned: true },
    ]);
  });
  it("Britain is offered no Free French counter that did not come back, even one it could afford now", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const s0 = s1942();
    const ff = s0.pools["free-france"]!;
    const fresh: ForceEntry = { type: "infantry", strength: 2, movement: 3, count: 1 };
    const s: GameState = { ...s0, activeSide: "allies", position: { part: "player-turn", turn: 2, step: "8b" }, pools: { ...s0.pools, "free-france": { ...ff, allowableBuilds: [fresh] } } };
    expect(legalBuilds(ctx, s).some((a) => a.pool === "free-france")).toBe(false);
    const where = buildPlaces(ctx, s, "britain", { type: "infantry", strength: 2 })[0]!;
    expect(applyAction(ctx, s, { type: "BUILD", owner: "britain", pool: "free-france", unit: { type: "infantry", strength: 2, returned: true }, at: where })).toMatchObject({ ok: false, error: expect.stringMatching(/returned 2-factor infantry of the free-france pool/) });
    expect(applyAction(CTX, lost8b(), { type: "BUILD", owner: "germany", unit: { type: "infantry", strength: 2, returned: true }, at: "M32" })).toMatchObject({ ok: false, error: expect.not.stringMatching(/pool/) });
  });
  it("step 8b with nothing to build, or 8a with nothing to take, does not wait: no step is ended for it", () => {
    const s = lost8b();
    const noPools = { ...s, pools: { ...s.pools, germany: { ...s.pools.germany!, allowableBuilds: [] }, italy: { ...s.pools.italy!, allowableBuilds: [] } } };
    expect(legalBuilds(CTX, noPools)).toEqual([]);
    expect(waitsOnlyForReturned(CTX, noPools)).toBeNull();
    const back: ForceEntry = { type: "infantry", strength: 3, movement: 3, count: 1, returned: true };
    const fresh: ForceEntry = { type: "infantry", strength: 2, movement: 3, count: 1 };
    expect(waitsOnlyForReturned(CTX, withPool(at8a(), [back]))).toBe("8a");
    expect(waitsOnlyForReturned(CTX, withPool(at8a(), [back, fresh]))).toBeNull();
    expect(waitsOnlyForReturned(CTX, withPool(at8a(), []))).toBeNull();
    expect(waitsOnlyForReturned(CTX, withPool(at8a([], { position: { part: "player-turn", turn: 2, step: "9a" } }), [back]))).toBeNull();
  });
});

function lost8b(): GameState {
  return eliminateUnits(at("8b", [inf("g1", "germany", "M32", 3, 3)]), ["g1"]).state;
}
