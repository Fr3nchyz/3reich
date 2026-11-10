import { describe, expect, it } from "vitest";
import { applyAction, legalActions, moveOnAction, replay, type Action } from "../src/engine/actions";
import { sideToAct } from "../src/engine/actor";
import { countedDas, dasOf, legalDas, setManualDas } from "../src/engine/air-defense-wire";
import { airOf, hasFlown, markFlown, newAirTurn } from "../src/engine/air-record";
import { attackNumbers } from "../src/engine/attack-rules";
import { combatOf } from "../src/engine/combat-record";
import { resolveOffensiveCombat } from "../src/engine/combat";
import { chooseAction } from "../src/ai/choose";
import { newGame } from "../src/engine/game";
import { restore } from "../src/save/restore";
import { createSnapshotValidator } from "../src/save/snapshotInvariants";
import type { JsonObject, SaveFile } from "../src/save/format";
import { fingerprint } from "../src/save/fingerprint";
import { describeEvent } from "../src/ui/eventText";
import { eventSide } from "../src/ui/logSide";
import { attackPreview } from "../src/ui/attackPreview";
import type { GameState, Unit } from "../src/engine/types";
import { CTX, NO_AIRBASES_LEFT } from "./helpers";
import { at6f, inf, okOf } from "./helpers-move";

const air = (id: string, at: string, strength = 3, owner: Unit["owner"] = "britain") => inf(id, owner, at, strength, 4, "air");
function start(seed = 13, ground = 3, strength = 3) {
  return at6f([inf("g", "germany", "M32", ground), inf("p", "poland", "M33"),
    air("a", "J32", 3, "germany"), air("d", "M33", strength)], "axis", undefined,
  { rngState: seed, airbasesPlaced: NO_AIRBASES_LEFT });
}
const end = (step: string, side: "axis" | "allies" = "axis"): Action => ({ type: "END_STEP", step, side });
const designate: Extract<Action, { type: "DESIGNATE_DAS" }> = { type: "DESIGNATE_DAS", side: "allies", units: ["d"], hex: "M33" };
const at7b = (s = start()) => okOf(applyAction(CTX, s, end("6f"))).state;
const at7d = (s = start()) => okOf(applyAction(CTX, at7b(setManualDas(s, true)), end("7b"))).state;
const committed = (s = start()) => okOf(applyAction(CTX, at7d(s), designate)).state;
const battle = (s = start()) => {
  const next = okOf(applyAction(CTX, committed(s), end("7d", "allies"))).state;
  // AER84: pass optional interception before testing the DAS ground battle.
  return next.position?.part === "player-turn" && next.position.step === "7e" ? okOf(applyAction(CTX, next, end("7e"))).state : next;
};
const attack: Action = { type: "ATTACK", side: "axis", units: ["g"], target: "M33" };

describe("09-8b DAS through the real turn flow", () => {
  it("AER76: waits only with the manual flag and useful work; defender designates and passes", () => {
    const d = at7d();
    expect(d.position).toMatchObject({ step: "7d" });
    expect(sideToAct(d)).toBe("allies");
    expect(legalActions(CTX, d)).toEqual([designate, end("7d", "allies")]);
    expect(moveOnAction(d)).toEqual([end("7d", "allies")]);
    expect(applyAction(CTX, d, end("7d")).ok).toBe(false);
    expect(okOf(applyAction(CTX, d, end("7d", "allies"))).state.position).toMatchObject({ step: "7h" });
    expect(okOf(applyAction(CTX, d, designate)).state.position).toMatchObject({ step: "7d" });
    expect(legalActions(CTX, committed())).toEqual([end("7d", "allies")]);
    for (const s of [setManualDas(start(), false), markFlown(setManualDas(start(), true), ["d"], "new"),
      setManualDas({ ...start(), units: { ...start().units, d: air("d", "A1") } }, true)]) {
      expect(okOf(applyAction(CTX, at7b(s), end("7b"))).state.position).toMatchObject({ step: "7h" });
    }
  });

  it("R10/AER76: either Non-Phasing side controls 7d", () => {
    const s = at6f([inf("g", "britain", "M32"), inf("p", "germany", "M33"),
      air("d", "M33", 3, "germany")], "allies", undefined, { airbasesPlaced: NO_AIRBASES_LEFT, control: { M33: "germany" } });
    const d = okOf(applyAction(CTX, setManualDas(s, true), end("6f", "allies"))).state;
    expect(d.position).toMatchObject({ step: "7d" });
    expect(sideToAct(d)).toBe("axis");
    const a: Action = { ...designate, side: "axis" };
    expect(legalActions(CTX, d)).toContainEqual(a);
    expect(okOf(applyAction(CTX, d, a)).events[0]).toMatchObject({ type: "DAS_COMMITTED", side: "axis" });
    expect(okOf(applyAction(CTX, d, end("7d"))).state.position).toMatchObject({ step: "7h" });
  });

  it("R10/AER76: rejects elsewhere, wrong side, or absent gate without mutation", () => {
    const d = at7d();
    for (const s of [start(), at7b(setManualDas(start(), true)), battle(),
      { ...d, phase: "setup" as const }, { ...d, phase: "game-over" as const },
      setManualDas(d, false)]) {
      const before = JSON.stringify(s);
      expect(applyAction(CTX, s, designate).ok).toBe(false);
      expect(JSON.stringify(s)).toBe(before);
    }
    expect(applyAction(CTX, d, { ...designate, side: "axis" }).ok).toBe(false);
  });

  it("R10/C2: malformed and illegal units or targets are rejected atomically", () => {
    const d = at7d();
    const before = JSON.stringify(d);
    const bad = [[], ["d", "d"], ["missing"], ["constructor"], ["p"], ["a"], ["d", "missing"],
      null, "d", [1], Array(1), Array(101).fill("d")];
    for (const units of bad) expect(applyAction(CTX, d, { ...designate, units } as Action).ok).toBe(false);
    for (const hex of [null, 12, "constructor", "ZZ99", "J32", "M32"]) {
      expect(applyAction(CTX, d, { ...designate, hex } as Action).ok).toBe(false);
    }
    expect(JSON.stringify(d)).toBe(before);
  });

  it("AER77/R10: requires a current potential ground attack and usable base/range", () => {
    const d = at7d();
    const noThreat = { ...d, units: { ...d.units, g: { ...d.units.g!, at: "A1" } } };
    expect(legalDas(CTX, noThreat)).toEqual([]);
    expect(applyAction(CTX, noThreat, designate).ok).toBe(false);
    const noGround = { ...d, units: Object.fromEntries(Object.entries(d.units).filter(([id]) => id !== "p")) };
    expect(legalDas(CTX, noGround)).toEqual([]);
    expect(applyAction(CTX, noGround, designate).ok).toBe(false);
    for (const at of ["A1", "M32", "us-box", "ZZ99"]) {
      const invalid = { ...d, units: { ...d.units, d: { ...d.units.d!, at } } };
      expect(applyAction(CTX, invalid, designate).ok).toBe(false);
    }
  });

  it("Ref 20.3/AER62: consumes one mission immediately, leaves bases, prevents reuse and counter-air aborts", () => {
    const d = at7d();
    const done = okOf(applyAction(CTX, d, designate));
    expect(done.state.units).toEqual(d.units);
    expect(done.state.rngState).toBe(d.rngState);
    expect(hasFlown(done.state, "d")).toBe(true);
    expect(done.state.airFlown?.units.d).toBe("das");
    expect(dasOf(done.state)).toEqual({ M33: ["d"] });
    expect(applyAction(CTX, done.state, designate).ok).toBe(false);
    for (const kind of ["counter-air", "ground-support", "new"] as const) {
      expect(applyAction(CTX, markFlown(d, ["d"], kind), designate).ok).toBe(false);
    }
  });

  it("AER78/Ref 20.51: cumulative commitments cannot exceed three times basic defense", () => {
    const d = at7d(start(13, 3, 5));
    const more = { ...d, units: { ...d.units, e: air("e", "M33", 5) } };
    const one = okOf(applyAction(CTX, more, designate)).state;
    expect(applyAction(CTX, one, { ...designate, units: ["e"] }).ok).toBe(false);
    expect(legalDas(CTX, one)).toEqual([]);
    const exact = { ...one, units: { ...one.units, e: air("e", "M33", 3), f: air("f", "M33", 1) } };
    expect(okOf(applyAction(CTX, exact, { ...designate, units: ["e", "f"] })).state.air?.das).toEqual({ M33: ["d", "e", "f"] });
  });

  it("R10/C4: DAS helps defense after terrain, and preview and rolled column agree", () => {
    const s = battle(start(13, 12, 5));
    const n = attackNumbers(CTX, s, [s.units.g!], [s.units.p!], "M33");
    expect(n.attackFactors).toBe(12);
    expect(n.defenseFactors).toBe(3);
    expect(n.dasFactors).toBe(5);
    expect(n.column).toBe("1-1");
    expect(n.multiplier).toBe(2);
    const preview = attackPreview(CTX, s, "M33", ["g"]);
    expect(preview.numbers?.defenseTotal).toBe(11);
    expect(preview.numbers?.column).toBe(n.column);
    const done = okOf(applyAction(CTX, s, attack));
    expect(done.events[0]).toMatchObject({ type: "COMBAT_RESOLVED", defenseFactors: 3, dasFactors: 5,
      rounds: [expect.objectContaining({ column: n.column })] });
    expect(describeEvent(done.events[0]!, CTX, new Set(), new Map(), s)).toContain("+ 5 defensive air");
    expect(dasOf(done.state)).toEqual({});
  });

  it("C4: counterattacks use basic ground plus DAS and repeated attacks retain original totals", () => {
    const n = { attackFactors: 12, defenseBasicFactors: 3, defenseMultiplier: 2, defenseExtraFactors: 5 };
    // Ref 12.2 / 20.51: seed 9 starts with CA at 1-1, then counterattacks at 1-2 (8 vs 12).
    const result = resolveOffensiveCombat(n, 9);
    expect(result.rounds[0]).toMatchObject({ result: "CA", column: "1-1" });
    expect(result.rounds[1]).toMatchObject({ by: "defender", column: "1-2" });
    for (const r of result.rounds.filter((r) => r.by === "attacker")) expect(r.column).toBe("1-1");
  });

  it("R10/C3: readable commitment event is attributed to the defender", () => {
    const d = at7d();
    const e = okOf(applyAction(CTX, d, designate)).events[0]!;
    expect(e).toEqual({ type: "DAS_COMMITTED", side: "allies", hex: "M33", units: ["d"] });
    expect(describeEvent(e, CTX, new Set(), new Map(), d)).toMatch(/British air.*defensive air support.*Poznan/);
    expect(eventSide(e, "axis", d)).toBe("allies");
  });

  it("C1/AER76: old records stay byte-identical, default empty, and computer path stays unchanged", () => {
    const legacy = at7b();
    const before = JSON.stringify(legacy);
    const hash = fingerprint(legacy);
    expect(dasOf(legacy)).toEqual({});
    expect(airOf(legacy).manualDas).toBeUndefined();
    expect(chooseAction(CTX, legacy, { seed: 1 })?.action).toEqual(end("7b"));
    const done = replay(CTX, legacy, [end("7b")]);
    expect(done.state.position).toMatchObject({ step: "7h" });
    expect(done.state.rngState).toBe(legacy.rngState);
    expect(done.state.air?.das).toBeUndefined();
    expect(done.state.air?.manualDas).toBeUndefined();
    expect(done.events).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "DAS_COMMITTED" })]));
    expect(fingerprint(legacy)).toBe(hash);
    expect(JSON.stringify(legacy)).toBe(before);
    const withEmpty = { ...legacy, air: newAirTurn(legacy) };
    expect(replay(CTX, withEmpty, [end("7b")])).toEqual({ ...done, state: { ...done.state, air: withEmpty.air } });
    const c = chooseAction(CTX, done.state, { seed: 1 });
    expect(c?.action.type).not.toBe("DESIGNATE_DAS");
  });

  it("R15/C1: JSON replay is deterministic and does not mutate its initial state", () => {
    const initial = setManualDas(start(), true);
    const before = JSON.stringify(initial);
    const actions = [end("6f"), end("7b"), designate, end("7d", "allies"), end("7e"), attack];
    expect(replay(CTX, initial, actions)).toEqual(replay(CTX, JSON.parse(before) as GameState, JSON.parse(JSON.stringify(actions)) as Action[]));
    expect(JSON.stringify(initial)).toBe(before);
  });

  it("R10/C1: unused DAS survives, stays flown, and expires at a new Player Turn", () => {
    const h = battle();
    const done = okOf(applyAction(CTX, h, end("7h"))).state;
    expect(done.units.d).toEqual(h.units.d);
    expect(hasFlown(done, "d")).toBe(true);
    const next = { ...done, activeSide: "allies" as const };
    expect(dasOf(next)).toEqual({});
    expect(airOf(next).manualDas).toBeUndefined();
    expect(hasFlown(next, "d")).toBe(true);
  });

  it("AER78: whole counters fit in designation order if ground defense later shrinks", () => {
    const s = committed(start(13, 3, 5));
    const reduced = { ...s, units: { ...s.units, p: { ...s.units.p!, strength: 1 }, e: air("e", "M33", 3) },
      air: { ...airOf(s), das: { M33: ["d", "missing", "g", "e"] } } };
    expect(countedDas(reduced, "M33", 1)).toEqual({ units: [reduced.units.e], factors: 3 });
  });

  it("R10/AER78: D eliminates supporting planes at their base and clears the target", () => {
    const s = battle(start(13, 60, 3)); // 5-1, seed 13 rolls D.
    const done = okOf(applyAction(CTX, s, attack));
    expect(done.events[0]).toMatchObject({ outcome: "defender-eliminated" });
    expect(done.state.units.d).toBeUndefined();
    expect(done.state.units.p).toBeUndefined();
    expect(dasOf(done.state)).toEqual({});
  });

  it("AER78/C4: Exchange allocates deterministically at basic air value, without an owner prompt", () => {
    const s = battle(start(7, 3, 3)); // 1-3, seed 7 rolls Ex: defense 9 beats attack 3.
    const done = okOf(applyAction(CTX, s, attack));
    expect(done.events[0]).toMatchObject({ outcome: "exchange" });
    expect(combatOf(done.state).pending).toBeNull();
    expect(done.state.units.g).toBeUndefined();
    expect(done.state.units.d).toBeUndefined(); // lexical first sufficient set: d's 3 basic air
    expect(done.state.units.p).toBeDefined();
    expect(done.events).toContainEqual(expect.objectContaining({ type: "UNIT_ELIMINATED", unitId: "d" }));
    expect(dasOf(done.state)).toEqual({});
    const reversed = { ...s, units: Object.fromEntries(Object.entries(s.units).reverse()) };
    expect(applyAction(CTX, reversed, attack)).toEqual(done);
  });

  it("C1: restores an old save without introducing DAS fields or changing its fingerprint", async () => {
    const old = newGame(CTX.scenario, 13);
    const before = JSON.stringify(old);
    const saved = JSON.parse(before) as JsonObject;
    const save: SaveFile = { format: 2, app: "3reich", title: "Before DAS",
      savedAt: "2026-11-09T00:00:00.000Z", gameVersion: "old", stateVersion: 1,
      scenario: CTX.scenario.id, seed: 13, humanSide: "axis", start: { kind: "snapshot", state: saved },
      actions: [], setupActions: 0, snapshot: saved, fingerprint: fingerprint(old) };
    const opened = await restore(JSON.stringify(save), CTX, { now: () => 0,
      yield: async () => {}, cancelled: () => false, validateSnapshot: createSnapshotValidator() });
    if (opened.kind !== "opened") throw Error(opened.message);
    expect(JSON.stringify(opened.state)).toBe(before);
    expect(fingerprint(opened.state)).toBe(save.fingerprint);
    expect(dasOf(opened.state)).toEqual({});
    expect(opened.state.air).toBeUndefined();
  });

  it("Ref 20.51/AER78: two basic air factors cannot pay a three-factor Exchange debt", () => {
    const s = battle(start(7, 3, 2));
    const done = okOf(applyAction(CTX, s, attack));
    expect(done.events[0]).toMatchObject({ outcome: "exchange" });
    expect(done.state.units.d).toBeDefined();
    expect(done.state.units.p).toBeUndefined();
    expect(combatOf(done.state).pending).toBeNull();
    expect(dasOf(done.state)).toEqual({});
  });

  it("C4/AER78: attacking side matches terrain ground plus basic DAS in an Exchange", () => {
    const s = battle(start(7, 12, 3)); // 1-1, seed 7: Ex; defenders cost 6 + 3.
    const done = okOf(applyAction(CTX, s, attack));
    expect(done.events[0]).toMatchObject({ outcome: "exchange" });
    expect(done.state.units.g).toBeUndefined();
    expect(done.state.units.p).toBeUndefined();
    expect(done.state.units.d).toBeUndefined();
    expect(combatOf(done.state).pending).toBeNull();
  });

  it("R10: GS and DAS add to their own sides without an air-combat roll", () => {
    const b = at7b(setManualDas(start(13, 12, 5), true));
    const gs = okOf(applyAction(CTX, b, { type: "DESIGNATE_AIR", side: "axis", mission: "ground-support", units: ["a"], target: "M33" })).state;
    const d = okOf(applyAction(CTX, gs, end("7b"))).state;
    const both = okOf(applyAction(CTX, d, designate));
    const h = okOf(applyAction(CTX, both.state, end("7d", "allies")));
    const n = attackNumbers(CTX, h.state, [h.state.units.g!], [h.state.units.p!], "M33");
    expect(n.attackFactors).toBe(15);
    expect(n.airFactors).toBe(3);
    expect(n.dasFactors).toBe(5);
    expect(h.state.rngState).toBe(13);
    expect([...both.events, ...h.events].some((e) => e.type === "AIR_COMBAT_RESOLVED")).toBe(false);
  });

});
