import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyOutcome } from "../src/engine/attack-losses";
import { combatOf } from "../src/engine/combat-record";
import { resolveOffensiveCombat, type CombatOutcome } from "../src/engine/combat";
import type { GameState, Unit } from "../src/engine/types";
import { CTX, atStart } from "./helpers";

/**
 * TODO-VERIFY G9, ruling Q12 (Ref 12.2): an Exchange takes the defenders' terrain-multiplied value in the original attack, and basic factors
 * when it comes from a counterattack. The battle's multiplier (x2 on plain here) is the same in both; only `multipliedDefense` differs.
 * M32 attacks M33, plain country on the real map.
 */

const unit = (id: string, owner: Unit["owner"], strength: number, at: string): Unit => ({ id, owner, type: "infantry", strength, at });
const GER = (id: string, strength: number) => unit(id, "germany", strength, "M32");
const POL = (id: string, strength: number) => unit(id, "poland", strength, "M33");

function exchange(units: Unit[], attackers: string[], defenders: string[], outcome: boolean | CombatOutcome) {
  const s: GameState = { ...atStart(SCENARIO_1939, 1), activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7h" }, units: Object.fromEntries(units.map((u) => [u.id, u])), rngState: 1 };
  const marked = { ...s, combat: { ...combatOf(s), attacked: attackers, targets: ["M33"] } };
  const pick = (ids: string[]) => ids.map((id) => s.units[id]!);
  return applyOutcome(CTX, marked, { outcome: typeof outcome === "boolean" ? { kind: "exchange", multipliedDefense: outcome } : outcome, side: "axis", target: "M33", attackers: pick(attackers), defenders: pick(defenders), multiplier: 2 });
}

describe("an Exchange from a counterattack uses basic factors (Ref 12.2, ruling Q12)", () => {
  const units = [GER("g1", 2), GER("g2", 2), POL("p1", 2)];

  it("carries a rolled counterattack Exchange through to basic-factor losses (Ref 12.2, Q12)", () => {
    const resolved = resolveOffensiveCombat({ attackFactors: 4, defenseBasicFactors: 2, defenseMultiplier: 2 }, 12);
    expect(resolved.rounds).toEqual([
      { by: "attacker", column: "1-1", roll: 2, result: "CA" },
      { by: "defender", column: "1-2", roll: 1, result: "Ex" },
    ]);
    expect(resolved.outcome).toEqual({ kind: "exchange", multipliedDefense: false });
    const r = exchange(units, ["g1", "g2"], ["p1"], resolved.outcome);
    expect(r.state.units.p1).toBeUndefined();
    expect(r.state.units.g1).toBeDefined();
    expect(r.state.units.g2).toBeDefined();
    expect(combatOf(r.state).pending).toMatchObject({ chooser: "axis", required: 2, values: { g1: 2, g2: 2 } });
  });

  it("original attack: 4 against 2 at x2 is 4 against 4, so both sides lose everything", () => {
    const r = exchange(units, ["g1", "g2"], ["p1"], true);
    expect(r.state.units.g1).toBeUndefined();
    expect(r.state.units.g2).toBeUndefined();
    expect(r.state.units.p1).toBeUndefined();
    expect(combatOf(r.state).pending).toBeNull();
  });

  it("counterattack: the same 2 defenders count 2, not 4, so only they go and the attackers choose at least 2 factors", () => {
    const r = exchange(units, ["g1", "g2"], ["p1"], false);
    expect(r.state.units.p1).toBeUndefined();
    expect(combatOf(r.state).pending).toMatchObject({ chooser: "axis", required: 2, values: { g1: 2, g2: 2 } });
    expect(r.state.units.g1).toBeDefined();
    expect(r.state.units.g2).toBeDefined();
  });

  it("counterattack, defenders the larger side: they remove basic factors, each unit at its printed strength", () => {
    const big = [GER("g1", 1), GER("g2", 1), POL("p1", 2), POL("p2", 2)];
    const r = exchange(big, ["g1", "g2"], ["p1", "p2"], false);
    expect(r.state.units.g1).toBeUndefined();
    expect(r.state.units.g2).toBeUndefined();
    expect(combatOf(r.state).pending).toMatchObject({ chooser: "allies", required: 2, values: { p1: 2, p2: 2 } });
  });

  it("original attack, defenders the larger side: they remove at the multiplied value, each unit counting x2", () => {
    const big = [GER("g1", 1), GER("g2", 1), POL("p1", 2), POL("p2", 2)];
    const r = exchange(big, ["g1", "g2"], ["p1", "p2"], true);
    expect(combatOf(r.state).pending).toMatchObject({ chooser: "allies", required: 2, values: { p1: 4, p2: 4 } });
  });
});
