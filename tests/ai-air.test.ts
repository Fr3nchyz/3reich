import { describe, expect, it } from "vitest";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { airOf, hasFlown, markFlown } from "../src/engine/air-record";
import { setManualDas } from "../src/engine/air-defense-wire";
import { AI_USES_AIR, chooseAir } from "../src/ai/air";
import { chooseAirStage } from "../src/ai/air-stage";
import { chooseAction } from "../src/ai/choose";
import { distance, hex } from "../src/engine/hex";
import { neighborIds } from "../src/engine/attack-rules";
import type { GameState, Unit } from "../src/engine/types";
import { CTX, NO_AIRBASES_LEFT } from "./helpers";
import { at6f, inf, okOf } from "./helpers-move";

const cfg = { seed: 1, usesAir: true };
const air = (id: string, at: string, strength = 3, owner: Unit["owner"] = "germany") => inf(id, owner, at, strength, 4, "air");
const start = (units: Unit[], tweak: Partial<GameState> = {}) => at6f(units, "axis", undefined, { rngState: 13, nextUnitId: 100, airbasesPlaced: NO_AIRBASES_LEFT, ...tweak });
const end = (s: GameState, step: string) => okOf(applyAction(CTX, s, { type: "END_STEP", side: s.activeSide, step })).state;
const ground = () => start([inf("g", "germany", "M32", 6), inf("p", "poland", "M33", 2), air("a", "J32", 5)]);
const b = (s = ground()) => end(s, "6f");
const pick = (s: GameState) => {
  const before = JSON.stringify(s);
  const d = chooseAction(CTX, s, cfg);
  expect(JSON.stringify(s)).toBe(before);
  expect(d).not.toBeNull();
  const result = okOf(applyAction(CTX, s, d!.action));
  return { ...result, action: d!.action };
};

// Follow the actual sequence and apply every chosen action; no direct jumps to 7c/7d/7h.
function throughCombat(initial: GameState) {
  let state = initial;
  const actions: Action[] = [];
  const events = [];
  for (let i = 0; i < 40; i++) {
    const step = state.position?.part === "player-turn" ? state.position.step : "";
    if (!["7b", "7c", "7d", "7e", "7h"].includes(step)) break;
    const result = pick(state);
    actions.push(result.action); events.push(...result.events); state = result.state;
    if (result.action.type === "END_STEP" && result.action.step === "7h") break;
  }
  expect(actions.length).toBeLessThan(40);
  return { state, actions, events };
}

describe("09-12 default-off computer air", () => {
  it("AER104: absent and explicit false preserve choices, state and old optional fields", () => {
    expect(AI_USES_AIR).toBe(false);
    for (const s of [ground(), b(), end(b(), "7b")]) {
      const before = JSON.stringify(s);
      expect(chooseAction(CTX, s, { seed: 1 })).toEqual(chooseAction(CTX, s, { seed: 1, usesAir: false }));
      expect(chooseAir(CTX, s, { seed: 1 }, legalActions(CTX, s))).toBeUndefined();
      expect(JSON.stringify(s)).toBe(before);
      expect(s.air?.manualDas).toBeUndefined();
    }
    expect(chooseAction(CTX, b(), { seed: 1 })?.action).toMatchObject({ type: "END_STEP", step: "7b" });
  });

  it("AER105/R4: stages closer to enemy ground at a safe legal base, once only", () => {
    const s = start([air("a", "K28"), inf("p", "poland", "M33")]);
    const r = pick(s);
    expect(r.action.type).toBe("STAGE_AIR");
    const at = r.state.units.a!.at;
    expect(distance(hex(at), hex("M33"))).toBeLessThan(distance(hex("K28"), hex("M33")));
    expect(neighborIds(CTX, at)).not.toContain("M33");
    expect(airOf(r.state).staged).toContain("a");
    expect(chooseAirStage(CTX, r.state)).toBeUndefined();
  });

  it("AER105: retains the last plane at Berlin, but can move a second plane", () => {
    const s = start([air("a", "L31", 2), inf("p", "poland", "M33")]);
    expect(chooseAirStage(CTX, s)).toBeUndefined();
    const two = { ...s, units: { ...s.units, z: air("z", "L31", 2) } };
    const r = pick(two);
    expect(r.action.type).toBe("STAGE_AIR");
    expect(Object.values(r.state.units).filter(u => u.type === "air" && u.at === "L31")).toHaveLength(1);
  });

  it("AER105: avoids enemy-adjacent bases even when they are closest", () => {
    const s = start([air("a", "K28"), inf("p", "poland", "L33")]);
    const d = chooseAirStage(CTX, s);
    if (d?.action.type !== "STAGE_AIR") throw Error("expected staging");
    expect(neighborIds(CTX, d.action.to)).not.toContain("L33");
    expect(d.action.to).not.toBe("K33");
  });

  it("AER107/R8: improves an accepted attack, then attacks it and loses no unused support", () => {
    const s = b();
    expect(s.position).toMatchObject({ step: "7b" });
    const r = pick(s);
    expect(r.action).toMatchObject({ type: "DESIGNATE_AIR", mission: "ground-support", target: "M33" });
    const done = throughCombat(s);
    expect(done.actions.some(a => a.type === "ATTACK" && a.target === "M33")).toBe(true);
    expect(done.events.some(e => e.type === "GROUND_SUPPORT_LOST")).toBe(false);
    expect(airOf(done.state).groundSupport).toEqual({});
    expect(replay(CTX, s, done.actions)).toEqual({ state: done.state, events: done.events });
  });

  it("AER107: refuses bad attacks and support that cannot improve a column", () => {
    const bad = b(start([inf("g", "germany", "M32", 1), inf("p", "poland", "M33", 5), air("a", "J32", 3)]));
    expect(pick(bad).action).toMatchObject({ type: "END_STEP" });
    const max = b(start([inf("g", "germany", "M32", 20), inf("p", "poland", "M33", 1), air("a", "J32", 3)]));
    expect(pick(max).action).toMatchObject({ type: "END_STEP" });
  });

  it("AER106/R12: designates superior counter-air, reaches 7c and explicitly resolves", () => {
    const s = b(start([inf("g", "germany", "M32"), inf("p", "poland", "M33", 5), air("a", "J32", 5), air("d", "M33", 2, "britain")]));
    const first = pick(s);
    expect(first.action).toMatchObject({ type: "DESIGNATE_AIR", mission: "counter-air", units: ["a"] });
    const c = end(first.state, "7b");
    expect(c.position).toMatchObject({ step: "7c" });
    const resolved = pick(c);
    expect(resolved.action.type).toBe("RESOLVE_COUNTER_AIR");
    expect(resolved.state.rngState).not.toBe(c.rngState);
    expect(airOf(resolved.state).counterAir).toEqual([]);
    const weak = b(start([inf("g", "germany", "M32"), inf("p", "poland", "M33", 5), air("a", "J32", 3), air("d", "M33", 2, "britain")]));
    expect(pick(weak).action).toMatchObject({ type: "END_STEP" });
  });

  it("AER108/R10: reaches manual DAS, keeps a reserve and answers with the non-phasing side", () => {
    const initial = setManualDas(start([inf("g", "germany", "M32", 6), inf("p", "poland", "M33", 2), air("d", "M33", 2, "poland"), air("e", "M33", 1, "poland")]), true);
    const d = end(initial, "6f");
    expect(d.position).toMatchObject({ step: "7d" });
    const r = pick(d);
    expect(r.action).toMatchObject({ type: "DESIGNATE_DAS", side: "allies", hex: "M33", units: ["d"] });
    expect(pick(r.state).action).toMatchObject({ type: "END_STEP", side: "allies", step: "7d" });
    const withoutGate = end(setManualDas(initial, false), "6f");
    expect(withoutGate.position).not.toMatchObject({ step: "7d" });
  });

  it("AER107/AER108: committed attacks still happen when subsequent DAS lowers the odds", () => {
    // AER107: DAS reduces this accepted attack below even the ordinary chooser's 1-1 floor.
    const s = setManualDas(start([inf("g", "germany", "M32", 9), inf("p", "poland", "M33", 3),
      air("a", "J32", 3), air("d", "M33", 5, "poland"), air("e", "M35", 3, "poland"), air("f", "M35", 1, "poland")]), true);
    const done = throughCombat(b(s));
    expect(done.actions.some(a => a.type === "DESIGNATE_DAS")).toBe(true);
    expect(done.actions.some(a => a.type === "ATTACK" && a.target === "M33")).toBe(true);
    expect(done.events.some(e => e.type === "GROUND_SUPPORT_LOST")).toBe(false);
  });

  it("AER105/R2: prepares a supplied forward base only where friendly ground stands", () => {
    const s = start([air("a", "K33"), inf("g", "germany", "M32"), inf("p", "poland", "M33")], { airbasesPlaced: {} });
    const r = pick(s);
    expect(r.action).toMatchObject({ type: "PLACE_AIRBASE", owner: "germany", at: "M32" });
    expect(r.events.some(e => e.type === "AIRBASE_PLACED")).toBe(true);
    const empty = start([air("a", "K33"), inf("p", "poland", "M33")], { airbasesPlaced: {} });
    expect(chooseAirStage(CTX, empty)).toBeUndefined();
  });

  it("AER107: two commitments use disjoint ground attackers and both are fought", () => {
    const s = b(start([inf("g", "germany", "M32", 6), inf("p", "poland", "M33", 2),
      inf("h", "germany", "N34", 6), inf("q", "poland", "N35", 2), air("a", "J32", 5), air("z", "J36", 5)]));
    const done = throughCombat(s);
    const support = done.actions.filter(a => a.type === "DESIGNATE_AIR" && a.mission === "ground-support");
    expect(support).toHaveLength(2);
    expect(done.actions.filter(a => a.type === "ATTACK").map(a => a.target).sort()).toEqual(["M33", "N35"]);
    expect(done.events.some(e => e.type === "GROUND_SUPPORT_LOST")).toBe(false);
  });

  it("AER108: ratio one qualifies, lower threats and a lone defending plane pass", () => {
    const atDas = (attack: number, reserve = true) => end(setManualDas(start([
      inf("g", "germany", "M32", attack), inf("p", "poland", "M33", 2),
      air("d", "M33", 2, "poland"), ...(reserve ? [air("e", "M33", 1, "poland")] : []),
    ]), true), "6f");
    expect(pick(atDas(2)).action.type).toBe("DESIGNATE_DAS");
    expect(pick(atDas(1)).action.type).toBe("END_STEP");
    expect(pick(atDas(2, false)).action.type).toBe("END_STEP");
  });

  it("AER109/R5: used and newly built planes cannot be assigned", () => {
    for (const use of ["new", "counter-air", "das"] as const) {
      const s = markFlown(b(), ["a"], use);
      expect(pick(s).action).toMatchObject({ type: "END_STEP" });
    }
  });

  it("AER107: commits only the first whole counter needed to raise the column", () => {
    const s = b(start([inf("g", "germany", "M32", 6), inf("p", "poland", "M33", 2),
      air("a", "J32", 2), air("z", "J32", 3)]));
    expect(pick(s).action).toMatchObject({ type: "DESIGNATE_AIR", mission: "ground-support", units: ["a"] });
    expect(throughCombat(s).events.some(e => e.type === "GROUND_SUPPORT_LOST")).toBe(false);
  });

  it("AER106: exactly twice all based factors qualifies, including already-flown defenders", () => {
    const position = (superior: boolean) => b(start([inf("g", "germany", "M32"), inf("p", "poland", "M33", 5),
      air("a", "J32", superior ? 2 : 3), ...(superior ? [air("z", "J32", 2)] : []),
      air("d", "M33", 1, "britain"), air("e", "M33", 1, "britain")]));
    expect(pick(position(true)).action).toMatchObject({ type: "DESIGNATE_AIR", mission: "counter-air" });
    const flown = markFlown(position(false), ["e"], "das");
    expect(pick(flown).action.type).toBe("END_STEP");
  });

  it("AER106/AER107: ground support gets free planes before counter-air", () => {
    const s = b(start([inf("g", "germany", "M32", 6), inf("p", "poland", "M33", 2),
      air("a", "J32", 5), air("d", "M33", 2, "britain")]));
    expect(pick(s).action).toMatchObject({ type: "DESIGNATE_AIR", mission: "ground-support" });
    expect(throughCombat(s).actions.some(a => a.type === "RESOLVE_COUNTER_AIR")).toBe(false);
  });

  it("AER108: supports the greater threat first and retains a reserve across targets", () => {
    const s = end(setManualDas(start([inf("g", "germany", "M32", 2), inf("p", "poland", "M33", 2),
      inf("h", "germany", "N34", 6), inf("q", "poland", "N35", 1),
      air("a", "M33", 3, "poland"), air("d", "M35", 3, "poland"), air("e", "N35", 3, "poland")]), true), "6f");
    const first = pick(s);
    expect(first.action).toMatchObject({ type: "DESIGNATE_DAS", hex: "N35" });
    const second = pick(first.state);
    expect(second.action).toMatchObject({ type: "DESIGNATE_DAS", hex: "M33" });
    const last = pick(second.state);
    expect(last.action).toMatchObject({ type: "END_STEP", step: "7d" });
    const state = last.state;
    expect(Object.values(state.units).filter(u => u.type === "air" && !hasFlown(state, u.id))).toHaveLength(1);
  });

  it("AER109/R15: same seed and reordered JSON units produce identical legal actions and results", () => {
    const s = b(setManualDas({ ...ground(), units: { ...ground().units, d: air("d", "M33", 3, "poland"), e: air("e", "M33", 2, "poland") } }, true));
    const snapshot = JSON.stringify(s);
    const first = throughCombat(s);
    expect(throughCombat(JSON.parse(snapshot) as GameState)).toEqual(first);
    const reverse = { ...s, units: Object.fromEntries(Object.entries(s.units).reverse()) };
    expect(throughCombat(reverse)).toEqual(first);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
