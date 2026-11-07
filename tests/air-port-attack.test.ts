import { describe, expect, it } from "vitest";
import { PORT_ATTACK_MISSION_PERIOD, portAttackers, portAttackProblem, portCounterAirDefenders, resolvePortAttack, type PortAttackInput, type PortFleetLossChooser } from "../src/engine/air-port-attack";
import { markFlown } from "../src/engine/air-record";
import { portCapacity } from "../src/engine/naval-ports";
import type { GameContext } from "../src/engine/context";
import type { MapHex } from "../src/engine/map";
import type { GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

function context(): GameContext {
  const hexes: Record<string, MapHex> = {};
  for (let n = 1; n <= 6; n++) {
    const id = `A${n}`;
    hexes[id] = { id, land: "plain", sea: false, country: n === 1 ? "germany" : "britain", front: "western", features: ["port"] };
  }
  return { ...CTX, map: { hexes, hexsides: {} } };
}
const ctx = context();
const plane = (id = "p", strength = 1, at = "A1", owner: Unit["owner"] = "germany") => counter(id, owner, "air", strength, at);
const fleet = (id = "f", strength = 9, at = "A5", owner: Unit["owner"] = "britain") => counter(id, owner, "fleet", strength, at);
const position = (units = [plane(), fleet()], tweak: Partial<GameState> = {}) => board(units, undefined, {
  activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7b" },
  control: Object.fromEntries(Array.from({ length: 6 }, (_, n) => [`A${n + 1}`, n === 0 ? "germany" : "britain"])), ...tweak,
});
const problem = (s = position(), id = "p", target = "A5", unavailable: string[] = [], c = ctx) => portAttackProblem(c, s, unavailable, id, target);
const input = (strength = 1, rngState = 45): PortAttackInput => ({ target: "A5", attacker: [plane("p", strength)], fleets: [fleet()], counterAir: "not-needed", rngState });
const choose: PortFleetLossChooser = (pool, owed) => {
  let left = owed;
  return pool.flatMap((u) => {
    const factors = Math.min(left, u.strength);
    left -= factors;
    return factors ? [{ id: u.id, factors }] : [];
  });
};
const resolve = (i = input()) => resolvePortAttack(i, choose);

describe("port attack eligibility (Ref 20.45; Ops 5.46b)", () => {
  it("designates at 7b only; resolution is caller-owned at 7i", () => {
    expect(problem()).toBeNull();
    for (const tweak of [{ phase: "setup" }, { position: null }, { position: { part: "year-start" } }, { position: { part: "player-turn", turn: 1, step: "7i" } }] as Partial<GameState>[]) {
      expect(problem(position(undefined, tweak))).toMatch(/step 7b/);
    }
  });
  it("requires enemy-controlled ports holding enemy ships (Ref 20.45)", () => {
    for (const target of ["missing", "constructor", "A1"]) expect(problem(undefined, "p", target)).toMatch(/enemy port/);
    for (const holder of [null, "spain", "germany"] as const) expect(problem(position(undefined, { control: { A5: holder } }))).toMatch(/enemy port/);
    const city = context();
    city.map = { ...city.map, hexes: { ...city.map.hexes, A5: { ...city.map.hexes.A5!, features: ["city"] } } };
    expect(problem(undefined, "p", "A5", [], city)).toMatch(/enemy port/);
    for (const units of [[plane()], [plane(), fleet("f", 0)], [plane(), fleet("f", 9, "A5", "germany")], [plane(), fleet("f", 9, "A5", "spain")]]) {
      expect(problem(position(units))).toMatch(/enemy fleet/);
    }
  });
  it("requires Phasing positive whole air counters and returns sorted ids (Ref 20.45)", () => {
    const s = position([plane("z"), plane("a", 3), fleet(), plane("enemy", 1, "A1", "britain"), plane("neutral", 1, "A1", "spain")]);
    expect(portAttackers(ctx, s, [], "A5")).toEqual(["a", "z"]);
    for (const id of ["missing", "constructor", "f"]) expect(problem(s, id)).toMatch(/Only positive/);
    for (const strength of [0, -1, 1.5]) expect(problem(position([plane("p", strength), fleet()]))).toMatch(/Only positive/);
    for (const id of ["enemy", "neutral"]) expect(problem(s, id)).toMatch(/Phasing/);
    expect(problem(position([plane("p", 1, "A1", "britain"), fleet("f", 9, "A5", "germany")], {
      activeSide: "allies", control: { A1: "britain", A5: "germany" },
    }))).toBeNull();
  });
  it("rejects used, new and caller-unavailable planes (Ref 20.3; AER68)", () => {
    expect(PORT_ATTACK_MISSION_PERIOD).toBe("game-turn");
    for (const kind of ["ground-support", "new"] as const) expect(problem(markFlown(position(), ["p"], kind))).toMatch(/unavailable/);
    expect(problem(undefined, "p", "A5", ["p"])).toMatch(/unavailable/);
    expect(problem({ ...position(), airFlown: { turn: "1938-winter", units: { p: "new" } } })).toBeNull();
  });
  it("requires a usable land base (Ref 20.1)", () => {
    for (const at of ["missing", "us-box"]) expect(problem(position([plane("p", 1, at), fleet()]))).toMatch(/on-map/);
    const open = context();
    open.map = { ...open.map, hexes: { ...open.map.hexes, A1: { ...open.map.hexes.A1!, features: [] } } };
    expect(problem(undefined, "p", "A5", [], open)).toMatch(/not an air base/);
    open.map = { ...open.map, hexes: { ...open.map.hexes, A1: { ...open.map.hexes.A1!, land: null, sea: true } } };
    expect(problem(undefined, "p", "A5", [], open)).toMatch(/on-map/);
    expect(problem(position(undefined, { control: { A1: "britain", A5: "britain" } }))).toMatch(/not held/);
  });
  it("allows four flight hexes, rejects five and neutral crossings (Ref 20.2, 20.45)", () => {
    expect(problem()).toBeNull();
    expect(problem(position([plane(), fleet("f", 9, "A6")]), "p", "A6")).toMatch(/too far/);
    expect(problem(position(undefined, { control: { A1: "germany", A3: "spain", A5: "britain" } }))).toMatch(/neutral land/);
  });
  it("Counter-Air uses only unused enemy air in the port, never nearby planes (Ref 20.45; Peele Malta)", () => {
    const s = position([plane("z", 3, "A5", "britain"), plane("a", 1, "A5", "britain"), plane("near", 5, "A4", "britain"), plane("used", 1, "A5", "britain"), plane("own", 1, "A5"), plane("neutral", 1, "A5", "spain"), plane("zero", 0, "A5", "britain"), fleet()]);
    expect(portCounterAirDefenders(markFlown(s, ["used"], "ground-support"), "A5")).toEqual(["a", "z"]);
    expect(portCounterAirDefenders(s, "HH20")).toEqual([]);
    const malta = position([plane("malta", 1, "HH20", "britain")]);
    expect(portCounterAirDefenders(malta, "HH20")).toEqual(["malta"]);
    expect(portCounterAirDefenders({ ...s, activeSide: "allies" }, "A5")).toEqual(["own"]);
  });
});

describe("port attack resolution (Ref 20.45; Ops 5.46i)", () => {
  // Fixed seeds from the shared deterministic d6: 45 -> 1,6; 14 -> 3,3; 20 -> 5,3; 11 -> 4,4; 44 -> 6,1.
  it.each([[45, 1, 1, 0], [8, 1, 1, 0], [14, 3, 0, 0], [11, 4, 0, 0], [20, 5, 0, 1], [44, 6, 0, 1]])(
    "Ref 20.45: seed %i rolls %i (hits %i, air loss %i)", (seed, roll, hits, lost) => {
      const result = resolve(input(1, seed));
      expect(result.status).toBe("resolved");
      expect(result.rolls).toEqual([{ id: "p", roll }]);
      expect(result.navalHits).toBe(hits);
      expect(result.navalLost).toBe(hits);
      expect(result.air.lost).toBe(lost);
      expect(result.air.eliminated).toEqual(lost ? ["p"] : []);
      expect(result.air.surviving).toEqual(lost ? [] : [plane()]);
      expect(result.rngState).toBe((seed + 0x6d2b79f5) >>> 0);
      expect(result.flown).toEqual(["p"]);
    },
  );
  it("Ref 20.45: roll 2 also hits; every original factor rolls despite losses", () => {
    // seed 1 gives 4,1,4,6,6,2: two hits and two air losses.
    const i = { ...input(5, 1), attacker: [plane("z", 5), plane("a")] };
    const result = resolve(i);
    expect(result.rolls).toEqual([4, 1, 4, 6, 6, 2].map((roll, n) => ({ id: n < 5 ? "z" : "a", roll })));
    expect(result.navalHits).toBe(2);
    expect(result.air).toEqual({ surviving: [plane("z", 3), plane("a")], eliminated: [], lost: 2 });
    expect(result.rngState).toBe((1 + 6 * 0x6d2b79f5) >>> 0);
  });
  it("Ref 20.6/20.45: losses stay with the rolling counter; breakdown may exceed the roll loss (AER69)", () => {
    const result = resolve({ ...input(), attacker: [plane("z", 5), plane("a", 1)], rngState: 13 });
    // Seed 13 causes no air loss; seed 20 makes the five-factor counter break down to three.
    expect(result.air.lost).toBe(0);
    const broken = resolve({ ...input(5, 20), attacker: [plane("z", 5), plane("a")] });
    expect(broken.air.surviving.find((u) => u.id === "z")?.strength).toBe(3);
    expect(broken.air.surviving.find((u) => u.id === "a")?.strength).toBe(1);
    expect(broken.air.lost).toBe(2);
  });
  it.each(["not-needed", "beaten"] as const)("Ref 20.45: %s permits ship rolls", (counterAir) => {
    expect(resolve({ ...input(), counterAir }).rolls).toHaveLength(1);
  });
  it("Ref 20.45/Peele: unbeaten Counter-Air blocks ships, including Malta; no rolls or loss chooser", () => {
    for (const target of ["A5", "HH20"]) {
      const i = { ...input(), target, fleets: [fleet("f", 9, target)], counterAir: "not-beaten" as const };
      const result = resolvePortAttack(i, () => { throw new Error("chooser called"); });
      expect(result).toMatchObject({ status: "counter-air-blocked", rolls: [], rngState: 45, navalLost: 0, flown: ["p"] });
      expect(result.air.surviving).toEqual(i.attacker);
      expect(result.fleets).toEqual([{ id: "f", counters: [9], lost: 0 }]);
    }
  });
  it("Ref 20.45/R9: displacement cancels attack but consumes mission with no dice", () => {
    const result = resolvePortAttack({ ...input(), fleets: [] }, () => { throw new Error("chooser called"); });
    expect(result).toMatchObject({ status: "no-fleets", rolls: [], fleets: [], navalHits: 0, navalLost: 0, rngState: 45, flown: ["p"] });
  });
  it("Ref 20.45/21.7: cap hits to ships present; caller chooses fleet breakdown, untouched fleets stay whole (N29/N1/N2)", () => {
    const i = { ...input(3, 13), fleets: [fleet("first"), fleet("chosen")] };
    const result = resolvePortAttack(i, (pool, owed) => {
      expect(pool.map((u) => u.id)).toEqual(["first", "chosen"]);
      expect(owed).toBe(1);
      return [{ id: "chosen", factors: 1 }];
    });
    expect(result.fleets).toEqual([{ id: "first", counters: [9], lost: 0 }, { id: "chosen", counters: [6, 2], lost: 1 }]);
    const capped = resolve({ ...input(5, 13), fleets: [fleet("f", 1)] });
    expect(capped.navalHits).toBeGreaterThan(1);
    expect(capped.navalLost).toBe(1);
    expect(capped.fleets).toEqual([{ id: "f", counters: [], lost: 1 }]);
  });
  it("Ref 20.45: no chooser on a miss; no port capacity effect", () => {
    const capacity = portCapacity(ctx, "A5");
    const result = resolvePortAttack(input(1, 14), () => { throw new Error("chooser called"); });
    expect(result.fleets).toEqual([{ id: "f", counters: [9], lost: 0 }]);
    expect(portCapacity(ctx, "A5")).toBe(capacity);
  });
  it("rejects invalid explicit fleet allocations (Ref 20.45; N29)", () => {
    for (const take of [[], [{ id: "missing", factors: 1 }], [{ id: "f", factors: 0 }], [{ id: "f", factors: 1.5 }], [{ id: "f", factors: 10 }], [{ id: "f", factors: 1 }, { id: "f", factors: 1 }], [{ id: "f", factors: 2 }]]) {
      expect(() => resolvePortAttack(input(), () => take)).toThrow(RangeError);
    }
  });
  it("rejects malformed internal positions before dice or choice", () => {
    const base = input();
    for (const i of [{ ...base, attacker: [] }, { ...base, attacker: [fleet()] }, { ...base, attacker: [plane("p", 0)] }, { ...base, attacker: [plane("p", 1.5)] }, { ...base, fleets: [fleet("p")] }, { ...base, fleets: [plane()] }, { ...base, fleets: [fleet("f", -1)] }, { ...base, fleets: [fleet("f", 9, "A4")] }]) {
      expect(() => resolvePortAttack(i, choose)).toThrow(RangeError);
    }
  });
  it("spec 12 R21: deterministic JSON replay, frozen inputs, detached results and chooser pool", () => {
    const i = { ...input(5, 1), fleets: [fleet("f", 6)] };
    const before = JSON.stringify(i);
    i.attacker.forEach(Object.freeze); i.fleets.forEach(Object.freeze);
    Object.freeze(i.attacker); Object.freeze(i.fleets); Object.freeze(i);
    const result = resolvePortAttack(i, (pool, owed) => {
      (pool[0] as Unit).strength = 99;
      return [{ id: "f", factors: owed }];
    });
    expect(resolve(JSON.parse(before) as PortAttackInput)).toEqual(result);
    expect(JSON.stringify(i)).toBe(before);
    result.air.surviving[0]!.strength = 99;
    result.fleets[0]!.counters.push(99);
    expect(JSON.stringify(i)).toBe(before);
  });
});
