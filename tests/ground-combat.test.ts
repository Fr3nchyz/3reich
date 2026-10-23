import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, replay, type Action, type GameEvent } from "../src/engine/actions";
import { attackNumbers, defendersAt, isEnemy } from "../src/engine/attack-rules";
import { combatOf } from "../src/engine/combat-record";
import { resolveOffensiveCombat } from "../src/engine/combat";
import { rollD6 } from "../src/engine/rng";
import { settle } from "../src/engine/turn";
import type { ForceOwner, GameState, Unit, UnitType } from "../src/engine/types";
import { CTX, atStartOffensive } from "./helpers";

/**
 * Spec 04: ground combat at step 7h (Ref 12.1-12.2, 4.5; PC README 14.23). Positions are on the real
 * map: M32 is German plain next to M33 (a Polish city on plain), K35-K34 is a river hexside,
 * Q33-Q34 a mountain defence, I30-I31 a crossing arrow, J36-J35 a hexside no ground unit may attack over.
 */

const unit = (id: string, owner: ForceOwner, type: UnitType, strength: number, at: string): Unit => ({ id, owner, type, strength, at });
const GER = (id: string, at: string, strength = 3) => unit(id, "germany", "infantry", strength, at);
const POL = (id: string, at: string, strength = 1) => unit(id, "poland", "infantry", strength, at);

/** Axis to move at step 7h with these units on the map and the dice at `seed`. */
function at7h(units: Unit[], seed = 1, extra: Partial<GameState> = {}): GameState {
  return { ...atStartOffensive(SCENARIO_1939, 1), activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7h" }, units: Object.fromEntries(units.map((u) => [u.id, u])), rngState: seed, ...extra };
}
const ok = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const attack = (s: GameState, units: string[], target: string) => applyAction(CTX, s, { type: "ATTACK", side: "axis", units, target });
const resolved = (events: GameEvent[]) => events.find((e): e is Extract<GameEvent, { type: "COMBAT_RESOLVED" }> => e.type === "COMBAT_RESOLVED")!;
/** A seed whose first die roll is `n` (the dice are the game's own generator). */
const seedRolling = (n: number) => {
  for (let seed = 1; seed < 10000; seed++) if (rollD6(seed).roll === n) return seed;
  throw new Error("no seed");
};
const attacksOf = (s: GameState) => legalActions(CTX, s).filter((a) => a.type === "ATTACK");

describe("which attacks are legal", () => {
  it("lists an attack on an adjacent enemy hex, with everyone who can reach it", () => {
    const s = at7h([GER("g1", "M32"), GER("g2", "N32", 2), POL("p1", "M33"), POL("far", "A5")]);
    expect(attacksOf(s)).toEqual([
      { type: "ATTACK", side: "axis", units: ["g1", "g2"], target: "M33" },
      { type: "ATTACK", side: "axis", units: ["g1"], target: "M33" },
      { type: "ATTACK", side: "axis", units: ["g2"], target: "M33" },
    ]);
    expect(legalActions(CTX, s).at(-1)).toEqual({ type: "END_STEP", side: "axis", step: "7h" });
  });

  it("offers nothing against a hex that is not next to the attacker, or holds only a neutral or friendly unit", () => {
    const s = at7h([GER("g1", "M32"), POL("p1", "M35"), unit("it", "italy", "infantry", 3, "M33")]);
    expect(attacksOf(s)).toEqual([]);
    expect(isEnemy(s, "germany", "italy")).toBe(false); // Italy is neutral in 1939
    expect(isEnemy(s, "germany", "poland")).toBe(true);
    expect(isEnemy(s, "germany", "germany")).toBe(false);
  });

  it("does not let ground units attack over a coast or into Qattara", () => {
    const sea = at7h([GER("g1", "J36"), POL("p1", "J35")]);
    expect(attacksOf(sea)).toEqual([]);
    expect(attack(sea, ["g1"], "J35")).toMatchObject({ ok: false });
    expect(MAP.hexes.MM27?.land).not.toBeNull();
    expect(MAP.hexes.NN26?.land).not.toBeNull();
    const dep = at7h([unit("b1", "britain", "infantry", 3, "NN26"), unit("i1", "germany", "infantry", 3, "MM27")]);
    expect(attacksOf({ ...dep, activeSide: "allies" })).toEqual([]);
  });

  it("lets ground units attack across a crossing arrow", () => {
    const s = at7h([GER("g1", "I30"), POL("p1", "I31")]);
    expect(attacksOf(s)).toHaveLength(1);
  });

  it("only attacks with ground units: air units and fleets do not attack on the ground", () => {
    const s = at7h([unit("a1", "germany", "air", 4, "M32"), POL("p1", "M33")]);
    expect(attacksOf(s)).toEqual([]);
  });

  it("does not offer attacks to a side that is not at war with the units next to it", () => {
    const s = at7h([unit("b1", "britain", "infantry", 3, "M32"), POL("p1", "M33")], 1, { activeSide: "allies" });
    expect(attacksOf(s)).toEqual([]); // Britain and Poland are allies
  });
});

describe("the step waits only when there is an attack to make", () => {
  const from7a = (units: Unit[]) => settle(CTX, { ...at7h(units), position: { part: "player-turn", turn: 1, step: "7a" } });
  it("stops at 7h with an enemy next to a ground unit", () => {
    const r = from7a([GER("g1", "M32"), POL("p1", "M33")]);
    expect(r.state.position).toEqual({ part: "player-turn", turn: 1, step: "7h" });
  });
  it("passes it when no attack is possible", () => {
    const r = from7a([GER("g1", "M32"), POL("p1", "M35")]);
    expect(r.state.position).not.toEqual({ part: "player-turn", turn: 1, step: "7h" });
    expect(r.events.flatMap((e) => (e.type === "STEPS_PASSED" ? e.steps : []))).toContain("7h");
  });
});

describe("the odds (Ref 12.1, 4.5)", () => {
  const numbers = (units: Unit[], attackers: string[], target: string, extra: Partial<GameState> = {}) => {
    const s = at7h(units, 1, extra);
    const att = attackers.map((id) => s.units[id]!);
    return attackNumbers(CTX, s, att, defendersAt(s, att, target), target);
  };
  it("doubles the defence on plain", () => {
    expect(numbers([GER("g1", "M32", 4), POL("p1", "M33", 2)], ["g1"], "M33")).toMatchObject({ attackFactors: 4, defenseFactors: 2, multiplier: 2, column: "1-1" });
  });
  it("triples it in mountains", () => {
    expect(numbers([GER("g1", "Q33", 6), POL("p1", "Q34", 2)], ["g1"], "Q34")).toMatchObject({ multiplier: 3, column: "1-1" });
  });
  it("triples it behind a river when every attacker is across it, and not when one attacks from the defender's side of it", () => {
    expect(numbers([GER("g1", "K35", 6), POL("p1", "K34", 2)], ["g1"], "K34")).toMatchObject({ multiplier: 3 });
    // L33 touches K34 over no river: that attacker cancels the benefit.
    expect(numbers([GER("g1", "K35", 3), GER("g2", "L33", 3), POL("p1", "K34", 2)], ["g1", "g2"], "K34")).toMatchObject({ multiplier: 2 });
  });
  it("triples it behind a crossing arrow", () => {
    expect(numbers([GER("g1", "I30", 6), POL("p1", "I31", 2)], ["g1"], "I31")).toMatchObject({ multiplier: 3 });
  });
  it("quadruples it in a fortress, and the best one applies without adding (a fortress on a mountain is x4, not x12)", () => {
    expect(numbers([GER("g1", "M32", 8), POL("p1", "M33", 2)], ["g1"], "M33", { fortresses: { M33: true } })).toMatchObject({ multiplier: 4, column: "1-1" });
    expect(numbers([GER("g1", "Q33", 8), POL("p1", "Q34", 2)], ["g1"], "Q34", { fortresses: { Q34: true } })).toMatchObject({ multiplier: 4 });
  });
  it("adds up every attacker and every defender", () => {
    expect(numbers([GER("g1", "M32", 3), GER("g2", "M32", 2), GER("g3", "N32", 2), POL("p1", "M33", 1), POL("p2", "M33", 3)], ["g1", "g2", "g3"], "M33")).toMatchObject({ attackFactors: 7, defenseFactors: 4, multiplier: 2, column: "1-2" });
  });
});

describe("resolving an attack with the seeded dice", () => {
  it("rolls the CRT at the odds shown and records every roll in the event", () => {
    const s = at7h([GER("g1", "M32", 6), POL("p1", "M33", 1)], seedRolling(6)); // 6 vs 1x2: 3-1, a 6 is D
    const r = ok(attack(s, ["g1"], "M33"));
    const e = resolved(r.events);
    expect(e).toMatchObject({ attackFactors: 6, defenseFactors: 1, multiplier: 2, outcome: "defender-eliminated", target: "M33", attackers: ["g1"] });
    expect(e.rounds).toEqual([{ by: "attacker", column: "3-1", roll: 6, result: "D" }]);
    expect(r.state.rngState).toBe(rollD6(s.rngState).state);
  });

  it("D: the defenders are eliminated, the attackers stay, and they may advance", () => {
    const s = at7h([GER("g1", "M32", 6), POL("p1", "M33", 1), POL("p2", "M33", 1)], seedRolling(6));
    const r = ok(attack(s, ["g1"], "M33"));
    expect(Object.keys(r.state.units)).toEqual(["g1"]);
    expect(r.events.filter((e) => e.type === "UNIT_ELIMINATED")).toEqual([
      { type: "UNIT_ELIMINATED", unitId: "p1", owner: "poland", at: "M33" },
      { type: "UNIT_ELIMINATED", unitId: "p2", owner: "poland", at: "M33" },
    ]);
    expect(legalActions(CTX, r.state)).toContainEqual({ type: "ADVANCE", side: "axis", units: ["g1"], to: "M33" });
  });

  it("A: the attackers are eliminated and the defenders stay", () => {
    const s = at7h([GER("g1", "M32", 1), POL("p1", "M33", 1)], seedRolling(5)); // 1 vs 1x2: 1-2, a 5 is A
    const r = ok(attack(s, ["g1"], "M33"));
    expect(resolved(r.events).rounds[0]).toMatchObject({ column: "1-2", roll: 5, result: "A" });
    expect(Object.keys(r.state.units)).toEqual(["p1"]);
    expect(combatOf(r.state).advances).toEqual([]);
  });

  it("is lost automatically, with no die, below 1 to 4", () => {
    const s = at7h([GER("g1", "M32", 1), POL("p1", "M33", 5)], 77);
    const r = ok(attack(s, ["g1"], "M33"));
    expect(resolved(r.events).rounds).toEqual([{ by: "attacker", column: null, roll: null, result: "auto-eliminated" }]);
    expect(r.state.rngState).toBe(77);
    expect(r.state.units.g1).toBeUndefined();
  });

  it("matches resolveOffensiveCombat, counterattack chains included, for the same dice", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = at7h([GER("g1", "M32", 3), GER("g2", "M32", 2), POL("p1", "M33", 2)], seed);
      const direct = resolveOffensiveCombat({ attackFactors: 5, defenseBasicFactors: 2, defenseMultiplier: 2 }, seed);
      const r = ok(attack(s, ["g1", "g2"], "M33"));
      expect(resolved(r.events).rounds).toEqual(direct.rounds);
      expect(r.state.rngState).toBe(direct.rngState);
    }
  });
});

describe("Exchange (Ref 12.2)", () => {
  // 1-1 column: a 1 or a 4 is an Exchange.
  const ex = seedRolling(1);
  it("the larger side must remove at least the smaller side's factors, chosen by its owner", () => {
    // Attackers 3+2 (M32) and 2 (N32) = 7 against 1+1 at x2 = 4: the defenders go, the attackers lose 4 or more.
    const s = at7h([GER("g1", "M32", 3), GER("g2", "M32", 2), GER("g3", "N32", 2), POL("p1", "M33"), POL("p2", "M33")], ex);
    const r = ok(attack(s, ["g1", "g2", "g3"], "M33"));
    expect(resolved(r.events).outcome).toBe("exchange");
    expect(r.state.units.p1).toBeUndefined();
    expect(r.state.units.p2).toBeUndefined();
    expect(combatOf(r.state).pending).toMatchObject({ chooser: "axis", required: 4 });
    // Only the choice is legal until it is made: not another attack, not moving on.
    expect(legalActions(CTX, r.state)).toEqual([
      { type: "ALLOCATE_LOSSES", side: "axis", units: ["g1", "g2"] },
      { type: "ALLOCATE_LOSSES", side: "axis", units: ["g1", "g3"] },
      { type: "ALLOCATE_LOSSES", side: "axis", units: ["g2", "g3"] },
    ]);
    expect(applyAction(CTX, r.state, { type: "END_STEP", side: "axis", step: "7h" })).toMatchObject({ ok: false });
    const done = ok(applyAction(CTX, r.state, { type: "ALLOCATE_LOSSES", side: "axis", units: ["g2", "g3"] }));
    expect(Object.keys(done.state.units)).toEqual(["g1"]);
    expect(combatOf(done.state).pending).toBeNull();
    expect(legalActions(CTX, done.state)).toContainEqual({ type: "ADVANCE", side: "axis", units: ["g1"], to: "M33" });
  });

  it("refuses losses that are too few, more than needed, from the wrong side, or not in the stack", () => {
    const s = at7h([GER("g1", "M32", 3), GER("g2", "M32", 2), GER("g3", "N32", 2), POL("p1", "M33"), POL("p2", "M33")], ex);
    const p = ok(attack(s, ["g1", "g2", "g3"], "M33")).state;
    const lose = (side: "axis" | "allies", units: string[]) => applyAction(CTX, p, { type: "ALLOCATE_LOSSES", side, units });
    expect(lose("axis", ["g1"])).toMatchObject({ ok: false, error: expect.stringMatching(/at least 4/) });
    expect(lose("axis", ["g1", "g2", "g3"])).toMatchObject({ ok: false, error: expect.stringMatching(/spared/) });
    expect(lose("allies", ["g1", "g2"])).toMatchObject({ ok: false, error: expect.stringMatching(/axis/) });
    expect(lose("axis", ["p1", "g1"])).toMatchObject({ ok: false });
    expect(lose("axis", ["g1", "g1"])).toMatchObject({ ok: false });
    expect(applyAction(CTX, s, { type: "ALLOCATE_LOSSES", side: "axis", units: ["g1"] })).toMatchObject({ ok: false });
  });

  it("lists only the sets in which no unit could be spared", () => {
    // 1+4 (M32) and 4 (N32) against 2 at x2 = 4: a 4-factor unit alone is enough, so 1+4 is never offered.
    const s = at7h([GER("g1", "M32", 1), GER("g2", "M32", 4), GER("g3", "N32", 4), POL("p1", "M33", 2)], ex);
    const r = ok(attack(s, ["g1", "g2", "g3"], "M33"));
    expect(legalActions(CTX, r.state)).toEqual([
      { type: "ALLOCATE_LOSSES", side: "axis", units: ["g2"] },
      { type: "ALLOCATE_LOSSES", side: "axis", units: ["g3"] },
    ]);
  });

  it("with only one sufficient set, the losses are taken at once", () => {
    // 3+3 against 1+1 at x2 = 4: both attackers are needed, there is nothing to choose.
    const s = at7h([GER("g1", "M32", 3), GER("g2", "M32", 3), POL("p1", "M33"), POL("p2", "M33")], ex);
    const r = ok(attack(s, ["g1", "g2"], "M33"));
    expect(Object.keys(r.state.units)).toEqual([]);
    expect(combatOf(r.state).pending).toBeNull();
  });

  it("when the defenders are the larger side, their owner chooses what they lose and the attackers all go", () => {
    // 2+2 attack (4) against 2+2 at x2 (8) on 1-2: a 1 is an Exchange. The defenders remove 4 of 8: either unit.
    const s = at7h([GER("g1", "M32", 2), GER("g2", "M32", 2), POL("p1", "M33", 2), POL("p2", "M33", 2)], seedRolling(1));
    const r = ok(attack(s, ["g1", "g2"], "M33"));
    expect(resolved(r.events)).toMatchObject({ outcome: "exchange" });
    expect(Object.keys(r.state.units).sort()).toEqual(["p1", "p2"]);
    expect(combatOf(r.state).pending).toMatchObject({ chooser: "allies", required: 4 });
    expect(legalActions(CTX, r.state)).toEqual([
      { type: "ALLOCATE_LOSSES", side: "allies", units: ["p1"] },
      { type: "ALLOCATE_LOSSES", side: "allies", units: ["p2"] },
    ]);
    const done = ok(applyAction(CTX, r.state, { type: "ALLOCATE_LOSSES", side: "allies", units: ["p2"] }));
    expect(Object.keys(done.state.units)).toEqual(["p1"]);
    expect(legalActions(CTX, done.state).some((a) => a.type === "ADVANCE")).toBe(false); // the hex is still held
  });

  it("equal totals: both sides lose everything", () => {
    // 4 against 2x2 = 4 on 1-1.
    const s = at7h([GER("g1", "M32", 2), GER("g2", "M32", 2), POL("p1", "M33", 2)], ex);
    const r = ok(attack(s, ["g1", "g2"], "M33"));
    expect(resolved(r.events).outcome).toBe("exchange");
    expect(r.state.units).toEqual({});
  });

  it("on a counterattack's Exchange both sides count basic factors, with no terrain multiple", () => {
    let found = 0;
    for (let seed = 1; seed < 4000 && found < 3; seed++) {
      const direct = resolveOffensiveCombat({ attackFactors: 4, defenseBasicFactors: 2, defenseMultiplier: 2 }, seed);
      if (direct.outcome.kind !== "exchange" || direct.outcome.multipliedDefense) continue;
      found++;
      // 4 attack against 2 defend: compared as 4 against 2 (not 4 against 4), so the defenders go and the attackers lose at least 2.
      const s = at7h([GER("g1", "M32", 2), GER("g2", "M32", 2), POL("p1", "M33", 2)], seed);
      const r = ok(attack(s, ["g1", "g2"], "M33"));
      expect(r.state.units.p1).toBeUndefined();
      expect(combatOf(r.state).pending).toMatchObject({ chooser: "axis", required: 2 });
    }
    expect(found).toBe(3);
  });
});

describe("one attack per unit and per hex (PC README 14.23)", () => {
  const six = seedRolling(5); // an A at 1-2 so the defenders survive
  it("a hex cannot be attacked twice, and the units that attacked are used up", () => {
    const s = at7h([GER("g1", "M32", 4), GER("g2", "N32", 4), POL("p1", "M33", 3), POL("p2", "N33", 3)], six);
    const first = ok(attack(s, ["g1"], "M33")).state; // 4 vs 3x2: 1-2, a 5 is A
    expect(first.units.g1).toBeUndefined();
    // g2 touches M33 and N33; M33 was attacked, so only N33 is offered.
    expect(attacksOf(first).map((a) => (a).target)).toEqual(["N33"]);
    expect(attack(first, ["g2"], "M33")).toMatchObject({ ok: false, error: expect.stringMatching(/already been attacked/) });
    const second = ok(attack(first, ["g2"], "N33")).state;
    expect(combatOf(second).attacked).toEqual(["g1", "g2"]);
  });

  it("a surviving attacker cannot attack a second hex", () => {
    // N32 touches both M33 and N33. 6 vs 1x2 is 3-1 and a 6 is D: the attacker survives.
    const s = at7h([GER("g1", "N32", 6), POL("p1", "M33", 1), POL("p2", "N33", 1)], seedRolling(6));
    const r = ok(attack(s, ["g1"], "M33")).state;
    expect(r.units.g1).toBeDefined();
    expect(attacksOf(r)).toEqual([]);
    expect(attack(r, ["g1"], "N33")).toMatchObject({ ok: false, error: expect.stringMatching(/has not attacked this turn/) });
  });

  it("an attack names distinct, existing, own units", () => {
    const s = at7h([GER("g1", "M32"), POL("p1", "M33")]);
    expect(attack(s, [], "M33")).toMatchObject({ ok: false });
    expect(attack(s, ["g1", "g1"], "M33")).toMatchObject({ ok: false });
    expect(attack(s, ["nope"], "M33")).toMatchObject({ ok: false });
    expect(attack(s, ["p1"], "M33")).toMatchObject({ ok: false });
    expect(attack(s, ["g1"], "ZZ99")).toMatchObject({ ok: false });
    expect(attack(s, ["g1"], "L32")).toMatchObject({ ok: false, error: expect.stringMatching(/no enemy ground unit/) });
    expect(applyAction(CTX, s, { type: "ATTACK", side: "allies", units: ["g1"], target: "M33" })).toMatchObject({ ok: false });
  });
});

describe("advance after combat (TODO(verify): the rule text is not in the repo)", () => {
  const won = (extra: Unit[] = []) => ok(attack(at7h([GER("g1", "M32", 6), GER("g2", "N32", 6), POL("p1", "M33", 1), ...extra], seedRolling(6)), ["g1", "g2"], "M33")).state;
  it("lets the survivors move into the emptied hex once, within the stacking limit", () => {
    const s = won();
    const adv = legalActions(CTX, s).filter((a) => a.type === "ADVANCE");
    expect(adv).toHaveLength(3); // g1, g2 or both
    const r = ok(applyAction(CTX, s, { type: "ADVANCE", side: "axis", units: ["g1", "g2"], to: "M33" }));
    expect(r.state.units.g1!.at).toBe("M33");
    expect(r.state.units.g2!.at).toBe("M33");
    expect(r.events[0]).toEqual({ type: "UNITS_ADVANCED", units: ["g1", "g2"], from: ["M32", "N32"], to: "M33" });
    // Entering an enemy-controlled hex takes its control (Ref 7.0; control.ts), once.
    expect(r.events.slice(1)).toEqual([{ type: "HEX_CONTROL_CHANGED", hex: "M33", from: "poland", to: "germany", unitId: "g1" }]);
    expect(r.state.control.M33).toBe("germany");
    expect(legalActions(CTX, r.state).some((a) => a.type === "ADVANCE")).toBe(false);
    expect(applyAction(CTX, r.state, { type: "ADVANCE", side: "axis", units: ["g1"], to: "M33" })).toMatchObject({ ok: false });
  });
  it("refuses units that did not attack, a third ground unit, and the wrong side", () => {
    const s = won();
    const crowded = { ...s, units: { ...s.units, g9: GER("g9", "L32"), g8: GER("g8", "L32"), g7: GER("g7", "M33") } };
    expect(applyAction(CTX, crowded, { type: "ADVANCE", side: "axis", units: ["g1", "g2"], to: "M33" })).toMatchObject({ ok: false, error: expect.stringMatching(/limit 2/) });
    expect(applyAction(CTX, s, { type: "ADVANCE", side: "axis", units: ["g9"], to: "M33" })).toMatchObject({ ok: false });
    expect(applyAction(CTX, s, { type: "ADVANCE", side: "allies", units: ["g1"], to: "M33" })).toMatchObject({ ok: false });
    expect(applyAction(CTX, s, { type: "ADVANCE", side: "axis", units: [], to: "M33" })).toMatchObject({ ok: false });
    expect(applyAction(CTX, s, { type: "ADVANCE", side: "axis", units: ["g1"], to: "L33" })).toMatchObject({ ok: false });
  });
  it("is not offered when the defenders' hex still holds a unit", () => {
    // A unit of a power not at war with Germany does not defend and is not swept away, so the hex is not empty.
    const s = won([unit("p9", "ussr", "infantry", 2, "M33")]);
    expect(legalActions(CTX, s).some((a) => a.type === "ADVANCE")).toBe(false);
  });
});

describe("ordering, replay and the turn", () => {
  it("is refused outside step 7h, naming the step", () => {
    const s = at7h([GER("g1", "M32"), POL("p1", "M33")], 1, { position: { part: "player-turn", turn: 1, step: "8b" } });
    const r = attack(s, ["g1"], "M33");
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Ground attacks are made in step 7h.*step 8b/) });
    expect(applyAction(CTX, s, { type: "ALLOCATE_LOSSES", side: "axis", units: [] })).toMatchObject({ ok: false });
    expect(applyAction(CTX, s, { type: "ADVANCE", side: "axis", units: ["g1"], to: "M33" })).toMatchObject({ ok: false });
  });

  it("the same actions from the same seed give the same game, and another seed can differ", () => {
    const start = at7h([GER("g1", "M32", 3), GER("g2", "M32", 2), GER("g3", "N32", 2), POL("p1", "M33", 2), POL("p2", "M33", 1)], 12345);
    const play = (init: GameState) => {
      let s = init;
      const actions: Action[] = [];
      for (let i = 0; i < 6; i++) {
        const next = legalActions(CTX, s)[0]!;
        actions.push(next);
        s = ok(applyAction(CTX, s, next)).state;
        if (s.position?.part === "player-turn" && s.position.step !== "7h") break;
      }
      return { actions, s };
    };
    const a = play(start);
    expect(a.actions[0]!.type).toBe("ATTACK");
    const again = replay(CTX, start, a.actions);
    expect(again.state).toEqual(a.s);
    expect(replay(CTX, start, a.actions).events).toEqual(again.events);
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) outcomes.add(JSON.stringify(play({ ...start, rngState: seed }).s.units));
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it("the record belongs to its Player Turn: a new turn starts with nobody having attacked", () => {
    const s = ok(attack(at7h([GER("g1", "M32", 3), POL("p1", "M33", 1)], seedRolling(5)), ["g1"], "M33")).state;
    expect(combatOf(s).targets).toEqual(["M33"]);
    expect(combatOf({ ...s, activeSide: "allies" }).targets).toEqual([]);
    expect(combatOf({ ...s, year: 1940 }).targets).toEqual([]);
  });
});
