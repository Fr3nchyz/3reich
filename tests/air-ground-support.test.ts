import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, type Action, type GameEvent } from "../src/engine/actions";
import { airInRangeOf, hasAirWork, legalDesignations } from "../src/engine/air-missions";
import { airOf, flownOf, hasFlown } from "../src/engine/air-record";
import { committedAt, countedAir } from "../src/engine/air-support";
import { applyOutcome } from "../src/engine/attack-losses";
import { attackNumbers } from "../src/engine/attack-rules";
import { oddsColumn } from "../src/engine/combat";
import { combatOf } from "../src/engine/combat-record";
import { legalBuilds } from "../src/engine/construction";
import type { GameState, Unit } from "../src/engine/types";
import { CTX, atStart } from "./helpers";
import { at6f, errorOf, inf, okOf } from "./helpers-move";

// Spec 09, ticket 09-7: Ground Support (R8; Ref 20.41, 20.3). The real 1939 map: German infantry at M32 can attack Poznan (M33), where Polish infantry stand;
// J32 is within 4 hexes of M33, Q27 is not.

const air = (id: string, at: string, strength: number, owner: Unit["owner"] = "germany"): Unit => inf(id, owner, at, strength, 4, "air");
const at7b = (units: Unit[], tweak: Partial<GameState> = {}): GameState =>
  at6f(units, "axis", SCENARIO_1939, { nextUnitId: 100, position: { part: "player-turn", turn: 1, step: "7b" }, ...tweak });
const at7h = (s: GameState): GameState => ({ ...s, position: { part: "player-turn", turn: 1, step: "7h" } });
const commit = (units: string[], target = "M33"): Extract<Action, { type: "DESIGNATE_AIR" }> => ({ type: "DESIGNATE_AIR", side: "axis", mission: "ground-support", units, target });
const attack = (units: string[], target = "M33"): Action => ({ type: "ATTACK", side: "axis", units, target });
const base = () => at7b([inf("u1", "germany", "M32", 4, 3), inf("p1", "poland", "M33", 2, 3), air("a1", "J32", 3), air("a2", "J32", 2), air("a3", "Q27", 3)]);
const kinds = (events: GameEvent[]) => events.map((e) => e.type);

describe("DESIGNATE_AIR at step 7b", () => {
  it("commits the air, marks it as flown for the Game Turn and says so; nothing else changes", () => {
    const s = base();
    const r = okOf(applyAction(CTX, s, commit(["a1"])));
    expect(airOf(r.state).groundSupport).toEqual({ M33: ["a1"] });
    expect(flownOf(r.state).units).toEqual({ a1: "ground-support" });
    expect(r.state.units).toEqual(s.units);
    expect(r.events).toEqual([{ type: "AIR_MISSION_DESIGNATED", mission: "ground-support", units: ["a1"], target: "M33" }]);
    expect(committedAt(r.state, "M33").map((u) => u.id)).toEqual(["a1"]);
    expect(airOf(s).groundSupport).toEqual({}); // the input state is untouched
  });

  it("a second designation adds to the first, in order; a unit flies one mission a Game Turn", () => {
    let s = okOf(applyAction(CTX, base(), commit(["a1"]))).state;
    s = okOf(applyAction(CTX, s, commit(["a2"]))).state;
    expect(airOf(s).groundSupport.M33).toEqual(["a1", "a2"]);
    expect(errorOf(applyAction(CTX, s, commit(["a1"])))).toMatch(/already flown a mission/);
  });

  it("refuses units out of range, ground units, the other side's air, a hex that cannot be attacked, a full cap, and other steps", () => {
    const s = at7b([inf("u1", "germany", "M32", 1, 3), inf("p1", "poland", "M33", 2, 3), air("a1", "J32", 5), air("a2", "J32", 5), air("a3", "Q27", 3), air("p9", "N33", 3, "poland")]);
    expect(errorOf(applyAction(CTX, s, commit(["a3"])))).toMatch(/cannot reach M33/);
    expect(errorOf(applyAction(CTX, s, commit(["u1"])))).toMatch(/not an air unit/);
    expect(errorOf(applyAction(CTX, s, commit(["p9"])))).toMatch(/does not belong to the axis side/);
    expect(errorOf(applyAction(CTX, s, commit(["a1"], "L32")))).toMatch(/not a hex the axis side can attack/);
    expect(errorOf(applyAction(CTX, s, commit(["a1", "a2"])))).toMatch(/at most 3 air factors/); // 3 x the 1 ground factor that could attack
    expect(errorOf(applyAction(CTX, at7h(s), commit(["a1"])))).toMatch(/step/);
    expect(errorOf(applyAction(CTX, s, { ...commit(["a1"]), side: "allies" }))).toMatch(/player turn/);
    expect(errorOf(applyAction(CTX, s, { ...commit(["a1"]), mission: "counter-air" as "ground-support" }))).toMatch(/ground-support mission/);
  });

  it("refuses malformed input without throwing", () => {
    const s = base();
    // eslint-disable-next-line no-sparse-arrays
    expect(errorOf(applyAction(CTX, s, commit([, "a1"] as unknown as string[])))).toMatch(/one or more distinct/);
    expect(errorOf(applyAction(CTX, s, commit([])))).toMatch(/one or more distinct/);
    expect(errorOf(applyAction(CTX, s, commit(["a1", "a1"])))).toMatch(/one or more distinct/);
    expect(errorOf(applyAction(CTX, s, commit(["constructor"])))).toMatch(/not on the map/);
    expect(errorOf(applyAction(CTX, s, commit(["a1"], "ZZ99")))).toMatch(/names a hex on the map/);
    expect(errorOf(applyAction(CTX, s, { ...commit(["a1"]), target: 5 as unknown as string }))).toMatch(/names a hex on the map/);
    expect(errorOf(applyAction(CTX, s, commit(Array<string>(101).fill("a1"))))).toMatch(/one or more distinct/);
  });

  it("air built in this Game Turn flies no mission (Ref 20.3)", () => {
    const eighth: GameState = { ...atStart(SCENARIO_1939, 1), position: { part: "player-turn", turn: 1, step: "8b" } };
    const build = legalBuilds(CTX, eighth).find((b) => b.unit.type === "air")!;
    expect(build).toBeDefined();
    const built = okOf(applyAction(CTX, eighth, build)).state;
    const id = Object.values(built.units).find((u) => u.type === "air")!.id;
    expect(flownOf(built).units[id]).toBe("new");
    expect(hasFlown(built, id)).toBe(true);
    expect(hasFlown({ ...built, season: "summer" }, id)).toBe(false); // the next Game Turn it may
  });
});

describe("what the player is asked at step 7b", () => {
  it("airInRangeOf and hasAirWork see only free air within 4 hexes of a hex that can be attacked", () => {
    const s = base();
    expect(airInRangeOf(CTX, s, "M33").map((u) => u.id)).toEqual(["a1", "a2"]);
    expect(hasAirWork(CTX, s)).toBe(true);
    const flown = okOf(applyAction(CTX, okOf(applyAction(CTX, s, commit(["a1"]))).state, commit(["a2"]))).state;
    expect(hasAirWork(CTX, flown)).toBe(false);
    expect(hasAirWork(CTX, at7b([inf("u1", "germany", "M32", 4, 3), inf("p1", "poland", "M33", 2, 3), air("a3", "Q27", 3)]))).toBe(false);
    expect(hasAirWork(CTX, at7b([air("a1", "J32", 3)]))).toBe(false);
  });

  it("with the missions on: the list names each attackable hex with the air that fits, every listed action is accepted, and 7b waits only while there is room under the cap", () => {
    const s = base();
    const listed = legalDesignations(CTX, s, true);
    expect(listed).toEqual([commit(["a1", "a2"])]); // 3 + 2 air under the cap of 12
    for (const a of listed) expect(applyAction(CTX, s, a).ok).toBe(true);
    const tight = at7b([inf("u1", "germany", "M32", 1, 3), inf("p1", "poland", "M33", 2, 3), air("a1", "J32", 5)]); // cap 3, the only unit has 5
    expect(legalDesignations(CTX, tight, true)).toEqual([]);
    expect(hasAirWork(CTX, tight)).toBe(false);
    expect(hasAirWork(CTX, s)).toBe(true);
    const split = at7b([inf("u1", "germany", "M32", 1, 3), inf("p1", "poland", "M33", 2, 3), air("a1", "J32", 3), air("a2", "J32", 2)]);
    expect(legalDesignations(CTX, split, true)).toEqual([commit(["a1"])]); // a1 fits the cap of 3, a2 would make 5
  });

  it("is on in the game: 7b waits only for a side that has air to commit, and lists the designations", () => {
    const s = base();
    expect(legalDesignations(CTX, s)).toEqual([commit(["a1", "a2"])]);
    expect(legalActions(CTX, s).filter((a) => a.type === "DESIGNATE_AIR")).toHaveLength(1);
    const sixth: GameState = { ...s, position: { part: "player-turn", turn: 1, step: "6f" } };
    const waits = okOf(applyAction(CTX, sixth, { type: "END_STEP", side: "axis", step: "6f" })).state;
    expect(waits.position).toMatchObject({ step: "7b" }); // air in range of Poznan: the step waits
    const none = at7b([inf("u1", "germany", "M32", 4, 3), inf("p1", "poland", "M33", 2, 3), air("a3", "Q27", 3)]);
    const noAir = okOf(applyAction(CTX, { ...none, position: { part: "player-turn", turn: 1, step: "6f" } }, { type: "END_STEP", side: "axis", step: "6f" })).state;
    expect(noAir.position).toMatchObject({ step: "7h" }); // nothing in range: 7b is passed
    expect(legalDesignations(CTX, s, false)).toEqual([]); // the switch, as a test asks for it
  });
});

describe("reshaping air at step 7b", () => {
  it("a unit committed to ground support cannot be split or combined; it cannot fly twice by new ids", () => {
    const s = okOf(applyAction(CTX, base(), commit(["a1"]))).state;
    expect(errorOf(applyAction(CTX, s, { type: "SPLIT_AIR", side: "axis", unit: "a1", parts: [2, 1] }))).toMatch(/committed to ground support/);
    expect(errorOf(applyAction(CTX, s, { type: "COMBINE_AIR", side: "axis", units: ["a1", "a2"] }))).toMatch(/committed to ground support/);
    const free = okOf(applyAction(CTX, s, { type: "SPLIT_AIR", side: "axis", unit: "a2", parts: [1, 1] })).state; // a free unit may
    expect(Object.values(free.units).filter((u) => u.type === "air" && u.at === "J32").map((u) => u.strength).sort()).toEqual([1, 1, 3]);
  });

  it("parts of a unit built this Game Turn may not fly either, nor may a unit joined to one", () => {
    const built = { ...at7b([inf("u1", "germany", "M32", 4, 3), inf("p1", "poland", "M33", 2, 3), air("n1", "J32", 3), air("o1", "J32", 2)]), airFlown: { turn: "1939-summer", units: { n1: "new" as const } } };
    const state: GameState = { ...built, year: 1939, season: "summer" };
    const split = okOf(applyAction(CTX, state, { type: "SPLIT_AIR", side: "axis", unit: "n1", parts: [2, 1] })).state;
    const parts = Object.values(split.units).filter((u) => u.id.startsWith("u1") && u.type === "air").map((u) => u.id);
    expect(parts).toHaveLength(2);
    for (const id of parts) expect(hasFlown(split, id)).toBe(true);
    const joined = okOf(applyAction(CTX, state, { type: "COMBINE_AIR", side: "axis", units: ["n1", "o1"] })).state;
    expect(hasFlown(joined, "u100")).toBe(true);
    expect(errorOf(applyAction(CTX, joined, commit(["u100"])))).toMatch(/already flown a mission/);
  });
});

describe("the numbers and the battle", () => {
  const committed = (s: GameState, ids: string[]) => okOf(applyAction(CTX, s, commit(ids))).state;

  it("attackNumbers adds the air that counts and says which; the preview and the battle read the same function", () => {
    const s = committed(base(), ["a1"]);
    const defenders = [s.units.p1!];
    const n = attackNumbers(CTX, s, [s.units.u1!], defenders, "M33");
    expect(n).toMatchObject({ attackFactors: 7, airFactors: 3, defenseFactors: 2 });
    expect(n.air.map((u) => u.id)).toEqual(["a1"]);
    const none = attackNumbers(CTX, base(), [base().units.u1!], defenders, "M33");
    expect(none).toMatchObject({ attackFactors: 4, airFactors: 0, air: [] });
    expect(n.column).toBe(oddsColumn(7, 2 * n.multiplier)); // the odds are those of the larger attack
    expect(none.column).toBe(oddsColumn(4, 2 * none.multiplier));
  });

  it("the cap is three times the ground factors actually attacking, units counted in order, the rest committed but not counted", () => {
    const s = okOf(applyAction(CTX, committed(base(), ["a1"]), commit(["a2"]))).state; // 3 + 2 air committed
    expect(countedAir(s, "M33", 1)).toMatchObject({ factors: 3 }); // cap 3: a1 fits, a2 would make 5
    expect(countedAir(s, "M33", 2).units.map((u) => u.id)).toEqual(["a1", "a2"]); // cap 6
    expect(countedAir(s, "M33", 0)).toEqual({ units: [], factors: 0 });
    expect(countedAir(s, "L32", 9)).toEqual({ units: [], factors: 0 });
  });

  it("the battle counts the air: the event carries its factors, the record is cleared, the air stays flown", () => {
    const s = at7h(committed(base(), ["a1"]));
    const r = okOf(applyAction(CTX, s, attack(["u1"])));
    const fought = r.events.find((e) => e.type === "COMBAT_RESOLVED")!;
    expect(fought).toMatchObject({ attackFactors: 7, airFactors: 3 });
    expect(airOf(r.state).groundSupport).toEqual({});
    expect(hasFlown(r.state, "a1")).toBe(true);
  });

  /** Plays the same attack with different dice until each kind of result has been seen. */
  const byOutcome = () => {
    const out: Record<string, { before: GameState; after: GameState; events: GameEvent[] }> = {};
    for (let seed = 1; seed < 400 && Object.keys(out).length < 3; seed++) {
      const before = at7h(committed({ ...base(), rngState: seed * 7919 }, ["a1", "a2"]));
      const r = applyAction(CTX, before, attack(["u1"]));
      if (!r.ok) continue;
      const kind = (r.events.find((e) => e.type === "COMBAT_RESOLVED") as { outcome: string }).outcome;
      out[kind] ??= { before, after: r.state, events: r.events };
    }
    return out;
  };

  it("attacker eliminated: the air that counted goes with the ground units (result A)", () => {
    const hit = byOutcome()["attacker-eliminated"];
    expect(hit, "a seed with this result").toBeDefined();
    expect(hit!.after.units.u1).toBeUndefined();
    expect(hit!.after.units.a1).toBeUndefined();
    expect(hit!.after.units.a2).toBeUndefined();
    expect(hit!.events.filter((e) => e.type === "UNIT_ELIMINATED")).toHaveLength(3);
    expect(airOf(hit!.after).groundSupport).toEqual({});
  });

  it("defender eliminated: the attackers and their air live; only ground units advance", () => {
    const hit = byOutcome()["defender-eliminated"];
    expect(hit, "a seed with this result").toBeDefined();
    expect(hit!.after.units.a1).toBeDefined();
    expect(hit!.after.units.a2).toBeDefined();
    expect(hit!.after.units.p1).toBeUndefined();
    expect(combatOf(hit!.after).advances).toEqual([{ to: "M33", units: ["u1"] }]);
  });

  it("an Exchange: air is among the losses the attackers may choose, at its full factors", () => {
    const hit = byOutcome().exchange;
    expect(hit, "a seed with this result").toBeDefined();
    const pending = combatOf(hit!.after).pending;
    if (pending) {
      expect(pending.candidates).toEqual(expect.arrayContaining(["a1", "a2"]));
      expect(pending.values.a1).toBe(3);
      expect(pending.values.a2).toBe(2);
      const pick = legalActions(CTX, hit!.after).find((a) => a.type === "ALLOCATE_LOSSES")!;
      const done = okOf(applyAction(CTX, hit!.after, pick)).state;
      expect(combatOf(done).pending).toBeNull();
      expect(airOf(done).groundSupport).toEqual({});
    } else {
      expect(airOf(hit!.after).groundSupport).toEqual({}); // only one way to lose enough: settled at once
    }
  });

  it("an Exchange the attackers win: the air is a candidate to lose, at its full factors, and the ground units are not the only choice", () => {
    const s = at7h(okOf(applyAction(CTX, at7b([inf("u1", "germany", "M32", 4, 3), inf("p1", "poland", "M33", 3, 3), air("a1", "J32", 3), air("a2", "J32", 2)]), commit(["a1", "a2"]))).state);
    const battle = { outcome: { kind: "exchange" as const, multipliedDefense: true }, side: "axis" as const, target: "M33", attackers: [s.units.u1!], air: [s.units.a1!, s.units.a2!], defenders: [s.units.p1!], multiplier: 1 };
    const r = applyOutcome(CTX, { ...s, combat: { ...combatOf(s), attacked: ["u1"], targets: ["M33"] } }, battle);
    const pending = combatOf(r.state).pending!;
    expect(pending.chooser).toBe("axis");
    expect(pending.required).toBe(3); // the Poles' 3 factors
    expect(pending.candidates).toEqual(["u1", "a1", "a2"]);
    expect(pending.values).toEqual({ u1: 4, a1: 3, a2: 2 });
    expect(pending.attackers).toEqual(["u1"]); // only ground units advance
    const lose = okOf(applyAction(CTX, r.state, { type: "ALLOCATE_LOSSES", side: "axis", units: ["a1"] }));
    expect(lose.state.units.a1).toBeUndefined();
    expect(lose.state.units.u1).toBeDefined();
    expect(lose.state.units.a2).toBeDefined();
    expect(airOf(lose.state).groundSupport).toEqual({});
  });

  it("air that the cap leaves out is committed but neither counted nor lost", () => {
    const s = at7h(okOf(applyAction(CTX, at7b([inf("u1", "germany", "M32", 1, 3), inf("p1", "poland", "M33", 2, 3), air("a1", "J32", 3), air("a2", "J32", 2)]), commit(["a1"]))).state);
    const loose: GameState = { ...s, air: { ...airOf(s), groundSupport: { M33: ["a1", "a2"] } } }; // 5 committed against a cap of 3
    const r = okOf(applyAction(CTX, loose, attack(["u1"])));
    expect(r.events.find((e) => e.type === "COMBAT_RESOLVED")).toMatchObject({ attackFactors: 4, airFactors: 3 });
    expect(r.state.units.a2).toBeDefined();
  });

  it("a hex that holds only an air unit (a sweep, no battle) is not a target for ground support; if a commitment is there anyway the sweep clears it and the air is not lost", () => {
    const sweep = at7b([inf("u1", "germany", "M32", 4, 3), air("l1", "M33", 2, "poland"), air("a1", "J32", 3)]);
    expect(errorOf(applyAction(CTX, sweep, commit(["a1"])))).toMatch(/not a hex the axis side can attack/);
    expect(hasAirWork(CTX, sweep)).toBe(false);
    const forced = at7h({ ...sweep, air: { ...airOf(sweep), groundSupport: { M33: ["a1"] } } });
    const r = okOf(applyAction(CTX, forced, attack(["u1"])));
    expect(r.state.units.a1).toBeDefined();
    expect(airOf(r.state).groundSupport).toEqual({});
  });
});

describe("a committed hex that is not attacked", () => {
  it("costs the air when step 7h ends (Ref 20.41); an attacked hex does not", () => {
    const s = at7h(okOf(applyAction(CTX, base(), commit(["a1"]))).state);
    const r = okOf(applyAction(CTX, s, { type: "END_STEP", side: "axis", step: "7h" }));
    expect(r.state.units.a1).toBeUndefined();
    expect(r.state.units.a2).toBeDefined(); // not committed: untouched
    expect(kinds(r.events)).toEqual(expect.arrayContaining(["GROUND_SUPPORT_LOST", "UNIT_ELIMINATED"]));
    expect(r.events.find((e) => e.type === "GROUND_SUPPORT_LOST")).toMatchObject({ hex: "M33", units: [{ id: "a1", owner: "germany", strength: 3 }] });
    expect(airOf(r.state).groundSupport).toEqual({});
    const attacked = okOf(applyAction(CTX, s, attack(["u1"])));
    const end = okOf(applyAction(CTX, attacked.state, { type: "END_STEP", side: "axis", step: "7h" }));
    expect(kinds(end.events)).not.toContain("GROUND_SUPPORT_LOST");
  });
});
