import { describe, expect, it } from "vitest";
import { DAS_ABORT_UNLESS_LARGER_WINNER, INTERCEPTION_RANGE, INTERCEPTION_RULES, interceptProblem, interceptors, resolveInterception, type InterceptionInput, type InterceptionLossChooser, type InterceptionRecord } from "../src/engine/air-intercept";
import { AIR_COMBAT_RULES } from "../src/engine/air-combat";
import { autoAirLosses } from "../src/engine/air-losses";
import { gameTurnKey, markFlown } from "../src/engine/air-record";
import type { GameContext } from "../src/engine/context";
import { distance, hexsideId, parseHexId } from "../src/engine/hex";
import type { MapHex, MapHexside } from "../src/engine/map";
import type { GameState, Unit } from "../src/engine/types";
import { board } from "./board";
import { CTX } from "./helpers";

const plane = (id: string, strength = 1, owner: Unit["owner"] = "germany", at = "A1"): Unit =>
  ({ id, type: "air", owner, strength, at, movement: 4 });
const planes = (prefix: string, n: number) => Array.from({ length: n }, (_, i) =>
  plane(`${prefix}${i}`, 1, prefix === "a" ? "germany" : "britain", prefix === "a" ? "A1" : "A8"));
// Caller explicitly chooses a policy; the resolver supplies none (Ref 20.44, spec 09 R7).
const choose: InterceptionLossChooser = (_side, pool, owed) => autoAirLosses(pool, owed);
const exchange = (a: number, d: number, rngState: number, continueDAS = true): InterceptionInput =>
  ({ interceptors: planes("a", a), support: planes("d", d), rngState, continueDAS });
function context(): GameContext {
  const hexes: Record<string, MapHex> = {}, hexsides: Record<string, MapHexside> = {};
  for (let n = 1; n <= 8; n++) {
    const id = `A${n}`;
    hexes[id] = { id, land: "plain", sea: false, country: "germany", front: "eastern", features: [] };
  }
  for (const a of Object.keys(hexes)) for (const b of Object.keys(hexes)) {
    const x = parseHexId(a)!, y = parseHexId(b)!;
    if (distance(x, y) !== 1) continue;
    const id = hexsideId(x, y);
    hexsides[id] = { id, land: true, sea: false };
  }
  return { ...CTX, map: { hexes, hexsides }, supplyEffects: true };
}
const ctx = context();
const position = (units = [plane("a"), plane("das", 5, "britain", "A8")], tweak: Partial<GameState> = {}) =>
  board(units, undefined, { activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7e" }, ...tweak });
const record: InterceptionRecord = { das: { A5: ["das"] }, unavailable: [] };

describe("DAS interception eligibility (Ref 20.43; Ops 5.46e)", () => {
  it("selects Phasing air of any size in id order, without a supply, base or Option requirement (Ref 19.3, 20.43)", () => {
    const s = position([plane("z", 5), plane("a"), plane("das", 5, "britain", "A8"),
      { ...plane("ground"), type: "infantry" }, plane("neutral", 1, "usa")]);
    expect(interceptors(ctx, s, record, "A5")).toEqual(["a", "z"]);
    for (const id of ["das", "ground", "missing", "constructor", "neutral"]) expect(interceptProblem(ctx, s, record, id, "A5")).not.toBeNull();
    expect(interceptProblem(ctx, s, record, "das", "A5")).toMatch(/Phasing/);
    expect(INTERCEPTION_RANGE).toBe(4);
  });

  it("requires normal interception step 7e (Ops 5.46e)", () => {
    for (const tweak of [{ phase: "setup" as const }, { position: null },
      { position: { part: "player-turn" as const, turn: 1 as const, step: "7m" as const } }]) {
      expect(interceptProblem(ctx, position(undefined, tweak), record, "a", "A5")).toMatch(/7e/);
    }
  });

  it("requires existing enemy DAS commitments (Ref 20.43)", () => {
    const s = position();
    for (const ids of [[], ["missing"], ["a"], ["neutral"], ["ground"]]) {
      const extra = position([...Object.values(s.units), plane("neutral", 1, "usa"), { ...plane("ground", 1, "britain"), type: "infantry" }]);
      expect(interceptProblem(ctx, extra, { ...record, das: { A5: ids } }, "a", "A5")).toMatch(/committed enemy DAS/);
    }
    for (const target of ["A4", "ZZ99", "constructor"]) expect(interceptors(ctx, s, record, target)).toEqual([]);
    expect(interceptProblem(ctx, s, { ...record, das: { ZZ99: ["das"] } }, "a", "ZZ99")).toMatch(/committed enemy DAS/);
  });

  it("rejects used, newly built and locally unavailable planes; ignores stale Game Turn use (Ref 20.3)", () => {
    const s = position();
    for (const kind of ["new", "ground-support"] as const) {
      expect(interceptProblem(ctx, markFlown(s, ["a"], kind), record, "a", "A5")).toMatch(/already flown/);
    }
    expect(interceptProblem(ctx, s, { ...record, unavailable: ["a"] }, "a", "A5")).toMatch(/unavailable/);
    const stale = { ...s, airFlown: { turn: `${gameTurnKey(s)}-old`, units: { a: "new" as const } } };
    expect(interceptProblem(ctx, stale, record, "a", "A5")).toBeNull();
  });

  it("allows exactly four hexes, blocks five, off-map origins and neutral-land routes (Ref 20.43, 20.2)", () => {
    const s = position();
    expect(interceptProblem(ctx, s, record, "a", "A5")).toBeNull();
    expect(interceptProblem(ctx, s, { ...record, das: { A6: ["das"] } }, "a", "A6")).toMatch(/too far/);
    expect(interceptProblem(ctx, position([plane("a", 1, "germany", "ZZ99"), s.units.das!]), record, "a", "A5")).toMatch(/map/);
    const neutral = { ...ctx, map: { ...ctx.map, hexes: { ...ctx.map.hexes, A3: { ...ctx.map.hexes.A3!, country: "sweden" } } } };
    expect(interceptProblem(neutral, s, record, "a", "A5")).toMatch(/neutral/);
    // Queries consume no dice and change neither state nor the caller's record (spec 09 R15).
    const before = JSON.stringify([s, record]);
    interceptors(ctx, s, record, "A5");
    expect(JSON.stringify([s, record])).toBe(before);
  });
});

// Ref 20.44: hand-calculated dice, modifiers, losses; one-factor counters isolate arithmetic.
const rows = [
  { name: "larger attacker wins", a: 5, d: 3, seed: 14, rolls: [3, 3], mods: [5, 3], losses: [1, 2], winner: "attacker" },
  { name: "larger winning DAS continues", a: 3, d: 5, seed: 11, rolls: [4, 4], mods: [4, 6], losses: [2, 1], winner: "defender", free: true },
  { name: "smaller winning DAS aborts", a: 4, d: 1, seed: 45, rolls: [1, 6], mods: [4, 6], losses: [2, 1], winner: "defender" },
  { name: "equal winning DAS aborts", a: 4, d: 4, seed: 45, rolls: [1, 6], mods: [1, 6], losses: [4, 2], winner: "defender" },
  { name: "loss caps at loser factors; odd half rounds down", a: 7, d: 5, seed: 44, rolls: [6, 1], mods: [8, 1], losses: [2, 5], winner: "attacker" },
  { name: "tie capped at smaller force", a: 3, d: 5, seed: 41, rolls: [6, 4], mods: [6, 6], losses: [3, 3], winner: null, tie: 4 },
  { name: "tie below smaller force", a: 5, d: 5, seed: 14, rolls: [3, 3], mods: [3, 3], losses: [4, 4], winner: null, tie: 4 },
];

describe("DAS exchange (Ref 20.44, 20.6; spec 09 R11/R15)", () => {
  it.each(rows)("$name (Ref 20.44; AER63/AER64)", (row) => {
    const input = exchange(row.a, row.d, row.seed);
    const r = resolveInterception(input, choose);
    expect(r.rolls).toEqual(row.rolls);
    expect([r.combat.attacker.modifiedRoll, r.combat.defender.modifiedRoll]).toEqual(row.mods);
    expect(r.combat.winner).toBe(row.winner);
    expect(r.combat.tieRoll).toBe(row.tie ?? null);
    expect([r.interceptors.lost, r.support.lost]).toEqual(row.losses);
    expect(r.interceptors.eliminated).toHaveLength(row.losses[0]!);
    expect(r.support.eliminated).toHaveLength(row.losses[1]!);
    expect(r.interceptors.surviving).toHaveLength(row.a - row.losses[0]!);
    expect(r.support.surviving).toHaveLength(row.d - row.losses[1]!);
    expect(r.interceptors.aborted).toEqual(r.interceptors.surviving.map((u) => u.id));
    expect(r.support.aborted).toEqual(row.free ? [] : r.support.surviving.map((u) => u.id));
    expect(r.continuing).toEqual(row.free ? r.support.surviving.map((u) => u.id) : []);
    expect(r.flown).toEqual([...input.interceptors, ...input.support].map((u) => u.id));
    expect(r.interceptors.surviving.every((u) => u.at === "A1")).toBe(true);
    expect(r.support.surviving.every((u) => u.at === "A8")).toBe(true);
    expect(r.rngState).toBe((row.seed + (row.tie ? 3 : 2) * 0x6d2b79f5) >>> 0);
  });

  it("smaller winning DAS with survivors still aborts (Ref 20.44; spec 09 R11 AER63)", () => {
    const input = exchange(4, 1, 45);
    input.support = [plane("d", 1, "ussr", "A8")];
    const r = resolveInterception(input, choose);
    expect(r.combat.winner).toBe("defender");
    expect(r.support.aborted).toEqual(["d"]);
    expect(r.continuing).toEqual([]);
  });

  it("lets larger winning DAS choose home, still having flown (Ref 20.44, 20.3)", () => {
    const r = resolveInterception(exchange(3, 5, 11, false), choose);
    expect(r.combat.defenderSurvivorsFree).toBe(true);
    expect(r.continuing).toEqual([]);
    expect(r.support.aborted).toEqual(r.support.surviving.map((u) => u.id));
    expect(r.flown).toHaveLength(8);
    expect(DAS_ABORT_UNLESS_LARGER_WINNER).toBe(true);
    expect(INTERCEPTION_RULES).toBe(AIR_COMBAT_RULES);
  });

  it("uses actual breakdown before the winner half, in both directions (Ref 20.6, 20.44)", () => {
    const input = { ...exchange(5, 5, 13), support: [plane("d", 5, "britain", "A8")] };
    const r = resolveInterception(input, choose);
    expect(r.support.surviving).toEqual([plane("d", 3, "britain", "A8")]);
    expect([r.support.lost, r.interceptors.lost, r.combat.attacker.lossTotal]).toEqual([2, 1, 1]);
    const reverse = resolveInterception({ ...exchange(5, 5, 8), interceptors: [plane("a", 5)] }, choose);
    expect([reverse.interceptors.lost, reverse.support.lost]).toEqual([3, 1]);
  });

  it("uses lowest nationality including lent and other nations, with caller loss choices (Ref 20.44)", () => {
    const input = exchange(2, 2, 13);
    input.interceptors = input.interceptors.map((u) => ({ ...u, nationality: "italy" }));
    input.support = input.support.map((u) => ({ ...u, owner: "france" }));
    const r = resolveInterception(input, (_side, pool, owed) => [{ id: pool[pool.length - 1]!.id, factors: owed }]);
    expect([r.combat.attacker.nationalityDrm, r.combat.defender.nationalityDrm]).toEqual([-1, -1]);
    expect(r.support.eliminated).toEqual(["d1"]);
    const mixed = exchange(4, 4, 14);
    mixed.interceptors = mixed.interceptors.map((u, i) => i === 0 ? { ...u, owner: "poland" } : u);
    const other = resolveInterception(mixed, choose);
    expect(other.combat.attacker.nationalityDrm).toBe(-2);
    expect([other.interceptors.lost, other.support.lost]).toEqual([2, 1]);
  });

  it("is deterministic, replayable, and isolates inputs from outputs and the chooser (spec 09 R15)", () => {
    const input = exchange(5, 5, 14);
    const before = JSON.stringify(input);
    for (const pool of [input.interceptors, input.support]) { pool.forEach(Object.freeze); Object.freeze(pool); }
    Object.freeze(input);
    const r = resolveInterception(input, (side, pool, owed) => {
      const take = choose(side, pool, owed);
      (pool[0] as Unit).at = "ZZ99";
      return take;
    });
    expect(resolveInterception(JSON.parse(before) as InterceptionInput, choose)).toEqual(r);
    r.interceptors.surviving[0]!.strength = 99;
    expect(JSON.stringify(input)).toBe(before);
  });

  it("rejects malformed forces and allocations (Ref 20.44)", () => {
    const input = exchange(3, 3, 13);
    for (const bad of [{ ...input, interceptors: [] }, { ...input, support: [] },
      ...[plane("a0"), plane("d", 0), plane("d", -1), plane("d", 1.5), { ...plane("d"), type: "infantry" as const }].map((u) => ({ ...input, support: [u] }))]) {
      expect(() => resolveInterception(bad, () => { throw new Error("chooser called"); })).toThrow(RangeError);
    }
    expect(() => resolveInterception(input, () => [])).toThrow(/Exactly 1/);
    expect(() => resolveInterception(input, () => [{ id: "missing", factors: 1 }])).toThrow(/not among/);
  });
});
