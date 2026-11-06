import { describe, expect, it } from "vitest";
import { resolveCounterAir, type CounterAirInput, type CounterAirLossChooser } from "../src/engine/air-counter";
import { autoAirLosses } from "../src/engine/air-losses";
import type { ForceOwner, Unit } from "../src/engine/types";

const plane = (id: string, strength = 1, owner: ForceOwner = "germany", at = "N33"): Unit =>
  ({ id, type: "air", owner, strength, movement: 4, at });
const planes = (prefix: string, n: number, owner: ForceOwner = "germany") =>
  Array.from({ length: n }, (_, i) => plane(`${prefix}${i}`, 1, owner, prefix === "a" ? "N30" : "N33"));
// The caller explicitly chooses this existing policy; the resolver has no default loss policy.
const choose: CounterAirLossChooser = (_side, pool, owed) => autoAirLosses(pool, owed);
const position = (a: number, d: number, rngState: number, extra = 0): CounterAirInput =>
  ({ target: "N33", attacker: planes("a", a), defender: planes("d", d),
    nonParticipating: planes("x", extra, "poland"), rngState });

interface Row {
  name: string; a: number; d: number; seed: number; extra?: number;
  nations?: [ForceOwner, ForceOwner]; mixed?: boolean;
  rolls: [number, number]; mods: [number, number]; losses: [number, number];
  winner: "attacker" | "defender" | null; free?: boolean; tie?: number;
}
// Ref 20.44 / spec 09 R7: hand calculations with one-factor counters isolate every table branch.
// Seeds pin real helper dice: 14=3,3,4; 11=4,4,4; 45=1,6,5; 44=6,1,1;
// 41=6,4,4; 8=1,4,2; 7=1,1,6; 20=5,3,4; 13=4,3,1.
const rows: Row[] = [
  { name: "larger attacker, winner loses half", a: 5, d: 3, seed: 14, rolls: [3, 3], mods: [5, 3], losses: [1, 2], winner: "attacker" },
  { name: "larger winning defender remains free", a: 3, d: 5, seed: 11, rolls: [4, 4], mods: [4, 6], losses: [2, 1], winner: "defender", free: true },
  { name: "nationality -1 and odd half rounded down", a: 2, d: 2, seed: 13, nations: ["italy", "france"], rolls: [4, 3], mods: [3, 2], losses: [0, 1], winner: "attacker" },
  { name: "smaller winning defender stays aborted", a: 4, d: 1, seed: 45, nations: ["germany", "ussr"], rolls: [1, 6], mods: [4, 5], losses: [1, 0], winner: "defender" },
  { name: "mixed nationality uses lowest DRM", a: 4, d: 4, seed: 14, mixed: true, rolls: [3, 3], mods: [2, 3], losses: [1, 0], winner: "defender" },
  { name: "spillover exhausts base and excess is ignored", a: 6, d: 2, extra: 3, seed: 44, rolls: [6, 1], mods: [10, 1], losses: [2, 5], winner: "attacker" },
  { name: "partial spillover", a: 4, d: 2, extra: 5, seed: 20, rolls: [5, 3], mods: [7, 3], losses: [2, 4], winner: "attacker" },
  { name: "nonparticipants do not increase advantage", a: 3, d: 2, extra: 10, seed: 14, rolls: [3, 3], mods: [4, 3], losses: [0, 1], winner: "attacker" },
  { name: "other nationality permits negative modified roll", a: 1, d: 6, seed: 7, nations: ["poland", "germany"], rolls: [1, 1], mods: [-1, 6], losses: [1, 0], winner: "defender", free: true },
  { name: "half uses capped actual loss", a: 7, d: 5, seed: 44, rolls: [6, 1], mods: [8, 1], losses: [2, 5], winner: "attacker" },
  { name: "tie capped at smaller force, larger defender not free", a: 3, d: 5, seed: 41, rolls: [6, 4], mods: [6, 6], losses: [3, 3], winner: null, tie: 4 },
  { name: "tie die below smaller force", a: 5, d: 5, seed: 14, rolls: [3, 3], mods: [3, 3], losses: [4, 4], winner: null, tie: 4 },
  { name: "already-flown defender has zero participants and no DRM", a: 3, d: 0, extra: 4, seed: 7, rolls: [1, 1], mods: [4, 1], losses: [1, 3], winner: "attacker" },
  { name: "zero-participant tie costs nothing", a: 3, d: 0, extra: 4, seed: 8, rolls: [1, 4], mods: [4, 4], losses: [0, 0], winner: null, tie: 2 },
  { name: "zero-participant defender wins but remains unavailable", a: 3, d: 0, extra: 4, seed: 45, rolls: [1, 6], mods: [4, 6], losses: [2, 0], winner: "defender" },
  { name: "winner loss capped at participants", a: 4, d: 1, extra: 4, seed: 45, nations: ["poland", "germany"], rolls: [1, 6], mods: [2, 6], losses: [4, 1], winner: "defender" },
  { name: "equal winning defender not free", a: 3, d: 3, seed: 45, rolls: [1, 6], mods: [1, 6], losses: [3, 1], winner: "defender" },
  { name: "larger losing defender not free", a: 3, d: 5, seed: 44, rolls: [6, 1], mods: [6, 3], losses: [1, 3], winner: "attacker" },
];

describe("counter-air Ref 20.42, 20.44", () => {
  for (const row of rows) it(`Ref 20.44: ${row.name}`, () => {
    const input = position(row.a, row.d, row.seed, row.extra);
    if (row.nations) {
      input.attacker = input.attacker.map((u) => ({ ...u, owner: row.nations![0] }));
      input.defender = input.defender.map((u) => ({ ...u, owner: row.nations![1] }));
    }
    if (row.mixed) input.attacker = input.attacker.map((u, i) => i === 0 ? { ...u, nationality: "italy" } : u);
    const result = resolveCounterAir(input, choose);
    const event = result.events[0]!;
    expect(result.events).toHaveLength(1);
    expect(event).toMatchObject({ type: "AIR_COMBAT_RESOLVED", kind: "counter-air", hex: "N33", rolls: row.rolls,
      lost: { attacker: row.losses[0], defender: row.losses[1] } });
    expect([event.combat.attacker.modifiedRoll, event.combat.defender.modifiedRoll]).toEqual(row.mods);
    expect(event.combat.winner).toBe(row.winner);
    expect(event.combat.tieRoll).toBe(row.tie ?? null);
    expect(event.combat.defenderSurvivorsFree).toBe(row.free ?? false);
    expect([result.attacker.lost, result.defender.lost]).toEqual(row.losses);
    expect(result.attacker.surviving).toHaveLength(row.a - row.losses[0]);
    expect(result.defender.surviving).toHaveLength(row.d + (row.extra ?? 0) - row.losses[1]);
    expect(result.attacker.aborted).toEqual(result.attacker.surviving.map((u) => u.id));
    expect(result.defender.aborted).toEqual(result.defender.surviving
      .filter((u) => !row.free || u.id.startsWith("x")).map((u) => u.id));
    expect(result.attacker.eliminated).toHaveLength(row.losses[0]);
    expect(result.defender.eliminated).toHaveLength(row.losses[1]);
    expect(result.rngState).toBe((row.seed + (row.tie ? 3 : 2) * 0x6d2b79f5) >>> 0);
    expect(result.attacker.surviving.every((u) => u.at === "N30")).toBe(true);
    expect(result.defender.surviving.every((u) => u.at === "N33")).toBe(true);
  });

  it("Ref 20.6/20.44: breakdown 5 to 3 makes actual loser loss 2, winner owes 1", () => {
    // Equal forces, dice 4-3: nominal loser loss 1. Its 5 breaks down to 3.
    const input = { ...position(5, 0, 13), defender: [plane("d", 5)] };
    const result = resolveCounterAir(input, choose);
    expect(result.defender.surviving).toEqual([plane("d", 3)]);
    expect(result.defender.lost).toBe(2);
    expect(result.attacker.lost).toBe(1);
    expect(result.events[0]!.combat.attacker.lossTotal).toBe(1);
  });

  it("Ref 20.44: caller chooses the unit lost; nationality overrides owner", () => {
    const input = position(2, 2, 13);
    input.attacker = input.attacker.map((u) => ({ ...u, nationality: "italy" }));
    input.defender = input.defender.map((u) => ({ ...u, owner: "france" }));
    const result = resolveCounterAir(input, (_side, pool, owed) => [{ id: pool[pool.length - 1]!.id, factors: owed }]);
    expect(result.defender.eliminated).toEqual(["d1"]);
    expect(result.defender.surviving.map((u) => u.id)).toEqual(["d0"]);
  });

  it("Ref 20.44: spillover choices use separate participating and already-flown pools", () => {
    const calls: [string, string[], number, boolean][] = [];
    resolveCounterAir(position(4, 2, 20, 5), (side, pool, owed, participating) => {
      calls.push([side, pool.map((u) => u.id), owed, participating]);
      return autoAirLosses(pool, owed);
    });
    expect(calls).toEqual([
      ["defender", ["d0", "d1"], 2, true],
      ["defender", ["x0", "x1", "x2", "x3", "x4"], 2, false],
      ["attacker", ["a0", "a1", "a2", "a3"], 2, true],
    ]);
  });

  it("Ref 20.3/20.44: larger winning defender cannot free already-flown survivors", () => {
    const result = resolveCounterAir(position(3, 5, 11, 2), choose);
    expect(result.defender.aborted).toEqual(["x0", "x1"]);
  });

  it("spec 09 R15: deterministic, JSON replayable and does not mutate frozen inputs", () => {
    const input = position(5, 5, 14);
    const before = JSON.stringify(input);
    for (const pool of [input.attacker, input.defender, input.nonParticipating!]) {
      pool.forEach(Object.freeze);
      Object.freeze(pool);
    }
    Object.freeze(input);
    const result = resolveCounterAir(input, choose);
    expect(resolveCounterAir(JSON.parse(before) as CounterAirInput, choose)).toEqual(result);
    expect(JSON.stringify(input)).toBe(before);
    result.attacker.surviving[0]!.strength = 99;
    expect(JSON.stringify(input)).toBe(before);
  });

  it("rejects invalid allocations instead of silently selecting losses (Ref 20.44)", () => {
    expect(() => resolveCounterAir(position(3, 3, 13), () => [])).toThrow(/Exactly 1/);
    expect(() => resolveCounterAir(position(3, 3, 13), () => [{ id: "missing", factors: 1 }])).toThrow(/not among/);
  });

  it("rejects malformed internal positions before calling a loss chooser", () => {
    const base = position(3, 3, 13);
    const bad: CounterAirInput[] = [
      { ...base, attacker: [] }, { ...base, defender: [] },
      { ...base, defender: [plane("a0")] },
      { ...base, defender: [plane("d", 0)] },
      { ...base, defender: [plane("d", 1.5)] },
      { ...base, defender: [{ ...plane("d"), type: "infantry" }] },
      { ...base, defender: [plane("d", 1, "germany", "N34")] },
      { ...base, nonParticipating: [plane("x", 1, "germany", "N34")] },
    ];
    for (const input of bad) expect(() => resolveCounterAir(input, () => { throw new Error("chooser called"); })).toThrow(RangeError);
  });
});
