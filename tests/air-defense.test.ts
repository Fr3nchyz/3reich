import { describe, expect, it } from "vitest";
import { DAS_CAP_MULTIPLE, DAS_MISSION_PERIOD, DAS_POTENTIAL_ATTACK_POLICY, defensiveAirNumbers, defensiveAirProblem, defensiveAirUnits, defensiveGroundFactors, type DefensiveAirInput } from "../src/engine/air-defense";
import { gameTurnKey, markFlown } from "../src/engine/air-record";
import type { GameContext } from "../src/engine/context";
import type { MapHex } from "../src/engine/map";
import type { GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

function context(): GameContext {
  const hexes: Record<string, MapHex> = {};
  for (let n = 1; n <= 7; n++) {
    const id = `A${n}`;
    hexes[id] = { id, land: "plain", sea: false, country: "britain", front: "western", features: ["city"] };
  }
  return { ...CTX, map: { hexes, hexsides: {} } };
}
const ctx = context();
const plane = (id = "p", at = "A1", owner: Unit["owner"] = "britain") => counter(id, owner, "air", 5, at);
const ground = (id = "g", at = "A5", owner: Unit["owner"] = "britain") => counter(id, owner, "infantry", 2, at);
const position = (units = [plane(), ground()], tweak: Partial<GameState> = {}): GameState => board(units, undefined, {
  activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7d" }, ...tweak,
});
const input: DefensiveAirInput = { potentialTargets: ["A5", "A6", "A1"], counterAirUnavailable: [] };
const problem = (s = position(), id = "p", target = "A5", i = input, c = ctx) => defensiveAirProblem(c, s, i, id, target);

describe("pure defensive air support (Ref 20.51; Ops 5.46d)", () => {
  it("requires step 7d (Ops 5.46d)", () => {
    expect(problem()).toBeNull();
    const tweaks: Partial<GameState>[] = [{ phase: "setup" as const }, { position: null }, { position: { part: "player-turn" as const, turn: 1, step: "7e" as const } }, { position: { part: "year-start" } }];
    for (const tweak of tweaks) {
      expect(problem(position(undefined, tweak))).toMatch(/step 7d/);
    }
  });

  it("requires caller-designated potential land targets (Ref 20.51; AER61)", () => {
    expect(DAS_POTENTIAL_ATTACK_POLICY).toBe("caller-supplied");
    expect(problem(undefined, "p", "A5", { ...input, potentialTargets: [] })).toMatch(/potential/);
    expect(problem(undefined, "p", "ZZ99")).toMatch(/potential/);
    const sea = context();
    sea.map = { ...sea.map, hexes: { ...sea.map.hexes, A5: { ...sea.map.hexes.A5!, land: null, sea: true } } };
    expect(problem(undefined, "p", "A5", input, sea)).toMatch(/potential/);
  });

  it("requires ground defenders, including Replacements, and excludes air/fleets/active or neutral ground (Ref 20.51, 12.1)", () => {
    const units = [plane(), plane("air", "A5"), counter("fleet", "britain", "fleet", 9, "A5"), ground("enemy", "A5", "germany"), ground("neutral", "A5", "spain")];
    expect(problem(position(units))).toMatch(/ground defenders/);
    expect(defensiveGroundFactors(position(units), "A5")).toBe(0);
    units.push(counter("replacement", "britain", "replacement", 1, "A5"));
    expect(problem(position(units))).toBeNull();
    expect(defensiveGroundFactors(position(units), "A5")).toBe(1);
    units.push(ground());
    expect(defensiveGroundFactors(position(units), "A5")).toBe(3);
  });

  it("selects only positive air counters of the Non-Phasing side, for either active side (Ref 20.51)", () => {
    const s = position([plane(), ground(), plane("enemy", "A1", "germany"), plane("neutral", "A1", "spain"), { ...plane("zero"), strength: 0 }]);
    expect(defensiveAirUnits(ctx, s, input, "A5")).toEqual(["p"]);
    for (const id of ["missing", "constructor", "g", "zero"]) expect(problem(s, id)).toMatch(/Only an air/);
    for (const id of ["enemy", "neutral"]) expect(problem(s, id)).toMatch(/Non-Phasing/);
    const axis = position([plane("p", "A1", "germany"), ground("g", "A5", "germany")], { activeSide: "allies", control: { A1: "germany" } });
    expect(problem(axis)).toBeNull();
  });

  it("checks a usable city or airbase, control and nationality (Ref 20.1)", () => {
    for (const at of ["us-box", "ZZ99"]) expect(problem(position([plane("p", at), ground()]))).toMatch(/on-map land base/);
    const open = context();
    open.map = { ...open.map, hexes: { ...open.map.hexes, A1: { ...open.map.hexes.A1!, features: [] } } };
    expect(problem(undefined, "p", "A5", input, open)).toMatch(/not an air base/);
    const based = position([plane(), ground(), counter("base", "britain", "airbase", 0, "A1")]);
    expect(problem(based, "p", "A5", input, open)).toBeNull();
    expect(problem(position(undefined, { control: { A1: "germany" } }))).toMatch(/not held/);
    expect(problem(position(undefined, { control: { A1: "france" } }))).toMatch(/British and French/);
    expect(problem(position(undefined, { year: 1942, control: { A1: "france" } }))).toBeNull();
    expect(problem(position([{ ...plane(), nationality: "ussr" }, ground()]))).toMatch(/Russian and Western/);
  });

  it("allows four hexes and same-base defense, refuses five (Ref 20.51)", () => {
    expect(problem()).toBeNull();
    expect(problem(position([plane(), ground("g", "A6")]), "p", "A6")).toMatch(/too far/);
    expect(problem(position([plane(), ground("g", "A1")]), "p", "A1")).toBeNull();
  });

  it("cannot cross neutral land (Ref 20.2)", () => {
    const neutral = context();
    neutral.map = { ...neutral.map, hexes: { ...neutral.map.hexes, A3: { ...neutral.map.hexes.A3!, country: "spain" } } };
    expect(problem(undefined, "p", "A5", input, neutral)).toMatch(/neutral/);
  });

  it("excludes used and newly built planes across Player Turns, resets next Game Turn (Ref 20.3; AER62)", () => {
    expect(DAS_MISSION_PERIOD).toBe("game-turn");
    for (const kind of ["ground-support", "new"] as const) {
      const earlier = markFlown(position(undefined, { activeSide: "allies" }), ["p"], kind);
      const s = { ...earlier, activeSide: "axis" as const };
      expect(problem(s)).toMatch(/unavailable/);
      expect(problem({ ...s, airFlown: { turn: gameTurnKey(s), units: { p: kind } } })).toMatch(/unavailable/);
      expect(problem({ ...s, year: s.year + 1 })).toBeNull();
    }
  });

  it("excludes counter-air aborts but permits free larger winning defenders; earlier missions still bar them (Ref 20.3, 20.44)", () => {
    expect(problem(undefined, "p", "A5", { ...input, counterAirUnavailable: ["p"] })).toMatch(/unavailable/);
    expect(problem()).toBeNull(); // caller omitted free surviving defender from aborted ids
    expect(problem(markFlown(position(), ["p"], "ground-support"))).toMatch(/unavailable/);
  });

  it("adds basic DAS after terrain, cap uses basic ground; GS just enters attack total (Ref 20.51, 12.1; spec 09 C4)", () => {
    expect(DAS_CAP_MULTIPLE).toBe(3);
    expect(defensiveAirNumbers(18, 3, 2, 0)).toEqual({ countedDas: 0, defenseTotal: 6, column: "3-1" });
    expect(defensiveAirNumbers(18, 3, 2, 5)).toEqual({ countedDas: 5, defenseTotal: 11, column: "1-1" });
    expect(defensiveAirNumbers(18, 3, 2, 9)).toEqual({ countedDas: 9, defenseTotal: 15, column: "1-1" });
    expect(defensiveAirNumbers(18, 3, 4, 50)).toEqual({ countedDas: 9, defenseTotal: 21, column: "1-2" });
    expect(defensiveAirNumbers(18, 3, 1, 5).defenseTotal).toBe(8);
    expect(defensiveAirNumbers(18, 0, 3, 50)).toEqual({ countedDas: 0, defenseTotal: 0, column: "5-1" });
    expect(defensiveAirNumbers(0, 3, 2, 5).column).toBeNull();
  });

  it("rejects invalid internal arithmetic inputs", () => {
    for (const n of [-1, NaN, Infinity]) {
      expect(() => defensiveAirNumbers(n, 3, 2, 5)).toThrow(RangeError);
      expect(() => defensiveAirNumbers(18, n, 2, 5)).toThrow(RangeError);
      expect(() => defensiveAirNumbers(18, 3, 2, n)).toThrow(RangeError);
      expect(() => defensiveAirNumbers(18, 3, n, 5)).toThrow(RangeError);
    }
    expect(() => defensiveAirNumbers(18, 3, 0, 5)).toThrow(RangeError);
  });

  it("is deterministic, preserves inputs/RNG, and sorts independently of insertion order (spec 09 C1/R15)", () => {
    const s = position([plane("z"), plane("a"), ground()]);
    const before = structuredClone({ s, input, ctx });
    expect(defensiveAirUnits(ctx, s, input, "A5")).toEqual(["a", "z"]);
    expect(defensiveAirUnits(ctx, { ...s, units: Object.fromEntries(Object.entries(s.units).reverse()) }, input, "A5")).toEqual(["a", "z"]);
    expect(defensiveAirNumbers(18, 3, 2, 5)).toEqual(defensiveAirNumbers(18, 3, 2, 5));
    expect({ s, input, ctx }).toEqual(before);
  });
});
