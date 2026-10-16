import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { ATTACK_DOOMED_IGNORE_EXCHANGE, chooseLosses, cutOffNow, exchangeFree, isDoomed, LOSSES_CUT_OFF_FIRST } from "../src/ai/doomed";
import { MOVE_PREFER_SUPPLY, networkOf, preferSupplied, suppliedAfterMove, supplyRulesOn } from "../src/ai/lines";
import type { Action } from "../src/engine/actions";
import type { GameContext } from "../src/engine/context";
import { isUnitSupplied } from "../src/engine/supply";
import { SUPPLY_EFFECTS_ENABLED, supplyEffectsOn } from "../src/engine/supply-effects";
import type { GameState } from "../src/engine/types";
import { reachableHexes } from "../src/engine/movement";
import { enemyZocFor } from "../src/engine/zoc";
import { CTX } from "./helpers";
import { at6f, inf, move, okOf } from "./helpers-move";

// The computer's supply rules (spec 05, "As built: supply-aware movement"): computer policy, not rules. Positions on the real 1939 map:
// L31 Berlin, L32-L33 German plain, L34, M33, M34 Polish plain, M35 Warsaw (a minor capital: no source for the Axis), K35 German (East Prussia),
// so L35 touches German land; S30 is neutral Hungarian land, where a German unit has no line. O22 is Paris, a Major Power's capital.
const ON: GameContext = { ...CTX, supplyEffects: true };
const OFF: GameContext = { ...CTX, supplyEffects: false };
type Move = Extract<Action, { type: "MOVE" }>;
const dest = (a: Action) => (a as Move).path.at(-1);

describe("the switch", () => {
  it("the shipped setting is off; a game's context can turn the effects on or off for itself", () => {
    expect(SUPPLY_EFFECTS_ENABLED).toBe(false);
    expect(supplyEffectsOn(CTX)).toBe(SUPPLY_EFFECTS_ENABLED);
    expect(supplyEffectsOn(ON)).toBe(true);
    expect(supplyEffectsOn(OFF)).toBe(false);
  });
  it("the computer's supply rules act only with the effects on, and the caller can switch them off", () => {
    expect(supplyRulesOn(ON, { seed: 1 })).toBe(true);
    expect(supplyRulesOn(ON, { seed: 1, supplyRules: false })).toBe(false);
    expect(supplyRulesOn(OFF, { seed: 1 })).toBe(false);
  });
});

describe("suppliedAfterMove: whether a line reaches the hex once the move is made", () => {
  const s = at6f([inf("g1", "germany", "L32", 3, 3)]);
  const net = networkOf(ON, s, "axis");
  const after = (to: string) => suppliedAfterMove(ON, s, net, [s.units.g1!], to);
  it("a hex next to the side's supplied land is supplied once entered; a Polish hex surrounded by Polish land is not", () => {
    expect(after("M33")).toBe(true); // next to German L32/M32
    expect(after("L35")).toBe(true); // next to German K35
    expect(after("M34")).toBe(false); // its neighbours stay Polish: control changes only where a move ends
    expect(after("M35")).toBe(false); // Warsaw: a minor's capital supplies only while that minor fights on the side
  });
  it("agrees with the engine once the move is made", () => {
    const paths = reachableHexes(ON, s, [s.units.g1!], enemyZocFor(ON, s, "axis"));
    for (const to of ["M33", "M34", "L35", "L34"]) {
      const r = okOf(move(s, ["g1"], paths.get(to)!, ON));
      expect(isUnitSupplied(ON, r.state, "g1"), to).toBe(after(to));
    }
  });
  it("a Major Power's capital supplies whoever takes it: a German unit cut off next to Paris is supplied once it stands in Paris", () => {
    const p = at6f([inf("g1", "germany", "O23", 3, 3)], "axis", undefined, { control: { O23: "germany" } });
    expect(isUnitSupplied(ON, p, "g1")).toBe(false);
    expect(suppliedAfterMove(ON, p, networkOf(ON, p, "axis"), [p.units.g1!], "O22")).toBe(true);
    expect(isUnitSupplied(ON, okOf(move(p, ["g1"], ["O22"], ON)).state, "g1")).toBe(true);
  });
  it("counters whose supply is not checked (replacements) are never judged cut off", () => {
    const r = at6f([inf("r1", "germany", "L32", 1, 0, "replacement")]);
    expect(suppliedAfterMove(ON, r, networkOf(ON, r, "axis"), [r.units.r1!], "M34")).toBe(true);
  });
  it("the network is searched once per position, however many hexes are asked about", () => {
    expect(networkOf(ON, s, "axis")).toBe(net);
    expect(networkOf(ON, { ...s }, "axis")).not.toBe(net);
  });
});

describe("MOVE_PREFER_SUPPLY: of the moves that get closer, one that keeps the stack supplied", () => {
  const s = at6f([inf("g1", "germany", "L32", 3, 3)]);
  const c = (to: string) => ({ units: [s.units.g1!], to });
  it("is on", () => expect(MOVE_PREFER_SUPPLY).toBe(true));
  it("keeps only the supplied candidates when there are some", () => {
    expect(preferSupplied(ON, s, [c("M34"), c("L35"), c("M35")], { seed: 1 })).toEqual({ pool: [c("L35")], cutOff: false });
  });
  it("keeps them all, and says so, when none is supplied", () => {
    expect(preferSupplied(ON, s, [c("M34"), c("M35")], { seed: 1 })).toEqual({ pool: [c("M34"), c("M35")], cutOff: true });
  });
  it("changes nothing with the effects off or the rules switched off", () => {
    const all = [c("M34"), c("L35")];
    expect(preferSupplied(OFF, s, all, { seed: 1 }).pool).toBe(all);
    expect(preferSupplied(ON, s, all, { seed: 1, supplyRules: false }).pool).toBe(all);
  });
  it("step 6f: without the rule the unit runs to M34, cut off; with it, to L35, as close to Warsaw and supplied", () => {
    expect(dest(chooseAction(OFF, s, { seed: 1 })!.action)).toBe("M34");
    expect(dest(chooseAction(ON, s, { seed: 1, supplyRules: false })!.action)).toBe("M34");
    expect(dest(chooseAction(ON, s, { seed: 1 })!.action)).toBe("L35");
  });
  it("step 6f: it gives up Warsaw itself (cut off once taken) for a supplied hex one short of it", () => {
    const t = at6f([inf("g1", "germany", "L33", 3, 3)]);
    expect(dest(chooseAction(OFF, t, { seed: 1 })!.action)).toBe("M35");
    expect(dest(chooseAction(ON, t, { seed: 1 })!.action)).toBe("L35");
  });
});

describe("units lost anyway: cut off when the turn began and still cut off", () => {
  // g1 stands on neutral Hungarian land (no line), g2 next to Berlin.
  const s: GameState = { ...at6f([inf("g1", "germany", "S30", 3, 3), inf("g2", "germany", "L32", 3, 3)]), unsuppliedAtStart: ["g1"] };
  it("cutOffNow and isDoomed read the engine's supply", () => {
    expect([...cutOffNow(ON, s, "axis")]).toEqual(["g1"]);
    expect(isDoomed(ON, s, "g1")).toBe(true);
    expect(isDoomed(ON, s, "g2")).toBe(false);
    const saved: GameState = { ...s, units: { ...s.units, g1: { ...s.units.g1!, at: "L33" } } }; // a line opened during the turn
    expect(isDoomed(ON, saved, "g1")).toBe(false);
  });
  it("ATTACK_DOOMED_IGNORE_EXCHANGE: only an attack by doomed units alone skips the Exchange limit, and only with the rules acting", () => {
    expect(ATTACK_DOOMED_IGNORE_EXCHANGE).toBe(true);
    expect(exchangeFree(ON, s, ["g1"], { seed: 1 })).toBe(true);
    expect(exchangeFree(ON, s, ["g1", "g2"], { seed: 1 })).toBe(false);
    expect(exchangeFree(ON, s, [], { seed: 1 })).toBe(false);
    expect(exchangeFree(OFF, s, ["g1"], { seed: 1 })).toBe(false);
    expect(exchangeFree(ON, s, ["g1"], { seed: 1, supplyRules: false })).toBe(false);
  });
  it("LOSSES_CUT_OFF_FIRST: of the Exchange loss sets, the one with the most factors of units out of supply; the first listed otherwise", () => {
    expect(LOSSES_CUT_OFF_FIRST).toBe(true);
    const sets: Action[] = [{ type: "ALLOCATE_LOSSES", side: "axis", units: ["g2"] }, { type: "ALLOCATE_LOSSES", side: "axis", units: ["g1"] }];
    expect(chooseLosses(ON, s, sets, { seed: 1 })!.action).toBe(sets[1]);
    expect(chooseLosses(OFF, s, sets, { seed: 1 })!.action).toBe(sets[0]);
    expect(chooseLosses(ON, s, sets, { seed: 1, supplyRules: false })!.action).toBe(sets[0]);
    const fine: GameState = { ...s, units: { ...s.units, g1: { ...s.units.g1!, at: "L33" } } };
    expect(chooseLosses(ON, fine, sets, { seed: 1 })!.action).toBe(sets[0]);
    expect(chooseLosses(ON, s, [{ type: "END_STEP", side: "axis", step: "7h" }], { seed: 1 })).toBeUndefined();
  });
});
