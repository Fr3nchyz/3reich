import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { ATTACK_MAX_PER_TURN } from "../src/ai/assault";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { combatOf, turnKey } from "../src/engine/combat-record";
import type { ForceOwner, GameState, Unit, UnitType } from "../src/engine/types";
import { CTX, atStart } from "./helpers";
import { SCENARIO_1939 } from "../src/data/scenario-1939";

// The computer's attacks at step 7h are POLICY (spec 05, docs/RULES.md "Computer opponent policy"), not rules.
// M32 is German plain next to M33 (Poznan, Polish city on plain); M34-M35 Warsaw; Q33-Q34 a mountain defence (defence doubled).

const u = (id: string, owner: ForceOwner, strength: number, at: string, type: UnitType = "infantry"): Unit => ({ id, owner, type, strength, at });
const at7h = (units: Unit[], seed = 1): GameState => ({
  ...atStart(SCENARIO_1939, 1), activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7h" },
  units: Object.fromEntries(units.map((x) => [x.id, x])), rngState: seed,
});
const decide = (s: GameState) => chooseAction(CTX, s, { seed: 1 })!;
const END = { type: "END_STEP", side: "axis", step: "7h" };
const ok = (r: ReturnType<typeof applyAction>) => { if (!r.ok) throw new Error(r.error); return r.state; };

describe("step 7h: which attacks the computer makes (Ref 12.1)", () => {
  it("attacks at 10-1 on plain (every defender counts double, Ref 4.5): odds 5-1, and the attack is on the legal list", () => {
    const s = at7h([u("g1", "germany", 10, "M32"), u("p1", "poland", 1, "M33")]);
    const d = decide(s);
    expect(legalActions(CTX, s)).toContainEqual(d.action);
    expect(d.action).toEqual({ type: "ATTACK", side: "axis", units: ["g1"], target: "M33" });
    expect(d.why).toMatch(/odds 5-1/);
  });

  it("needs odds of 2-1 after the doubling: 6 against 2x2 is 1-1 and is not attacked", () => {
    const s = at7h([u("g1", "germany", 6, "M32"), u("p1", "poland", 2, "M33")]);
    expect(legalActions(CTX, s).some((a) => a.type === "ATTACK")).toBe(true);
    expect(decide(s).action).toEqual(END);
  });

  it("also needs an acceptable Exchange: 25 against 5x2 is 2-1 but could cost 10 factors; 25 against 4x2 could cost 8", () => {
    expect(decide(at7h([u("g1", "germany", 25, "M32"), u("p1", "poland", 5, "M33")])).action).toEqual(END);
    expect(decide(at7h([u("g1", "germany", 25, "M32"), u("p1", "poland", 4, "M33")])).action.type).toBe("ATTACK");
  });

  it("counts the defender's terrain: 9 against 2 on a mountain (x3) is 1-1 and is not attacked; 16 is", () => {
    const s = at7h([u("g1", "germany", 9, "Q33"), u("p1", "poland", 2, "Q34")]);
    expect(legalActions(CTX, s).some((a) => a.type === "ATTACK")).toBe(true);
    expect(decide(s).action).toEqual(END);
    expect(decide(at7h([u("g1", "germany", 16, "Q33"), u("p1", "poland", 2, "Q34")])).action.type).toBe("ATTACK");
  });

  it("prefers a capital or objective to another attack of the same odds, and better odds to both", () => {
    // M32 and M34 both touch Poznan (M33); M34 alone touches Warsaw (M35). Both best attacks are 2-1 (Warsaw is behind a river, x3).
    const base = [u("g1", "germany", 3, "M32"), u("g2", "germany", 8, "M34"), u("p1", "poland", 2, "M33"), u("p2", "poland", 1, "M35")];
    expect((decide(at7h(base)).action as Extract<Action, { type: "ATTACK" }>).target).toBe("M35");
    // Make Warsaw dearer (1-1 odds, below the threshold): Poznan is attacked.
    const dearer = base.map((x) => (x.id === "p2" ? { ...x, strength: 2 } : x));
    expect((decide(at7h(dearer)).action as Extract<Action, { type: "ATTACK" }>).target).toBe("M33");
    // Better odds beat the objective: with 12 more factors on Poznan (5-1) it is attacked although Warsaw (2-1) is an objective.
    const stronger = base.map((x) => (x.id === "g1" ? { ...x, strength: 15 } : x));
    expect((decide(at7h(stronger)).action as Extract<Action, { type: "ATTACK" }>).target).toBe("M33");
  });

  it("ends the step when its attack cap is reached", () => {
    const s = at7h([u("g1", "germany", 10, "M32"), u("p1", "poland", 1, "M33")]);
    const done: GameState = { ...s, combat: { turn: turnKey(s), attacked: [], targets: Array.from({ length: ATTACK_MAX_PER_TURN }, (_, i) => `Z${i}`), pending: null, advances: [] } };
    expect(decide(done).action).toEqual(END);
  });
});

describe("step 7h: after the battle", () => {
  /** A battle at 5-1 that the defender loses outright, so the hex is left empty. */
  const won = (() => {
    for (let seed = 1; seed < 500; seed++) {
      const s = ok(applyAction(CTX, at7h([u("g1", "germany", 5, "M32"), u("g2", "germany", 5, "M32"), u("p1", "poland", 1, "M33")], seed), { type: "ATTACK", side: "axis", units: ["g1", "g2"], target: "M33" }));
      if (combatOf(s).advances.length > 0) return s;
    }
    throw new Error("no seed");
  })();

  it("advances with as many survivors as the hex takes", () => {
    const d = decide(won);
    expect(d.action).toEqual({ type: "ADVANCE", side: "axis", units: ["g1", "g2"], to: "M33" });
    expect(legalActions(CTX, won)).toContainEqual(d.action);
    const after = ok(applyAction(CTX, won, d.action));
    expect(after.units.g1!.at).toBe("M33");
    // ...and the step then ends (nothing more to attack): the computer never loops.
    expect(decide(after).action).toEqual(END);
  });

  it("settles an Exchange before anything else: the first legal set of losses", () => {
    for (let seed = 1; seed < 500; seed++) {
      const s = ok(applyAction(CTX, at7h([u("g1", "germany", 4, "M32"), u("g2", "germany", 4, "M32"), u("p1", "poland", 2, "M33"), u("p2", "poland", 2, "M33")], seed), { type: "ATTACK", side: "axis", units: ["g1", "g2"], target: "M33" }));
      if (combatOf(s).pending) {
        expect(decide(s).action).toEqual(legalActions(CTX, s)[0]);
        return;
      }
    }
    throw new Error("no seed rolled an Exchange");
  });
});
