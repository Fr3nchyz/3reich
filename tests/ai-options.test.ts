import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { plannedReserve } from "../src/ai/declare";
import { OFFENSIVE_MAX_FRONTS, OFFENSIVE_MIN_FACTORS, OPTION_REACH, factorsInReach } from "../src/ai/options";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { winterInForce } from "../src/engine/winter-record";
import { applyAction } from "../src/engine/actions";
import { BRP_COSTS } from "../src/engine/tables";
import type { GameState, Unit } from "../src/engine/types";
import { CTX, atStart } from "./helpers";
import { WINTER } from "./helpers-winter";

// Spec 16 Part E, ticket 16-1: the computer chooses the Front Options at step 3 by the policy constants in src/ai/options.ts.
const cfg = { seed: 1 };
const ok = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
/** The Axis turn of Fall 1939 at step 3, with only the units given on the board; Germany has plenty to pay, and nobody keeps a reserve for a declaration. */
const board = (units: Unit[], patch: Partial<GameState> = {}): GameState => {
  const s = ok(applyAction(CTX, atStart(SCENARIO_1939, 1), { type: "END_STEP", side: "axis", step: "1" }));
  const nations = { ...s.nations, germany: { ...s.nations.germany, brpTotal: 100, spent: 0, spendLimit: 100 }, italy: { ...s.nations.italy, brpTotal: 0 } };
  return { ...s, nations, units: Object.fromEntries(units.map((u) => [u.id, u])), ...patch };
};
const unit = (id: string, owner: Unit["owner"], at: string, strength: number, type: Unit["type"] = "infantry"): Unit => ({ id, owner, type, strength, movement: 3, at });
/** Plays step 3 until the computer ends it; the Options it chose, per Front. */
function play(s0: GameState): Record<string, string> {
  let s = s0;
  for (let i = 0; i < 10; i++) {
    const d = chooseAction(CTX, s, cfg)!;
    if (d.action.type !== "SELECT_FRONT_OPTION") break;
    s = ok(applyAction(CTX, s, d.action));
  }
  return Object.fromEntries(Object.entries(s.frontOptions).map(([f, c]) => [f, c.option]));
}
const E = (n: number) => `E${n}`;

describe("the computer's Front Options (spec 16 E, 16-1)", () => {
  it("takes Offensive with enough ground factors within reach of the enemy, Attrition with fewer, Defensive with none", () => {
    expect(OFFENSIVE_MIN_FACTORS).toBeGreaterThan(1);
    // Eastern: OFFENSIVE_MIN_FACTORS factors in reach of Poland; Western: one weak unit in reach of France; Mediterranean: nobody.
    const s = board([
      unit("g1", "germany", E(40), OFFENSIVE_MIN_FACTORS), unit("p1", "poland", E(41), 2),
      unit("g2", "germany", "K25", 1), unit("f1", "france", "K26", 2),
    ]);
    expect(play(s)).toEqual({ eastern: "offensive", western: "attrition", mediterranean: "defensive" });
  });

  it("pays for the Offensive Option from a Major Power that can afford it", () => {
    const s = board([unit("g1", "germany", E(40), OFFENSIVE_MIN_FACTORS), unit("p1", "poland", E(41), 2)], { year: 1940 });
    let t = s;
    for (let i = 0; i < 6; i++) {
      const d = chooseAction(CTX, t, cfg)!;
      if (d.action.type !== "SELECT_FRONT_OPTION") break;
      t = ok(applyAction(CTX, t, d.action));
    }
    expect(t.frontOptions.eastern).toEqual({ option: "offensive", paidBy: "germany" });
    expect(t.nations.germany.brpTotal).toBe(100 - BRP_COSTS.offensiveOption);
  });

  it("does not take Offensive when no Major Power can pay, and falls back to Attrition", () => {
    const s = board([unit("g1", "germany", E(40), OFFENSIVE_MIN_FACTORS), unit("p1", "poland", E(41), 2)], { year: 1940 });
    const poor = { ...s, nations: { ...s.nations, germany: { ...s.nations.germany, brpTotal: BRP_COSTS.offensiveOption - 1 } } };
    expect(play(poor).eastern).toBe("attrition");
  });

  it("pays for at most OFFENSIVE_MAX_FRONTS Offensive Options a turn", () => {
    const strong = (i: number, at: string, foe: string, owner: Unit["owner"]) => [unit(`g${i}`, "germany", at, OFFENSIVE_MIN_FACTORS + i), unit(`e${i}`, owner, foe, 2)];
    const s = board([...strong(0, E(40), E(41), "poland"), ...strong(1, "K25", "K26", "france"), ...strong(2, "EE20", "EE21", "britain")], { year: 1940 });
    const rich = { ...s, nations: { ...s.nations, germany: { ...s.nations.germany, brpTotal: 400, spendLimit: 400 } } };
    const options = Object.values(play(rich));
    expect(options.filter((o) => o === "offensive")).toHaveLength(OFFENSIVE_MAX_FRONTS);
    expect(options.filter((o) => o === "attrition")).toHaveLength(3 - OFFENSIVE_MAX_FRONTS);
    // The Fronts with the most factors in reach take the paid Options; the weakest (the Eastern one) is left with Attrition.
    expect(play(rich).eastern).toBe("attrition");
  });

  it("leaves a Major Power its plannedReserve for a declaration of war: it pays only if the BRPs after the cost still cover it", () => {
    const s = board([unit("g1", "germany", E(40), OFFENSIVE_MIN_FACTORS), unit("p1", "poland", E(41), 2)], { year: 1940 });
    const reserve = plannedReserve(s, "germany");
    expect(reserve).toBeGreaterThan(0);
    const withTotal = (brpTotal: number): GameState => ({ ...s, nations: { ...s.nations, germany: { ...s.nations.germany, brpTotal } } });
    expect(play(withTotal(BRP_COSTS.offensiveOption + reserve - 1)).eastern).toBe("attrition");
    expect(play(withTotal(BRP_COSTS.offensiveOption + reserve)).eastern).toBe("offensive");
  });

  it("counts only enemies: a Russian unit next to a German one while the two are not at war does not draw an Option", () => {
    const s = board([unit("g1", "germany", E(40), 9), unit("r1", "ussr", E(41), 2)]);
    expect(s.wars.some(([a, b]) => [a, b].includes("ussr") && [a, b].includes("germany"))).toBe(false);
    expect(factorsInReach(CTX, s).eastern).toEqual({ factors: 0, units: 0 });
    expect(play(s).eastern).toBe("defensive");
  });

  it("counts only units within OPTION_REACH hexes of an enemy, and not Replacements", () => {
    const far = board([unit("g1", "germany", E(40), 9), unit("p1", "poland", E(40 + OPTION_REACH + 1), 2)]);
    expect(factorsInReach(CTX, far).eastern).toEqual({ factors: 0, units: 0 });
    const near = board([unit("g1", "germany", E(40), 9), unit("p1", "poland", E(40 + OPTION_REACH), 2), unit("g2", "germany", E(40), 5, "replacement")]);
    expect(factorsInReach(CTX, near).eastern).toEqual({ factors: 9, units: 1 });
  });

  it("chooses only Options the engine lists: no Offensive in the East under the Russian winter", () => {
    const base = board([unit("g1", "germany", E(60), 20), unit("r1", "ussr", E(61), 2)], { year: 1941, season: "winter" });
    const s: GameState = { ...base, wars: [...base.wars, ["germany", "ussr"]] };
    const winter: GameState = { ...s, winter: WINTER };
    expect(winterInForce(winter)).toBe(true);
    expect(play(s).eastern).toBe("offensive");
    expect(play(winter).eastern).toBe("attrition");
  });

  it("never loops: step 3 is ended once every Front has an Option", () => {
    const s = board([unit("g1", "germany", E(40), 9), unit("p1", "poland", E(41), 2)]);
    let t = s;
    for (let i = 0; i < 3; i++) t = ok(applyAction(CTX, t, chooseAction(CTX, t, cfg)!.action));
    expect(chooseAction(CTX, t, cfg)!.action).toEqual({ type: "END_STEP", side: "axis", step: "3" });
  });
});
