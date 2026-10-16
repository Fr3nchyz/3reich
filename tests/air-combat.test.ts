import { describe, expect, it } from "vitest";
import {
  AIR_COMBAT_RULES,
  type AirCombatRules,
  type AirForce,
  airRollsTie,
  forceNationalityDrm,
  resolveAirCombat,
} from "../src/engine/air-combat";
import type { PowerId } from "../src/engine/types";

// Spec 09 rule R7 (Ref 20.44). Every expected value below is worked out by hand from the rule
// text in docs/specs/09-air-units.md, not computed by the code under test.
const F = (factors: number, nationalities: (PowerId | "other")[], nonParticipating = 0): AirForce => ({
  factors,
  nationalities,
  nonParticipating,
});

interface Row {
  name: string;
  a: AirForce;
  d: AirForce;
  dice: [number, number];
  tie?: number;
  mods: [number, number]; // modified rolls [attacker, defender]
  aLoss: [number, number]; // [participating, non-participating]
  dLoss: [number, number];
  winner: "attacker" | "defender" | null;
  free?: boolean;
}

// Hand-written table. Modifiers: +1 per factor of excess, nationality 0 Germany/US/Britain,
// -1 Russia/Italy/France, -2 others (lowest of a mixed force).
const TABLE: Row[] = [
  { name: "R7.1/R7.3 larger attacker: 5 v 3, +2, rolls 3-3 -> 5 v 3; loser 2, winner half = 1", a: F(5, ["germany"]), d: F(3, ["britain"]), dice: [3, 3], mods: [5, 3], aLoss: [1, 0], dLoss: [2, 0], winner: "attacker" },
  { name: "R7.1/R7.5 larger defender wins: 3 v 5, rolls 4-4 -> 4 v 6; defender survivors free", a: F(3, ["germany"]), d: F(5, ["germany"]), dice: [4, 4], mods: [4, 6], aLoss: [2, 0], dLoss: [1, 0], winner: "defender", free: true },
  { name: "R7.1 nationality: Italy v France both -1, equal size, 4-3 -> 3 v 2; winner half of 1 rounds down to 0", a: F(2, ["italy"]), d: F(2, ["france"]), dice: [4, 3], mods: [3, 2], aLoss: [0, 0], dLoss: [1, 0], winner: "attacker" },
  { name: "R7.1/R7.5 smaller defender wins: 4 v 1 (USSR -1), 1-6 -> 4 v 5; not free", a: F(4, ["germany"]), d: F(1, ["ussr"]), dice: [1, 6], mods: [4, 5], aLoss: [1, 0], dLoss: [0, 0], winner: "defender", free: false },
  { name: "R7.1 mixed force Germany+Italy uses -1: 4 v 4 Britain, 5-5 -> 4 v 5; equal-size winner not free", a: F(4, ["germany", "italy"]), d: F(4, ["britain"]), dice: [5, 5], mods: [4, 5], aLoss: [1, 0], dLoss: [0, 0], winner: "defender", free: false },
  { name: "R7.2 loss beyond participants takes non-participants: diff 9, 2 flew + 3 sat: 2+3, rest ignored", a: F(6, ["germany"]), d: F(2, ["britain"], 3), dice: [6, 1], mods: [10, 1], aLoss: [2, 0], dLoss: [2, 3], winner: "attacker" },
  { name: "R7.2 partial spill: diff 4 v 2 flew + 5 sat: 2 then 2", a: F(4, ["germany"]), d: F(2, ["britain"], 5), dice: [5, 3], mods: [7, 3], aLoss: [2, 0], dLoss: [2, 2], winner: "attacker" },
  { name: "R7.2 boundary: diff equals participants (3), non-participants untouched", a: F(3, ["germany"]), d: F(3, ["germany"], 4), dice: [5, 2], mods: [5, 2], aLoss: [1, 0], dLoss: [3, 0], winner: "attacker" },
  { name: "R7.2 boundary: diff one below participants takes none from the others", a: F(3, ["germany"]), d: F(3, ["germany"], 4), dice: [4, 2], mods: [4, 2], aLoss: [1, 0], dLoss: [2, 0], winner: "attacker" },
  { name: "R7.2 boundary: diff one above participants takes exactly one non-participant", a: F(3, ["germany"]), d: F(3, ["germany"], 4), dice: [6, 2], mods: [6, 2], aLoss: [2, 0], dLoss: [3, 1], winner: "attacker" },
  { name: "R7.1 advantage counts participants only, not the planes that sat out", a: F(3, ["germany"]), d: F(2, ["germany"], 10), dice: [3, 3], mods: [4, 3], aLoss: [0, 0], dLoss: [1, 0], winner: "attacker" },
  { name: "R7.1 modified roll may go below zero: 1 (other) v 6 Germany, 1-1 -> -1 v 6", a: F(1, ["other"]), d: F(6, ["germany"]), dice: [1, 1], mods: [-1, 6], aLoss: [1, 0], dLoss: [0, 0], winner: "defender", free: true },
  { name: "R7.3 winner loses half rounded down: loser loses 5 -> winner 2", a: F(7, ["germany"]), d: F(5, ["germany"]), dice: [6, 1], mods: [8, 1], aLoss: [2, 0], dLoss: [5, 0], winner: "attacker" },
  { name: "R7.4 tie, third die 4, smaller force 3: each loses 3", a: F(3, ["germany"]), d: F(5, ["britain"]), dice: [6, 4], tie: 4, mods: [6, 6], aLoss: [3, 0], dLoss: [3, 0], winner: null },
  { name: "R7.4 tie, third die 2 below the smaller force: each loses 2", a: F(3, ["germany"]), d: F(5, ["britain"]), dice: [6, 4], tie: 2, mods: [6, 6], aLoss: [2, 0], dLoss: [2, 0], winner: null },
  { name: "R7.4 tie boundary: third die equal to the smaller force (3): each loses 3", a: F(3, ["germany"]), d: F(5, ["britain"]), dice: [6, 4], tie: 3, mods: [6, 6], aLoss: [3, 0], dLoss: [3, 0], winner: null },
  { name: "R7.4 tie, third die 6: still capped at the smaller force (3)", a: F(3, ["germany"]), d: F(5, ["britain"]), dice: [6, 4], tie: 6, mods: [6, 6], aLoss: [3, 0], dLoss: [3, 0], winner: null },
  { name: "R7.6 zero-factor defender: 3 v 0 (+3), 1-1 -> 4 v 1; its 3 lost come from the 4 that sat out", a: F(3, ["germany"]), d: F(0, [], 4), dice: [1, 1], mods: [4, 1], aLoss: [1, 0], dLoss: [0, 3], winner: "attacker" },
  { name: "R7.6 zero-factor defender gets no nationality DRM even if it names one (-2 ignored)", a: F(3, ["germany"]), d: F(0, ["other"], 4), dice: [1, 1], mods: [4, 1], aLoss: [1, 0], dLoss: [0, 3], winner: "attacker" },
  // OPEN reading, TODO(verify): R7 step 6 says the zero-factor defender's losses come out of the planes that sat
  // out, and step 4 caps a tie at "the smaller force" (here 0 participating). This row pins that reading only.
  { name: "R7.6/R7.4 zero-factor defender, tie: under the current reading (cap = participating) nobody loses", a: F(3, ["germany"]), d: F(0, [], 4), dice: [1, 4], tie: 5, mods: [4, 4], aLoss: [0, 0], dLoss: [0, 0], winner: null },
  { name: "R7.6 zero-factor defender wins: attacker loses the 2 difference, winner has nothing participating to lose", a: F(3, ["germany"]), d: F(0, [], 4), dice: [1, 6], mods: [4, 6], aLoss: [2, 0], dLoss: [0, 0], winner: "defender", free: false },
  { name: "R7.3 winner with fewer participants than half: capped at 1 (winnerLossReachesNonParticipants off)", a: F(4, ["other"]), d: F(1, ["germany"], 4), dice: [1, 6], mods: [2, 6], aLoss: [4, 0], dLoss: [1, 0], winner: "defender", free: false },
];

describe("R7 (Ref 20.44) air combat: hand-written table", () => {
  for (const row of TABLE) {
    it(row.name, () => {
      const r = resolveAirCombat(row.a, row.d, row.dice[0], row.dice[1], row.tie);
      expect([r.attacker.modifiedRoll, r.defender.modifiedRoll]).toEqual(row.mods);
      expect([r.attacker.lossParticipating, r.attacker.lossNonParticipating]).toEqual(row.aLoss);
      expect([r.defender.lossParticipating, r.defender.lossNonParticipating]).toEqual(row.dLoss);
      expect(r.attacker.lossTotal).toBe(row.aLoss[0] + row.aLoss[1]);
      expect(r.defender.lossTotal).toBe(row.dLoss[0] + row.dLoss[1]);
      expect(r.winner).toBe(row.winner);
      expect(r.tie).toBe(row.winner === null);
      expect(r.tieRoll).toBe(row.winner === null ? row.tie : null);
      expect(r.defenderSurvivorsFree).toBe(row.free ?? false);
    });
  }
});

describe("R7.1 modifiers", () => {
  it("R7.1 reports the advantage and nationality parts of each modified roll", () => {
    const r = resolveAirCombat(F(5, ["germany"]), F(3, ["ussr"]), 2, 2);
    expect(r.attacker).toMatchObject({ advantageDrm: 2, nationalityDrm: 0, modifiedRoll: 4 });
    expect(r.defender).toMatchObject({ advantageDrm: 0, nationalityDrm: -1, modifiedRoll: 1 });
  });
  it("R7.1 nationality chart: 0 Germany/U.S./Britain, -1 Russia/Italy/France, -2 others", () => {
    for (const n of ["germany", "usa", "britain"] as const) expect(forceNationalityDrm(F(1, [n]))).toBe(0);
    for (const n of ["ussr", "italy", "france"] as const) expect(forceNationalityDrm(F(1, [n]))).toBe(-1);
    expect(forceNationalityDrm(F(1, ["other"]))).toBe(-2);
  });
  it("R7.1 a mixed force uses its lowest DRM, in any order", () => {
    expect(forceNationalityDrm(F(2, ["germany", "france"]))).toBe(-1);
    expect(forceNationalityDrm(F(2, ["other", "germany", "italy"]))).toBe(-2);
    expect(forceNationalityDrm(F(2, ["britain", "usa"]))).toBe(0);
  });
  it("R7.6 a force with no participating factors has no nationality DRM", () => {
    expect(forceNationalityDrm(F(0, ["other"]))).toBe(0);
  });
  it("R7.1 advantage is symmetric: only the larger side gets it", () => {
    const r = resolveAirCombat(F(2, ["germany"]), F(6, ["germany"]), 3, 3);
    expect(r.attacker.advantageDrm).toBe(0);
    expect(r.defender.advantageDrm).toBe(4);
  });
});

describe("R7.5 survivors free (Non-Phasing side larger and won)", () => {
  it("R7.5 larger by exactly one and wins: free", () => {
    // A 4 v D 5: D +1; rolls 3-3 -> 3 v 4.
    expect(resolveAirCombat(F(4, ["germany"]), F(5, ["germany"]), 3, 3).defenderSurvivorsFree).toBe(true);
  });
  it("R7.5 larger but loses: not free", () => {
    expect(resolveAirCombat(F(3, ["germany"]), F(5, ["germany"]), 6, 1).defenderSurvivorsFree).toBe(false);
  });
  it("R7.5 larger but tied: not free", () => {
    expect(resolveAirCombat(F(3, ["germany"]), F(5, ["britain"]), 6, 4, 2).defenderSurvivorsFree).toBe(false);
  });
  it("R7.5 equal size and wins: not free", () => {
    expect(resolveAirCombat(F(3, ["germany"]), F(3, ["germany"]), 1, 6).defenderSurvivorsFree).toBe(false);
  });
  it("R7.5 the attacker's survivors are never free, however large and victorious", () => {
    expect(resolveAirCombat(F(9, ["germany"]), F(1, ["germany"]), 6, 1).defenderSurvivorsFree).toBe(false);
  });
});

describe("R7 whole dice space", () => {
  const dice = [1, 2, 3, 4, 5, 6];
  it("R7.2/R7.4 one factor each, same nation: the attacker loses it in 21 of the 36 rolls (hand count)", () => {
    // Hand count: 15 rolls where the defender's die is higher lose it (loser owes the difference, capped
    // at its 1 factor), 6 ties lose it (third die at least 1, capped at the smaller force 1), 15 wins lose nothing.
    let lost = 0;
    let defenderLost = 0;
    for (const a of dice) {
      for (const d of dice) {
        const r = resolveAirCombat(F(1, ["germany"]), F(1, ["germany"]), a, d, 3);
        lost += r.attacker.lossTotal;
        defenderLost += r.defender.lossTotal;
      }
    }
    expect(lost).toBe(21);
    expect(defenderLost).toBe(21);
  });
  it("R7 the roles are symmetric: swapping the sides swaps the results", () => {
    const pairs: [AirForce, AirForce][] = [
      [F(5, ["germany"]), F(3, ["ussr"], 2)],
      [F(2, ["italy", "germany"]), F(2, ["other"])],
      [F(4, ["britain"]), F(7, ["france"], 1)],
    ];
    for (const [x, y] of pairs) {
      for (const a of dice) {
        for (const d of dice) {
          const t = 4;
          const fwd = resolveAirCombat(x, y, a, d, t);
          const back = resolveAirCombat(y, x, d, a, t);
          expect(back.attacker).toEqual(fwd.defender);
          expect(back.defender).toEqual(fwd.attacker);
          expect(back.tie).toBe(fwd.tie);
        }
      }
    }
  });
  it("R7.2/R7.3 no side ever loses more than it has; the winner never loses more than half the loser's loss", () => {
    for (const nonPart of [0, 2, 9]) {
      for (const a of dice) {
        for (const d of dice) {
          const A = F(4, ["germany"], nonPart);
          const D = F(2, ["italy"], nonPart);
          const r = resolveAirCombat(A, D, a, d, 5);
          expect(r.attacker.lossParticipating).toBeLessThanOrEqual(4);
          expect(r.defender.lossParticipating).toBeLessThanOrEqual(2);
          expect(r.attacker.lossNonParticipating).toBeLessThanOrEqual(nonPart);
          expect(r.defender.lossNonParticipating).toBeLessThanOrEqual(nonPart);
          if (r.winner === "attacker") expect(r.attacker.lossTotal).toBeLessThanOrEqual(Math.floor(r.defender.lossTotal / 2));
          if (r.winner === "defender") expect(r.defender.lossTotal).toBeLessThanOrEqual(Math.floor(r.attacker.lossTotal / 2));
        }
      }
    }
  });
});

describe("R7.4 tie detection and input checks", () => {
  it("R7.4 airRollsTie is true only when the modified rolls are equal", () => {
    const a = F(3, ["germany"]);
    const d = F(5, ["britain"]); // defender +2
    expect(airRollsTie(a, d, 6, 4)).toBe(true);
    expect(airRollsTie(a, d, 6, 3)).toBe(false);
    expect(airRollsTie(a, d, 5, 4)).toBe(false);
  });
  it("R7.4 a tie without the third die is a programming error", () => {
    expect(() => resolveAirCombat(F(3, ["germany"]), F(5, ["britain"]), 6, 4)).toThrow(RangeError);
  });
  it("R7.4 the third die is ignored when the rolls do not tie", () => {
    const r = resolveAirCombat(F(3, ["germany"]), F(3, ["germany"]), 6, 1, 6);
    expect(r.tieRoll).toBeNull();
    expect(r.tie).toBe(false);
  });
  it("refuses dice outside 1-6 and non-integers", () => {
    const a = F(3, ["germany"]);
    for (const bad of [0, 7, 2.5, Number.NaN]) {
      expect(() => resolveAirCombat(a, a, bad, 3)).toThrow(RangeError);
      expect(() => resolveAirCombat(a, a, 3, bad)).toThrow(RangeError);
      expect(() => resolveAirCombat(a, a, 3, 3, bad)).toThrow(RangeError);
    }
  });
  it("refuses an empty combat, negative or fractional factors, and a force with no nationality", () => {
    expect(() => resolveAirCombat(F(0, [], 2), F(0, [], 3), 1, 1)).toThrow(RangeError);
    expect(() => resolveAirCombat(F(-1, ["germany"]), F(1, ["germany"]), 1, 1)).toThrow(RangeError);
    expect(() => resolveAirCombat(F(1.5, ["germany"]), F(1, ["germany"]), 1, 1)).toThrow(RangeError);
    expect(() => resolveAirCombat(F(2, []), F(1, ["germany"]), 1, 1)).toThrow(RangeError);
    expect(() => resolveAirCombat(F(2, ["germany"], -1), F(1, ["germany"]), 1, 1)).toThrow(RangeError);
  });
});

describe("rule switches (TODO(verify)) are real branches", () => {
  it("R7.3 winnerLossReachesNonParticipants: the winner's excess half comes from the planes that sat out", () => {
    const rules: AirCombatRules = { ...AIR_COMBAT_RULES, winnerLossReachesNonParticipants: true };
    const r = resolveAirCombat(F(4, ["other"]), F(1, ["germany"], 4), 1, 6, undefined, rules);
    expect(r.defender).toMatchObject({ lossParticipating: 1, lossNonParticipating: 1, lossTotal: 2 });
    const capped = resolveAirCombat(F(4, ["other"]), F(1, ["germany"], 1), 1, 6, undefined, rules);
    expect(capped.defender.lossNonParticipating).toBe(1);
    const few = resolveAirCombat(F(4, ["other"]), F(1, ["germany"], 0), 1, 6, undefined, rules);
    expect(few.defender.lossNonParticipating).toBe(0);
  });
});

describe("open readings (TODO(verify), docs/RULES.md) are switches with the current reading as default", () => {
  it("R7.5 'larger' means strictly more by default; at least as many when switched", () => {
    const a = F(3, ["germany"]);
    const d = F(3, ["germany"]);
    expect(resolveAirCombat(a, d, 1, 6).defenderSurvivorsFree).toBe(false);
    const rules: AirCombatRules = { ...AIR_COMBAT_RULES, largerMeansStrictlyMore: false };
    expect(resolveAirCombat(a, d, 1, 6, undefined, rules).defenderSurvivorsFree).toBe(true);
  });
  it("R7.5 no one is free after a tie by default; a larger defender is when switched, a smaller one never", () => {
    const rules: AirCombatRules = { ...AIR_COMBAT_RULES, tieFreesLargerDefender: true };
    // 3 v 5 (Britain, +2): 6 against 4 ties at 6.
    expect(resolveAirCombat(F(3, ["germany"]), F(5, ["britain"]), 6, 4, 2).defenderSurvivorsFree).toBe(false);
    expect(resolveAirCombat(F(3, ["germany"]), F(5, ["britain"]), 6, 4, 2, rules).defenderSurvivorsFree).toBe(true);
    // 5 v 3: the defender (Britain, 3 factors) is smaller; modified 6 v 6 needs the attacker's +2 against a 4.
    expect(resolveAirCombat(F(5, ["germany"]), F(3, ["britain"]), 4, 6, 2, rules).defenderSurvivorsFree).toBe(false);
  });
  it("R7.6 a zero-factor attacker has no nationality DRM by default; only the defender has none when switched", () => {
    const zero = F(0, ["other"], 2);
    const d = F(3, ["germany"]);
    const def = resolveAirCombat(zero, d, 3, 3);
    expect(def.attacker).toMatchObject({ nationalityDrm: 0, modifiedRoll: 3 });
    const rules: AirCombatRules = { ...AIR_COMBAT_RULES, zeroFactorNoDrmEitherSide: false };
    const off = resolveAirCombat(zero, d, 3, 3, undefined, rules);
    expect(off.attacker).toMatchObject({ nationalityDrm: -2, modifiedRoll: 1 });
    // zero-factor attacker (die 6, +0) against Germany's 3 (die 3, +3): tie at 6 only while the attacker has no DRM.
    expect(airRollsTie(zero, d, 6, 3)).toBe(true);
    expect(airRollsTie(zero, d, 6, 3, rules)).toBe(false);
    // 3 v 0 factors: the defender's side never gets the DRM, with the switch either way.
    expect(resolveAirCombat(d, F(0, ["other"], 2), 1, 1, undefined, rules).defender.nationalityDrm).toBe(0);
  });
});
