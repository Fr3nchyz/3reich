import { describe, expect, it } from "vitest";
import { resolveSeaAttack } from "../src/engine/air-sea-attack";
import { chooseFleetLosses } from "../src/engine/air-port-wire";
import { counter } from "./board";

const plane = (id = "p", strength = 1) => counter(id, "germany", "air", strength, "N19");
const fleet = (id = "b", strength = 9) => counter(id, "britain", "fleet", strength, "N18");
const input = (rngState = 7) => ({ attacker: [plane()], fleets: [fleet()], rngState });

describe("pure sea attacks (spec 12 R15/R21, Ref 20.52, AER100/AER102)", () => {
  it("R15: a 1 hits a ship and a 6 loses its own attacking factor", () => {
    const hit = resolveSeaAttack(input(7), chooseFleetLosses);
    expect(hit.rolls).toEqual([{ id: "p", roll: 1 }]);
    expect(hit).toMatchObject({ navalHits: 1, navalLost: 1, air: { lost: 0 }, fleets: [{ id: "b", counters: [6, 2], lost: 1 }] });
    const loss = resolveSeaAttack(input(4), chooseFleetLosses);
    expect(loss.rolls).toEqual([{ id: "p", roll: 6 }]);
    expect(loss).toMatchObject({ navalHits: 0, navalLost: 0, air: { surviving: [], eliminated: ["p"], lost: 1 } });
  });
  it("R15/R21: other faces do nothing and every original factor rolls despite losses", () => {
    const quiet = resolveSeaAttack(input(1), chooseFleetLosses);
    expect(quiet.rolls).toEqual([{ id: "p", roll: 4 }]);
    expect(quiet).toMatchObject({ navalHits: 0, navalLost: 0, air: { lost: 0 } });
    const s = { attacker: [plane("p", 5), plane("q", 3)], fleets: [fleet()], rngState: 2 };
    const before = structuredClone(s), result = resolveSeaAttack(s, chooseFleetLosses);
    expect(result.rolls.map(r => r.id)).toEqual(["p", "p", "p", "p", "p", "q", "q", "q"]);
    expect(result.air.lost).toBeGreaterThan(0);
    expect(s).toEqual(before);
    expect(resolveSeaAttack(s, chooseFleetLosses)).toEqual(result);
  });
  it("AER100/AER103: no ships needs no dice or allocation", () => {
    const result = resolveSeaAttack({ ...input(), fleets: [] }, () => { throw Error("no allocation"); });
    expect(result).toMatchObject({ status: "no-fleets", rolls: [], rngState: 7, air: { lost: 0 } });
  });
  it("R15/AER102: cap hits at available factors, choose smaller ships first", () => {
    const result = resolveSeaAttack({ attacker: Array.from({ length: 10 }, (_, n) => plane(`p${n}`, 5)), fleets: [fleet("z", 1), fleet("a", 1)], rngState: 7 }, chooseFleetLosses);
    expect(result.navalHits).toBeGreaterThan(2);
    expect(result.navalLost).toBe(2);
    expect(result.fleets.every(f => f.counters.length === 0)).toBe(true);
    const ordered = resolveSeaAttack({ ...input(), fleets: [fleet("z", 2), fleet("b", 2), fleet("a", 9)] }, chooseFleetLosses);
    expect(ordered.fleets.map(f => [f.id, f.lost])).toEqual([["z", 0], ["b", 1], ["a", 0]]);
  });
  it("AER102: rejects invalid input and invalid explicit allocations", () => {
    for (const bad of [{ attacker: [] }, { attacker: [fleet()] }, { fleets: [plane()] }, { attacker: [plane("b")] },
      { attacker: [plane("p", 0)] }, { fleets: [fleet("b", 1.5)] }]) {
      expect(() => resolveSeaAttack({ ...input(), ...bad }, chooseFleetLosses)).toThrow(RangeError);
    }
    for (const take of [[], [{ id: "missing", factors: 1 }], [{ id: "b", factors: 0 }], [{ id: "b", factors: 10 }],
      [{ id: "b", factors: 0.5 }], [{ id: "b", factors: 1 }, { id: "b", factors: 1 }]]) {
      expect(() => resolveSeaAttack(input(), () => take)).toThrow(RangeError);
    }
  });
});
