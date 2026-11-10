import { describe, expect, it } from "vitest";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { sideToAct } from "../src/engine/actor";
import { countedDas, dasOf, setManualDas } from "../src/engine/air-defense-wire";
import { legalDasIntercept } from "../src/engine/air-intercept-wire";
import { airOf, hasFlown, markFlown } from "../src/engine/air-record";
import { chooseAction } from "../src/ai/choose";
import { fingerprint } from "../src/save/fingerprint";
import { describeEvent } from "../src/ui/eventText";
import { eventSide } from "../src/ui/logSide";
import type { GameState, Unit } from "../src/engine/types";
import { CTX, NO_AIRBASES_LEFT } from "./helpers";
import { at6f, inf, okOf } from "./helpers-move";

const air = (id: string, strength: number, owner: Unit["owner"], at: string) => inf(id, owner, at, strength, 4, "air");
const end = (step: string, side: "axis" | "allies" = "axis"): Action => ({ type: "END_STEP", step, side });
const intercept: Extract<Action, { type: "DESIGNATE_DAS_INTERCEPT" }> = { type: "DESIGNATE_DAS_INTERCEPT", side: "axis", units: ["a"], hex: "M33" };
const designate: Action = { type: "DESIGNATE_DAS", side: "allies", units: ["d"], hex: "M33" };
function start(seed = 13, a = 5, d = 5) {
  return at6f([inf("g", "germany", "M32"), inf("p", "poland", "M33"),
    air("a", a, "germany", "J32"), air("d", d, "britain", "M33")], "axis", undefined,
  { rngState: seed, airbasesPlaced: NO_AIRBASES_LEFT });
}
const position = (s = start()) => {
  let next = okOf(applyAction(CTX, setManualDas(s, true), end("6f"))).state;
  if (next.position?.part === "player-turn" && next.position.step === "7b") next = okOf(applyAction(CTX, next, end("7b"))).state;
  next = okOf(applyAction(CTX, next, designate)).state;
  return okOf(applyAction(CTX, next, end("7d", "allies"))).state;
};
const apply = (s: GameState, a: Action = intercept) => okOf(applyAction(CTX, s, a));

describe("09-10b: interception through real turn flow", () => {
  it("AER92/R11: waits at 7e only with current manual DAS and reachable unused air", () => {
    const s = position();
    expect(s.position).toMatchObject({ step: "7e" });
    expect(sideToAct(s)).toBe("axis");
    expect(legalActions(CTX, s)).toEqual([intercept, end("7e")]);
    expect(apply(s, end("7e")).state.position).toMatchObject({ step: "7h" });
    expect(apply(s, end("7e")).state.rngState).toBe(13);
    for (const change of [markFlown(start(), ["a"], "ground-support"),
      { ...start(), units: { ...start().units, a: air("a", 5, "germany", "A1") } }]) {
      expect(position(change).position).toMatchObject({ step: "7h" });
    }
    const noDas = replay(CTX, setManualDas(start(), true), [end("6f"), end("7b"), end("7d", "allies")]);
    expect(noDas.state.position).toMatchObject({ step: "7h" });
  });

  it.each(["6f", "7b", "7d", "7h", "7m"])("R11: rejects interception and does not list it at %s", step => {
    const s = { ...position(), position: { part: "player-turn" as const, turn: 1 as const, step } };
    const before = JSON.stringify(s);
    expect(legalActions(CTX, s).some(a => a.type === intercept.type)).toBe(false);
    expect(applyAction(CTX, s, intercept).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("AER92/C1: rejects wrong side, setup, game over, missing position and absent/false gate", () => {
    const s = position();
    expect(applyAction(CTX, s, { ...intercept, side: "allies" }).ok).toBe(false);
    for (const invalid of [{ ...s, phase: "setup" as const }, { ...s, phase: "game-over" as const },
      { ...s, position: null }, { ...s, air: { ...airOf(s), manualDas: undefined } }, setManualDas(s, false)]) {
      expect(legalDasIntercept(CTX, invalid)).toEqual([]);
      expect(applyAction(CTX, invalid, intercept).ok).toBe(false);
    }
  });

  it("R11/C2: rejects malformed, duplicate, unknown, ground and enemy units atomically", () => {
    const s = position(), before = JSON.stringify(s);
    for (const units of [null, "a", [], ["a", "a"], ["missing"], ["constructor"], ["g"], ["d"], ["a", "missing"], [1], Array(1), Array(101).fill("a")]) {
      expect(applyAction(CTX, s, { ...intercept, units } as Action).ok).toBe(false);
    }
    for (const hex of [null, 12, "constructor", "ZZ99", "M32"]) {
      expect(applyAction(CTX, s, { ...intercept, hex } as Action).ok).toBe(false);
    }
    expect(JSON.stringify(s)).toBe(before);
  });

  it("Ref 20.3/20.43: refuses flown, newly built, distant and off-map interceptors", () => {
    const s = position();
    for (const kind of ["ground-support", "counter-air", "new", "das-intercept"] as const) {
      const used = markFlown(s, ["a"], kind);
      expect(legalDasIntercept(CTX, used)).toEqual([]);
      expect(applyAction(CTX, used, intercept).ok).toBe(false);
    }
    for (const at of ["A1", "us-box", "ZZ99"]) {
      expect(applyAction(CTX, { ...s, units: { ...s.units, a: { ...s.units.a!, at } } }, intercept).ok).toBe(false);
    }
  });

  it("R11: requires existing committed enemy DAS, never based bystanders", () => {
    const s = position();
    for (const ids of [[], ["missing"], ["g"], ["a"]]) {
      const invalid = { ...s, air: { ...airOf(s), das: { M33: ids } } };
      expect(legalDasIntercept(CTX, invalid)).toEqual([]);
      expect(applyAction(CTX, invalid, intercept).ok).toBe(false);
    }
    const extra = { ...s, units: { ...s.units, bystander: air("bystander", 5, "britain", "M33") } };
    expect(apply(extra).state.units.bystander).toEqual(extra.units.bystander);
  });

  it("R15/AER93: seeded losses, pool returns, bases and mission use are deterministic", () => {
    // Ref 20.44/20.6: seed 13 rolls 4 vs 3; five owes one and breaks to three on each side.
    const s = position(), before = JSON.stringify(s);
    const result = apply(s);
    expect(result.events[0]).toMatchObject({ type: "DAS_INTERCEPTED", hex: "M33", rolls: [4, 3], lost: { interceptors: 2, support: 2 }, continuing: [] });
    expect(result.state.units.a).toMatchObject({ strength: 3, at: "J32" });
    expect(result.state.units.d).toMatchObject({ strength: 3, at: "M33" });
    expect(result.events.filter(e => e.type === "UNIT_RETURNED_TO_POOL")).toHaveLength(2);
    expect(result.state.rngState).toBe((13 + 2 * 0x6d2b79f5) >>> 0);
    expect(result.state.airFlown?.units.a).toBe("das-intercept");
    expect(result.state.airFlown?.units.d).toBe("das");
    expect(dasOf(result.state)).toEqual({});
    expect(hasFlown(result.state, "a")).toBe(true);
    expect(replay(CTX, s, [intercept])).toEqual({ state: result.state, events: result.events });
    expect(apply(JSON.parse(before) as GameState)).toEqual(result);
    expect(JSON.stringify(s)).toBe(before);
    expect(applyAction(CTX, result.state, intercept).ok).toBe(false);
  });

  it("AER94/Ref 20.44: larger winning DAS continues once, others abort", () => {
    const s = position(start(11, 3, 5));
    const result = apply(s);
    expect(result.events[0]).toMatchObject({ combat: { winner: "defender", defenderSurvivorsFree: true }, continuing: ["d"] });
    expect(dasOf(result.state)).toEqual({ M33: ["d"] });
    expect(countedDas(result.state, "M33", 3).factors).toBe(result.state.units.d!.strength);
    const fresh = { ...result.state, units: { ...result.state.units, extra: air("extra", 1, "germany", "J32") } };
    expect(legalActions(CTX, fresh)).toEqual([end("7e")]);
    expect(applyAction(CTX, fresh, { ...intercept, units: ["extra"] }).ok).toBe(false);
    expect(dasOf({ ...fresh, activeSide: "allies" })).toEqual({});
    expect(airOf({ ...fresh, activeSide: "allies" }).interceptedDas).toBeUndefined();
    expect(dasOf(apply(position(start(45, 3, 3))).state)).toEqual({});
  });

  it("AER93/Ref 20.6: complete destruction returns counters without leaving DAS references", () => {
    const s = position(start(44, 5, 1));
    const result = apply(s);
    expect(result.state.units.d).toBeUndefined();
    expect(dasOf(result.state)).toEqual({});
    expect(result.events).toContainEqual(expect.objectContaining({ type: "UNIT_ELIMINATED", unitId: "d" }));
  });

  it("AER92/R15: listing is sorted, immutable and accepts legal selected subsets", () => {
    const s = position();
    const extra = { ...s, units: { z: air("z", 1, "germany", "J32"), ...s.units } };
    const before = JSON.stringify(extra);
    expect(legalDasIntercept(CTX, extra)).toEqual([{ ...intercept, units: ["a", "z"] }]);
    expect(apply(extra, { ...intercept, units: ["z"] }).state.airFlown?.units.a).toBeUndefined();
    expect(JSON.stringify(extra)).toBe(before);
    for (const a of legalActions(CTX, extra)) expect(applyAction(CTX, extra, a).ok).toBe(true);
    const reversed = { ...extra, units: Object.fromEntries(Object.entries(extra.units).reverse()) };
    expect(legalActions(CTX, reversed)).toEqual(legalActions(CTX, extra));
  });

  it("R11/AER92: Allied Phasing planes intercept Axis DAS through the same flow", () => {
    const initial = at6f([inf("g", "britain", "M32"), inf("p", "germany", "M33"),
      air("a", 3, "britain", "M32"), air("d", 5, "germany", "M33")], "allies", undefined,
    { rngState: 11, airbasesPlaced: NO_AIRBASES_LEFT, control: { M32: "britain", M33: "germany" } });
    const actions: Action[] = [end("6f", "allies"), end("7b", "allies"), { ...designate, side: "axis" }, end("7d")];
    const s = replay(CTX, setManualDas(initial, true), actions).state;
    expect(s.position).toMatchObject({ step: "7e" });
    expect(sideToAct(s)).toBe("allies");
    expect(legalActions(CTX, s)).toEqual([{ ...intercept, side: "allies" }, end("7e", "allies")]);
    expect(apply(s, { ...intercept, side: "allies" }).state.airFlown?.units.a).toBe("das-intercept");
  });

  it("AER94: preserves other targets and consumes only the selected interceptors", () => {
    const s = position();
    const other = { ...s, units: { ...s.units, extra: air("extra", 1, "britain", "M33") },
      air: { ...airOf(s), das: { ...dasOf(s), M32: ["extra"] } } };
    const done = apply(other).state;
    expect(dasOf(done)).toEqual({ M32: ["extra"] });
    expect(done.units.extra).toEqual(other.units.extra);
    expect(done.air?.interceptedDas).toEqual(["M33"]);
  });

  it("R15: a modified tie consumes exactly the third die and records it", () => {
    const s = position(start(14, 5, 5));
    const done = apply(s);
    expect(done.events[0]).toMatchObject({ rolls: [3, 3], combat: { winner: null, tieRoll: 4 } });
    expect(done.state.rngState).toBe((14 + 3 * 0x6d2b79f5) >>> 0);
    expect(describeEvent(done.events[0]!, CTX, new Set(), new Map(), s)).toContain("tie die 4");
  });

  it("R11/AER94: aborted DAS survives at base but adds nothing to the ground battle", () => {
    const s = position();
    const done = apply(s).state;
    const h = apply(done, end("7e")).state;
    const battle = apply(h, { type: "ATTACK", side: "axis", units: ["g"], target: "M33" });
    const combat = battle.events.find(e => e.type === "COMBAT_RESOLVED")!;
    expect(combat.dasFactors ?? 0).toBe(0);
    // Ref 20.2: subsequent ground capture may displace these based survivors.
    expect(battle.state.units.d).toMatchObject({ strength: done.units.d!.strength, owner: "britain" });
    expect(hasFlown(battle.state, "d")).toBe(true);
  });

  it("C3: writes a readable neutral log line for both sides", () => {
    const s = position();
    const e = apply(s).events[0]!;
    expect(describeEvent(e, CTX, new Set(), new Map(), s)).toMatch(/DAS interception at Poznan.*: rolls 4 and 3.*losses 2 intercepting, 2 supporting; DAS ends/);
    expect(eventSide(e, "axis", s)).toBeNull();
    const c = apply(position(start(11, 3, 5))).events[0]!;
    expect(describeEvent(c, CTX, new Set(), new Map(), s)).toContain("surviving DAS continues");
  });

  it("C1/AER92: old JSON state, fingerprints, actions and computer path stay unchanged", () => {
    const initial = start(), before = JSON.stringify(initial), hash = fingerprint(initial);
    const loaded = JSON.parse(before) as GameState;
    expect(airOf(loaded).interceptedDas).toBeUndefined();
    const b = apply(loaded, end("6f")).state;
    expect(chooseAction(CTX, b, { seed: 1 })?.action).toEqual(end("7b"));
    const done = apply(b, end("7b"));
    expect(done.state.position).toMatchObject({ step: "7h" });
    expect(done.state.rngState).toBe(13);
    expect(done.state.air?.interceptedDas).toBeUndefined();
    expect(done.state.airFlown).toEqual(initial.airFlown);
    expect(legalActions(CTX, done.state).some(a => a.type === intercept.type)).toBe(false);
    expect(replay(CTX, initial, [end("6f"), end("7b")])).toEqual(replay(CTX, loaded, [end("6f"), end("7b")]));
    expect(JSON.stringify(initial)).toBe(before);
    expect(fingerprint(initial)).toBe(hash);
  });
});
