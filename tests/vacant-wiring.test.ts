import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions } from "../src/engine/actions";
import { ACTION_FIELDS } from "../src/save/format";
import { combatOf } from "../src/engine/combat-record";
import { exploitOf } from "../src/engine/exploit-record";
import { movesOf } from "../src/engine/move-record";
import type { GameState, Unit } from "../src/engine/types";
import { CTX, atStart } from "./helpers";

// Spec 16 R16, ticket 16-14b: VACANT_HEX_ATTACK at step 7h. Real map: M32 is German, M31 next to it; L31 is next to M31.
const ARM = (id: string, at = "M32"): Unit => ({ id, at, owner: "germany", type: "armor", strength: 4 });
const INF = (id: string, at = "M32"): Unit => ({ id, at, owner: "germany", type: "infantry", strength: 3 });

function at7h(extra: Unit[] = [], step = "7h"): GameState {
  const s = atStart(SCENARIO_1939, 1);
  const units = [ARM("a"), INF("b"), ARM("r", "M33"), ...extra];
  s.units = Object.fromEntries(units.map((u) => [u.id, u]));
  s.activeSide = "axis";
  s.position = { part: "player-turn", turn: 1, step };
  s.control = Object.fromEntries(Object.values(CTX.map.hexes).filter((h) => h.land).map((h) => [h.id, "germany" as const]));
  s.control.M31 = "poland";
  s.frontOptions = { [CTX.map.hexes.M31!.front]: { option: "offensive" } };
  return s;
}
const go = (s: GameState, units = ["a"], target = "M31") => applyAction(CTX, s, { type: "VACANT_HEX_ATTACK", side: "axis", units, target });
const ok = (r: ReturnType<typeof go>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("spec 16 R16 (16-14b): the vacant-hex attack action", () => {
  const base = at7h();
  const win = ok(go(base, ["a", "b"]));
  it("armor advances alone, takes control, uses all attackers and the hex, with no die rolled", () => {
    expect(win.state.units.a!.at).toBe("M31");
    expect(win.state.units.b!.at).toBe("M32");
    expect(win.state.control.M31).toBe("germany");
    expect(combatOf(win.state).attacked).toEqual(["a", "b"]);
    expect(combatOf(win.state).targets).toEqual(["M31"]);
    expect(movesOf(win.state).moved).toContain("a");
    expect(win.state.rngState).toBe(base.rngState);
    expect(win.events.map((e) => e.type)).toEqual(expect.arrayContaining(["VACANT_HEX_ATTACKED", "UNITS_ADVANCED", "BREAKTHROUGH"]));
  });
  it("makes a Breakthrough hex that armor may move into", () => {
    expect(exploitOf(win.state).groups).toMatchObject([{ hex: "M31", from: ["M32"], placeable: ["r"] }]);
    expect(legalActions(CTX, win.state)).toContainEqual({ type: "PLACE_EXPLOITERS", side: "axis", hex: "M31", units: ["r"] });
  });
  it("is not listed in legalActions, so the computer never makes it", () => {
    expect(legalActions(CTX, base).some((a) => (a.type as string) === "VACANT_HEX_ATTACK")).toBe(false);
  });
  it("an enemy next to the hex allows the attack but records no Breakthrough", () => {
    const s = at7h([{ id: "e", at: "L31", owner: "poland", type: "infantry", strength: 1 }]);
    const r = ok(go(s));
    expect(r.state.units.a!.at).toBe("M31");
    expect(exploitOf(r.state).groups).toEqual([]);
    expect(r.events.some((e) => e.type === "BREAKTHROUGH")).toBe(false);
    expect(r.events.find((e) => e.type === "VACANT_HEX_ATTACKED")).toMatchObject({ breakthrough: false });
  });
  it("refuses an occupied hex, a second attack on the hex, non-armor leaders and the wrong step or side", () => {
    expect(go(at7h([{ id: "e", at: "M31", owner: "poland", type: "air", strength: 1 }]))).toMatchObject({ ok: false });
    expect(go(win.state, ["r"], "M31")).toMatchObject({ ok: false });
    expect(go(base, ["b"])).toMatchObject({ ok: false, error: expect.stringMatching(/armor/) });
    expect(go(at7h([], "7j"))).toMatchObject({ ok: false });
    expect(applyAction(CTX, base, { type: "VACANT_HEX_ATTACK", side: "allies", units: ["a"], target: "M31" })).toMatchObject({ ok: false });
    expect(go(base, ["a"], "nowhere")).toMatchObject({ ok: false });
    expect(go(base, "x" as unknown as string[])).toMatchObject({ ok: false });
  });
  it("the advance obeys the ordinary advance rules (stacking)", () => {
    const crowd = Array.from({ length: 6 }, (_, i) => INF(`f${i}`, "M31")).map((u) => ({ ...u, owner: "germany" as const }));
    const s = at7h();
    s.units = { ...s.units, ...Object.fromEntries(crowd.map((u) => [u.id, u])) };
    // Six friendly counters already stand in M31, so the armor cannot advance in under the stacking limit.
    expect(go(s)).toMatchObject({ ok: false });
  });
  it("a target with no supply line allows the attack but records no Breakthrough", () => {
    const s = at7h();
    s.fortresses.M32 = true;
    for (const h of Object.keys(s.control)) if (h !== "M32") s.control[h] = "poland";
    const r = ok(go(s));
    expect(r.state.units.a!.at).toBe("M31");
    expect(exploitOf(r.state).groups).toEqual([]);
  });
  it("the Anglo-French stop bars a British advance into Paris", () => {
    const s = at7h();
    s.activeSide = "allies";
    s.units = { br: { id: "br", at: "O21", owner: "britain", type: "armor", strength: 4 } };
    for (const h of Object.keys(s.control)) s.control[h] = "britain";
    s.control.O22 = "germany";
    s.frontOptions = { [CTX.map.hexes.O22!.front]: { option: "offensive" } };
    const r = applyAction(CTX, s, { type: "VACANT_HEX_ATTACK", side: "allies", units: ["br"], target: "O22" });
    expect(r.ok ? "ok" : r.error).toMatch(/British units may not stop/);
    expect(r.ok).toBe(false);
  });
  it("France's limits while Paris is Axis-held apply (not adjacent to Paris)", () => {
    const s = at7h();
    s.activeSide = "allies";
    s.units = { fr: { id: "fr", at: "M32", owner: "france", type: "armor", strength: 4 } };
    for (const h of Object.keys(s.control)) s.control[h] = "france";
    s.control.O22 = "germany";
    s.control.M31 = "germany";
    s.frontOptions = { [CTX.map.hexes.M31!.front]: { option: "offensive" } };
    const r = applyAction(CTX, s, { type: "VACANT_HEX_ATTACK", side: "allies", units: ["fr"], target: "M31" });
    expect(r.ok ? "ok" : r.error).toMatch(/Paris|adjacent|odds|supply/i);
  });
  it("the action survives a JSON (save) round trip and the field list names its fields", () => {
    const a = JSON.parse(JSON.stringify({ type: "VACANT_HEX_ATTACK", side: "axis", units: ["a", "b"], target: "M31" })) as Parameters<typeof applyAction>[2];
    expect(ACTION_FIELDS.VACANT_HEX_ATTACK).toBe("side units target");
    const r = applyAction(CTX, at7h(), a);
    expect(r.ok && r.state).toEqual(win.state);
  });
});
