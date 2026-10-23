import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { ATTACK_DOOMED_IGNORE_EXCHANGE, chooseLosses, cutOffNow, exchangeFree, isDoomed, LOSSES_CUT_OFF_FIRST } from "../src/ai/doomed";
import { MOVE_PREFER_SUPPLY, networkOf, preferSupplied, suppliedAfterMove, supplyRulesOn } from "../src/ai/lines";
import type { Action } from "../src/engine/actions";
import type { GameContext } from "../src/engine/context";
import { isUnitSupplied, type SupplyNetwork } from "../src/engine/supply";
import { SUPPLY_EFFECTS_ENABLED, supplyEffectsOn } from "../src/engine/supply-effects";
import type { GameState } from "../src/engine/types";
import { reachableHexes } from "../src/engine/movement";
import { enemyZocFor } from "../src/engine/zoc";
import { CTX } from "./helpers";
import { ALL_OFFENSIVE, at6f, inf, move, okOf } from "./helpers-move";
import { combatOf, turnKey } from "../src/engine/combat-record";
import { legalActions } from "../src/engine/actions";

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
  const s = at6f([inf("g1", "germany", "L32", 3, 3)], "axis", undefined, { frontOptions: ALL_OFFENSIVE });
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
  it("a Fortress of the side supplies the units inside it (Ref 4.8, 19.2): a German unit cut off at Q23 is supplied once in a German-held Maginot hex", () => {
    const f = at6f([inf("g1", "germany", "Q23", 3, 3)], "axis", undefined, { control: { Q23: "germany", P24: "germany" }, fortresses: { P24: true } });
    expect(isUnitSupplied(ON, f, "g1")).toBe(false);
    expect(suppliedAfterMove(ON, f, networkOf(ON, f, "axis"), [f.units.g1!], "P24")).toBe(true);
    expect(isUnitSupplied(ON, okOf(move(f, ["g1"], ["P24"], ON)).state, "g1")).toBe(true);
    const lost = { ...f, fortresses: { P24: false } };
    expect(suppliedAfterMove(ON, lost, networkOf(ON, lost, "axis"), [lost.units.g1!], "P24")).toBe(false);
  });
  it("enemy ZOC: a line does not pass through a hex in it (Ref 19.3), so a hex whose only supplied neighbour is in enemy armor ZOC stays cut off", () => {
    // Polish armor at M32 puts L32 in its ZOC (not K33); K33's other neighbours are made Polish, so L32 is its only way to Berlin.
    const z = at6f([inf("g1", "germany", "L32", 3, 3), inf("p1", "poland", "M32", 3, 3, "armor")], "axis", undefined, { control: { K32: "poland", J33: "poland", J34: "poland", K34: "poland", L33: "poland", K33: "poland" } });
    const ok = suppliedAfterMove(ON, z, networkOf(ON, z, "axis"), [z.units.g1!], "K33");
    expect(ok).toBe(false);
    expect(isUnitSupplied(ON, okOf(move(z, ["g1"], ["K33"], ON)).state, "g1")).toBe(ok);
    const open = at6f([inf("g1", "germany", "L32", 3, 3)], "axis", undefined, { control: z.control });
    expect(suppliedAfterMove(ON, open, networkOf(ON, open, "axis"), [open.units.g1!], "K33")).toBe(true); // without the armor, through L32
  });
  it("...a source passes its line on even from inside enemy ZOC, but not to a hex in the ZOC of the same enemy unit (Ref 19.3)", () => {
    // Polish armor at M31 puts Berlin (L31) and L32 in its ZOC; L32's other neighbours are made Polish, so Berlin is its only way.
    const z = at6f([inf("g1", "germany", "L31", 3, 3), inf("p1", "poland", "M31", 3, 3, "armor")], "axis", undefined, { control: { L32: "poland", L33: "poland", K33: "poland", K32: "poland", M32: "poland" } });
    const ok = suppliedAfterMove(ON, z, networkOf(ON, z, "axis"), [z.units.g1!], "L32");
    expect(ok).toBe(false);
    expect(isUnitSupplied(ON, okOf(move(z, ["g1"], ["L32"], ON)).state, "g1")).toBe(ok);
    expect(suppliedAfterMove(ON, z, networkOf(ON, z, "axis"), [z.units.g1!], "K32")).toBe(true); // next to Berlin, out of the armor's ZOC
  });
  it("a source set supplies only the owners it serves (19.2: Konigsberg for German units, the Soviet split)", () => {
    const g = at6f([inf("g1", "germany", "L32", 3, 3), inf("i1", "italy", "L32", 3, 3)]);
    const only: SupplyNetwork = { side: "axis", sources: ["L31"], zoc: new Set(), reaches: [{ kind: "main", sources: new Set(["L31"]), next: new Map([["L31", null], ["L32", "L31"]]), serves: (o) => o === "germany" }] };
    expect(suppliedAfterMove(ON, g, only, [g.units.g1!], "L33")).toBe(true);
    expect(suppliedAfterMove(ON, g, only, [g.units.i1!], "L33")).toBe(false);
    expect(suppliedAfterMove(ON, g, only, [g.units.g1!, g.units.i1!], "L33")).toBe(false); // every unit of the stack must be supplied
  });
  it("the network is searched once per position, however many hexes are asked about", () => {
    expect(networkOf(ON, s, "axis")).toBe(net);
    expect(networkOf(ON, { ...s }, "axis")).not.toBe(net);
    expect(networkOf({ ...ON }, s, "axis")).not.toBe(net); // kept per context too: the answer depends on it
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
  it("LOSSES_CUT_OFF_FIRST: of the Exchange loss sets, the one with the most factors of doomed units; the first listed otherwise", () => {
    expect(LOSSES_CUT_OFF_FIRST).toBe(true);
    const sets: Action[] = [{ type: "ALLOCATE_LOSSES", side: "axis", units: ["g2"] }, { type: "ALLOCATE_LOSSES", side: "axis", units: ["g1"] }];
    expect(chooseLosses(ON, s, sets, { seed: 1 })!.action).toBe(sets[1]);
    expect(chooseLosses(OFF, s, sets, { seed: 1 })!.action).toBe(sets[0]);
    expect(chooseLosses(ON, s, sets, { seed: 1, supplyRules: false })!.action).toBe(sets[0]);
    const fine: GameState = { ...s, units: { ...s.units, g1: { ...s.units.g1!, at: "L33" } } };
    expect(chooseLosses(ON, fine, sets, { seed: 1 })!.action).toBe(sets[0]);
    expect(chooseLosses(ON, s, [{ type: "END_STEP", side: "axis", step: "7h" }], { seed: 1 })).toBeUndefined();
  });
  it("...a unit cut off only now is not doomed (it survives the turn, Ref 11.74 as built): it is not given up first", () => {
    const sets: Action[] = [{ type: "ALLOCATE_LOSSES", side: "axis", units: ["g2"] }, { type: "ALLOCATE_LOSSES", side: "axis", units: ["g1"] }];
    const nothingRecorded: GameState = { ...s, unsuppliedAtStart: undefined }; // g1 cut off now, but not when the turn began
    expect(chooseLosses(ON, nothingRecorded, sets, { seed: 1 })!.action).toBe(sets[0]);
    // g1 doomed, g2 cut off only now (also on neutral Hungarian land), g3 supplied: the doomed g1 goes, though listed last.
    const three: GameState = { ...at6f([inf("g1", "germany", "S30", 3, 3), inf("g2", "germany", "S31", 3, 3), inf("g3", "germany", "L32", 3, 3)]), unsuppliedAtStart: ["g1"] };
    expect(cutOffNow(ON, three, "axis").has("g2")).toBe(true);
    const by3: Action[] = [{ type: "ALLOCATE_LOSSES", side: "axis", units: ["g3"] }, { type: "ALLOCATE_LOSSES", side: "axis", units: ["g2"] }, { type: "ALLOCATE_LOSSES", side: "axis", units: ["g1"] }];
    expect(chooseLosses(ON, three, by3, { seed: 1 })!.action).toBe(by3[2]);
  });
  it("...when the other side chooses (its units defended), none of its units is doomed this turn: the first set listed", () => {
    const def: GameState = { ...at6f([inf("g1", "germany", "S30", 3, 3), inf("g2", "germany", "L32", 3, 3)], "allies"), unsuppliedAtStart: [] };
    const sets: Action[] = [{ type: "ALLOCATE_LOSSES", side: "axis", units: ["g2"] }, { type: "ALLOCATE_LOSSES", side: "axis", units: ["g1"] }];
    expect(chooseLosses(ON, def, sets, { seed: 1 })!.action).toBe(sets[0]);
  });
  it("step 7h: an Exchange waiting for the computer's losses gives up the cut-off unit, though the engine lists it second", () => {
    const at7h: GameState = { ...s, position: { part: "player-turn", turn: 1, step: "7h" } };
    const pending: GameState = { ...at7h, combat: { ...combatOf(at7h), turn: turnKey(at7h), pending: { chooser: "axis", target: "M35", candidates: ["g2", "g1"], values: { g1: 3, g2: 3 }, required: 2, attackers: ["g1", "g2"] } } };
    const listed = legalActions(ON, pending).filter((a) => a.type === "ALLOCATE_LOSSES");
    expect(listed.map((a) => a.units)).toEqual([["g2"], ["g1"]]);
    expect(chooseAction(ON, pending, { seed: 1 })!.action).toEqual(listed[1]);
    expect(chooseAction(OFF, pending, { seed: 1 })!.action).toEqual(listed[0]);
  });
  it("step 7h: two units cut off in a pocket next to Warsaw attack at 1-1 an Exchange could cost them 15 factors of; supplied, they would not", () => {
    // M34 and N34 held by Germany but ringed by Polish land: no line. 18 factors against 5, tripled in Warsaw: an Exchange costs 15, the limit is 8.
    const base = at6f([inf("g1", "germany", "M34", 9, 3), inf("g2", "germany", "N34", 9, 3), inf("p1", "poland", "M35", 3, 3), inf("p2", "poland", "M35", 2, 3)], "axis", undefined, { frontOptions: ALL_OFFENSIVE, control: { M34: "germany", N34: "germany" }, position: { part: "player-turn", turn: 1, step: "7h" } });
    const doomed: GameState = { ...base, unsuppliedAtStart: ["g1", "g2"] };
    expect(chooseAction(ON, doomed, { seed: 1 })!.action).toEqual({ type: "ATTACK", side: "axis", units: ["g1", "g2"], target: "M35" });
    expect(chooseAction(ON, base, { seed: 1 })!.action.type).toBe("END_STEP");
    expect(chooseAction(ON, doomed, { seed: 1, supplyRules: false })!.action.type).toBe("END_STEP");
  });
});
