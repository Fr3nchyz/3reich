import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction } from "../src/engine/actions";
import { attackNumbers, defendersAt } from "../src/engine/attack-rules";
import { exchangeCost } from "../src/engine/attack-losses";
import { combatOf } from "../src/engine/combat-record";
import { defenseBasis, defenseMultiplier, type DefenseSituation } from "../src/engine/terrain";
import type { ForceOwner, GameState, Unit, UnitType } from "../src/engine/types";
import { CTX, atStart, atStartOffensive } from "./helpers";

/**
 * Spec 07 ticket 07-2: the two engine pieces the odds preview reads, with no change of behaviour.
 * Positions are on the real map (see ground-combat.test.ts): M32-M33 plain, Q33-Q34 mountains, K35-K34 a river, I30-I31 a crossing arrow.
 */

const unit = (id: string, owner: ForceOwner, type: UnitType, strength: number, at: string): Unit => ({ id, owner, type, strength, at });
const GER = (id: string, at: string, strength = 3) => unit(id, "germany", "infantry", strength, at);
const POL = (id: string, at: string, strength = 1) => unit(id, "poland", "infantry", strength, at);
function at7h(units: Unit[], seed = 1, extra: Partial<GameState> = {}): GameState {
  return { ...atStartOffensive(SCENARIO_1939, 1), activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7h" }, units: Object.fromEntries(units.map((u) => [u.id, u])), rngState: seed, ...extra };
}
const numbers = (units: Unit[], attackers: string[], target: string, extra: Partial<GameState> = {}) => {
  const s = at7h(units, 1, extra);
  const att = attackers.map((id) => s.units[id]!);
  return attackNumbers(CTX, s, att, defendersAt(s, att, target), target);
};

describe("the reason for the defender's multiplier (Ref 4.5, 4.51)", () => {
  const cases: [string, DefenseSituation, number, string][] = [
    ["plain country doubles", { terrain: "plain" }, 2, "plain"],
    ["a city on plain is still only doubled", { terrain: "plain", features: ["city"] }, 2, "plain"],
    ["mountains triple", { terrain: "mountains" }, 3, "mountains"],
    ["swamp triples", { terrain: "swamp" }, 3, "swamp"],
    ["a river or crossing arrow triples", { terrain: "plain", behindRiverOrArrow: true }, 3, "river-or-arrow"],
    ["a beach triples against a Seaborne Invasion", { terrain: "plain", features: ["beach"], seaborneInvasion: true }, 3, "beach-invasion"],
    ["a beach does nothing without a Seaborne Invasion", { terrain: "plain", features: ["beach"] }, 2, "plain"],
    ["a fortress quadruples", { terrain: "plain", fortress: true }, 4, "fortress"],
    ["benefits do not add: a fortress on a mountain behind a river is x4, named fortress", { terrain: "mountains", fortress: true, behindRiverOrArrow: true }, 4, "fortress"],
    ["benefits do not add: a mountain behind a river is x3, named mountains", { terrain: "mountains", behindRiverOrArrow: true }, 3, "mountains"],
  ];
  for (const [name, situation, multiplier, basis] of cases) {
    it(name, () => {
      expect(defenseBasis(situation)).toEqual({ multiplier, basis });
      expect(defenseMultiplier(situation)).toBe(multiplier);
    });
  }

  it("defenseMultiplier is always the number defenseBasis gives, over every combination of inputs", () => {
    for (const terrain of ["plain", "mountains", "swamp", "qattara-depression"] as const)
      for (const fortress of [false, true])
        for (const behindRiverOrArrow of [false, true])
          for (const seaborneInvasion of [false, true])
            for (const features of [[], ["beach"]] as const) {
              const s: DefenseSituation = { terrain, fortress, behindRiverOrArrow, seaborneInvasion, features };
              expect(defenseMultiplier(s)).toBe(defenseBasis(s).multiplier);
            }
  });

  it("attackNumbers carries the reason, from the same rule as the multiplier", () => {
    expect(numbers([GER("g1", "M32", 4), POL("p1", "M33", 2)], ["g1"], "M33")).toMatchObject({ multiplier: 2, basis: "plain" });
    expect(numbers([GER("g1", "Q33", 6), POL("p1", "Q34", 2)], ["g1"], "Q34")).toMatchObject({ multiplier: 3, basis: "mountains" });
    expect(numbers([GER("g1", "K35", 6), POL("p1", "K34", 2)], ["g1"], "K34")).toMatchObject({ multiplier: 3, basis: "river-or-arrow" });
    expect(numbers([GER("g1", "I30", 6), POL("p1", "I31", 2)], ["g1"], "I31")).toMatchObject({ multiplier: 3, basis: "river-or-arrow" });
    expect(numbers([GER("g1", "M32", 8), POL("p1", "M33", 2)], ["g1"], "M33", { fortresses: { M33: true } })).toMatchObject({ multiplier: 4, basis: "fortress" });
    expect(numbers([GER("g1", "Q33", 8), POL("p1", "Q34", 2)], ["g1"], "Q34", { fortresses: { Q34: true } })).toMatchObject({ multiplier: 4, basis: "fortress" });
  });

  it("the river reason is lost when one attacker is not across it, and comes back when that attacker is left out", () => {
    const units = [GER("g1", "K35", 3), GER("g2", "L33", 3), POL("p1", "K34", 2)];
    expect(numbers(units, ["g1", "g2"], "K34")).toMatchObject({ multiplier: 2, basis: "plain" });
    expect(numbers(units, ["g1"], "K34")).toMatchObject({ multiplier: 3, basis: "river-or-arrow" });
  });
});

describe("the cost of an Exchange (Ref 12.2)", () => {
  it("the smaller side loses everything and the larger removes at least that many factors, at the defenders' multiplied value", () => {
    // 3+2 attack (5) against 1+1 at x2 (4): the defenders go; the attackers choose at least 4 of their own factors.
    const c = exchangeCost([GER("g1", "M32", 3), GER("g2", "M32", 2)], [POL("p1", "M33"), POL("p2", "M33")], 2);
    expect(c).toEqual({ attackTotal: 5, defenseTotal: 4, attackersLoseAll: false, defendersLoseAll: true, chooser: "attackers", required: 4, values: { g1: 3, g2: 2 } });
  });
  it("a larger defender removes at least the attackers' factors, each unit counting at the multiple", () => {
    // 2+2 attack (4) against 2+2 at x2 (8): the attackers go; the defenders choose at least 4, each of their units worth 4.
    const c = exchangeCost([GER("g1", "M32", 2), GER("g2", "M32", 2)], [POL("p1", "M33", 2), POL("p2", "M33", 2)], 2);
    expect(c).toEqual({ attackTotal: 4, defenseTotal: 8, attackersLoseAll: true, defendersLoseAll: false, chooser: "defenders", required: 4, values: { p1: 4, p2: 4 } });
  });
  it("equal totals: both lose everything and nobody chooses", () => {
    const c = exchangeCost([GER("g1", "M32", 2), GER("g2", "M32", 2)], [POL("p1", "M33", 2)], 2);
    expect(c).toMatchObject({ attackTotal: 4, defenseTotal: 4, attackersLoseAll: true, defendersLoseAll: true, chooser: null, required: 0, values: {} });
  });
  it("on a counterattack's Exchange the defenders count basic factors (multiple 1)", () => {
    const c = exchangeCost([GER("g1", "M32", 2), GER("g2", "M32", 2)], [POL("p1", "M33", 2)], 1);
    expect(c).toMatchObject({ defenseTotal: 2, defendersLoseAll: true, attackersLoseAll: false, chooser: "attackers", required: 2, values: { g1: 2, g2: 2 } });
  });
});

describe("what the preview reads is what the battle uses", () => {
  const sides: Record<string, string> = { attackers: "axis", defenders: "allies" };
  const positions: { name: string; units: Unit[]; attackers: string[]; target: string; extra?: Partial<GameState> }[] = [
    { name: "plain, attackers larger", units: [GER("g1", "M32", 3), GER("g2", "M32", 2), GER("g3", "N32", 2), POL("p1", "M33"), POL("p2", "M33")], attackers: ["g1", "g2", "g3"], target: "M33" },
    { name: "plain, defenders larger", units: [GER("g1", "M32", 2), GER("g2", "M32", 2), POL("p1", "M33", 2), POL("p2", "M33", 2)], attackers: ["g1", "g2"], target: "M33" },
    { name: "plain, equal", units: [GER("g1", "M32", 2), GER("g2", "M32", 2), POL("p1", "M33", 2)], attackers: ["g1", "g2"], target: "M33" },
    { name: "mountains", units: [GER("g1", "Q33", 6), GER("g2", "Q33", 1), POL("p1", "Q34", 2), POL("p2", "Q34", 1)], attackers: ["g1", "g2"], target: "Q34" },
    { name: "river", units: [GER("g1", "K35", 5), GER("g2", "K35", 2), POL("p1", "K34", 2), POL("p2", "K34", 1)], attackers: ["g1", "g2"], target: "K34" },
    { name: "river cancelled by a second hex", units: [GER("g1", "K35", 3), GER("g2", "L33", 3), POL("p1", "K34", 2), POL("p2", "K34", 1)], attackers: ["g1", "g2"], target: "K34" },
    { name: "fortress", units: [GER("g1", "M32", 6), GER("g2", "M32", 3), POL("p1", "M33", 2), POL("p2", "M33", 1)], attackers: ["g1", "g2"], target: "M33", extra: { fortresses: { M33: true } } },
  ];

  for (const p of positions) {
    it(`${p.name}: numbers, column, basis and Exchange cost equal the battle's, over 150 seeds`, () => {
      let exchanges = 0;
      for (let seed = 1; seed <= 150; seed++) {
        const s = at7h(p.units, seed, p.extra);
        const att = p.attackers.map((id) => s.units[id]!);
        const defenders = defendersAt(s, att, p.target);
        const shown = attackNumbers(CTX, s, att, defenders, p.target);
        const r = applyAction(CTX, s, { type: "ATTACK", side: "axis", units: p.attackers, target: p.target });
        if (!r.ok) throw new Error(r.error);
        const e = r.events.find((x) => x.type === "COMBAT_RESOLVED")!;
        if (e.type !== "COMBAT_RESOLVED") throw new Error("no result");
        expect(e).toMatchObject({ attackFactors: shown.attackFactors, defenseFactors: shown.defenseFactors, multiplier: shown.multiplier });
        if (e.outcome !== "exchange" || e.rounds.at(-1)?.by !== "attacker") continue;
        // An Exchange rolled on the original attack counts the defenders at the multiple.
        exchanges++;
        const cost = exchangeCost(att, defenders, shown.multiplier);
        const left = (us: Unit[]) => us.filter((u) => r.state.units[u.id] !== undefined).map((u) => u.id);
        if (cost.attackersLoseAll) expect(left(att)).toEqual([]);
        if (cost.defendersLoseAll) expect(left(defenders)).toEqual([]);
        const pending = combatOf(r.state).pending;
        if (pending) {
          expect(pending.required).toBe(cost.required);
          expect(pending.values).toEqual(cost.values);
          expect(pending.candidates).toEqual(Object.keys(cost.values));
          expect(pending.chooser).toBe(sides[cost.chooser!]);
        } else if (cost.chooser !== null) {
          // Nothing to choose: only one set was enough, so the chooser lost exactly the units that set holds, worth at least `required`.
          const lost = (cost.chooser === "attackers" ? att : defenders).filter((u) => r.state.units[u.id] === undefined);
          expect(lost.reduce((n, u) => n + cost.values[u.id]!, 0)).toBeGreaterThanOrEqual(cost.required);
        }
      }
      expect(exchanges).toBeGreaterThan(0);
    });
  }
});
