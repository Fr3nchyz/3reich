import { describe, expect, it } from "vitest";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { isEnemy } from "../src/engine/attack-rules";
import { combatOf } from "../src/engine/combat-record";
import { rollD6 } from "../src/engine/rng";
import type { ForceOwner, GameState, Unit, UnitType } from "../src/engine/types";
import { CTX, atStart } from "./helpers";
import { SCENARIO_1939 } from "../src/data/scenario-1939";

/** Spec 04 ground combat: stacking on advance (Ref 5.0, 26.0), malformed actions, minor forces, Replacement counters, turn progression. */

const unit = (id: string, owner: ForceOwner, type: UnitType, strength: number, at: string): Unit => ({ id, owner, type, strength, at });
const at7h = (units: Unit[], seed = 1, extra: Partial<GameState> = {}): GameState => ({
  ...atStart(SCENARIO_1939, 1),
  activeSide: "axis",
  position: { part: "player-turn", turn: 1, step: "7h" },
  units: Object.fromEntries(units.map((u) => [u.id, u])),
  rngState: seed,
  ...extra,
});
const ok = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const seedRolling = (n: number) => {
  for (let seed = 1; seed < 10000; seed++) if (rollD6(seed).roll === n) return seed;
  throw new Error("no seed");
};

describe("advancing into a hex keeps the stacking rules of setup", () => {
  // Fall 1939: the Allies attack M33 from M32 (French) and N32 (British) and win (3+3 against 1x2: 3-1, a 6 is D).
  const won = (extra: Partial<GameState> = {}) =>
    ok(applyAction(CTX, at7h([unit("fr", "france", "infantry", 3, "M32"), unit("br", "britain", "infantry", 3, "N32"), unit("de", "germany", "infantry", 1, "M33")], seedRolling(6), { activeSide: "allies", ...extra }), { type: "ATTACK", side: "allies", units: ["fr", "br"], target: "M33" })).state;

  it("refuses British and French together in the hex before 1942, and does not list it", () => {
    const s = won();
    expect(applyAction(CTX, s, { type: "ADVANCE", side: "allies", units: ["fr", "br"], to: "M33" })).toMatchObject({ ok: false, error: expect.stringMatching(/British and French/) });
    const advances = legalActions(CTX, s).filter((a) => a.type === "ADVANCE");
    expect(advances).toEqual([
      { type: "ADVANCE", side: "allies", units: ["fr"], to: "M33" },
      { type: "ADVANCE", side: "allies", units: ["br"], to: "M33" },
    ]);
    expect(applyAction(CTX, s, advances[0] as Action)).toMatchObject({ ok: true });
  });

  it("allows them together from 1942 on", () => {
    const s = won({ year: 1942, season: "spring" });
    expect(applyAction(CTX, s, { type: "ADVANCE", side: "allies", units: ["fr", "br"], to: "M33" })).toMatchObject({ ok: true });
  });
});

describe("a recorded action that is malformed is refused, never thrown", () => {
  const s = at7h([unit("g1", "germany", "infantry", 3, "M32"), unit("p1", "poland", "infantry", 1, "M33")]);
  const bad = (a: unknown) => applyAction(CTX, s, a as Action);
  it("names a target that is not an own property of the map", () => {
    for (const target of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(bad({ type: "ATTACK", side: "axis", units: ["g1"], target })).toMatchObject({ ok: false });
    }
    expect(bad({ type: "ATTACK", side: "axis", units: ["g1"], target: 5 })).toMatchObject({ ok: false });
  });
  it("names units that are not a list of own unit ids", () => {
    expect(bad({ type: "ATTACK", side: "axis", units: "g1", target: "M33" })).toMatchObject({ ok: false });
    expect(bad({ type: "ATTACK", side: "axis", units: undefined, target: "M33" })).toMatchObject({ ok: false });
    expect(bad({ type: "ATTACK", side: "axis", units: [7], target: "M33" })).toMatchObject({ ok: false });
    for (const id of ["__proto__", "constructor", "toString"]) expect(bad({ type: "ATTACK", side: "axis", units: [id], target: "M33" })).toMatchObject({ ok: false });
  });
  it("gives losses or advances that are not lists", () => {
    expect(bad({ type: "ALLOCATE_LOSSES", side: "axis", units: "g1" })).toMatchObject({ ok: false });
    expect(bad({ type: "ADVANCE", side: "axis", units: "g1", to: "M33" })).toMatchObject({ ok: false });
    const won = ok(applyAction(CTX, at7h([unit("g1", "germany", "infantry", 6, "M32"), unit("p1", "poland", "infantry", 1, "M33")], seedRolling(6)), { type: "ATTACK", side: "axis", units: ["g1"], target: "M33" })).state;
    expect(applyAction(CTX, won, { type: "ADVANCE", side: "axis", units: "g1" as unknown as string[], to: "M33" })).toMatchObject({ ok: false });
    expect(applyAction(CTX, won, { type: "ADVANCE", side: "axis", units: ["__proto__"], to: "M33" })).toMatchObject({ ok: false });
    expect(applyAction(CTX, won, { type: "ADVANCE", side: "axis", units: ["g1"], to: "__proto__" })).toMatchObject({ ok: false });
  });
});

describe("who is at war when minor forces are involved", () => {
  const base = atStart(SCENARIO_1939, 1);
  const withStatus = (statuses: Partial<Record<"italy" | "ussr", "axis" | "allied" | "neutral">>, wars: GameState["wars"] = []): GameState => ({
    ...base,
    nations: { ...base.nations, ...Object.fromEntries(Object.entries(statuses).map(([k, v]) => [k, { ...base.nations[k as "italy"], status: v }])) },
    wars: [...base.wars, ...wars],
  });
  it("a minor force fights the enemies of the Major Powers on its side", () => {
    const s = withStatus({ italy: "axis" }, [["italy", "france"]]);
    expect(isEnemy(s, "poland", "italy")).toBe(true); // France (its side) is at war with Italy
    expect(isEnemy(s, "italy", "poland")).toBe(true);
    expect(isEnemy(s, "poland", "finland")).toBe(true); // Britain and France are at war with Germany, Finland is on its side
    expect(isEnemy(s, "poland", "free-france")).toBe(false); // same side
  });
  it("a neutral Major Power is nobody's enemy", () => {
    expect(isEnemy(base, "poland", "italy")).toBe(false); // Italy is neutral in 1939
    expect(isEnemy(base, "poland", "ussr")).toBe(false);
    expect(isEnemy(base, "italy", "britain")).toBe(false);
  });
  it("a Major Power in the war needs a war with the other Major Power itself", () => {
    const s = withStatus({ italy: "axis" });
    expect(isEnemy(s, "italy", "britain")).toBe(false); // Italy has declared on nobody
    expect(isEnemy(withStatus({ italy: "axis" }, [["italy", "britain"]]), "italy", "britain")).toBe(true);
  });
});

describe("Replacement counters (Ref 12.1: they attack only as part of a Counterattack, which is not built)", () => {
  it("defend but do not attack", () => {
    const a = at7h([unit("r1", "germany", "replacement", 1, "M32"), unit("p1", "poland", "infantry", 1, "M33")]);
    expect(legalActions(CTX, a).some((x) => x.type === "ATTACK")).toBe(false);
    expect(applyAction(CTX, a, { type: "ATTACK", side: "axis", units: ["r1"], target: "M33" })).toMatchObject({ ok: false });
    const d = at7h([unit("g1", "germany", "infantry", 3, "M32"), unit("p1", "poland", "replacement", 1, "M33")]);
    expect(legalActions(CTX, d).some((x) => x.type === "ATTACK")).toBe(true);
  });
  it("a Replacement stacked with an infantry unit does not join its attack", () => {
    const s = at7h([unit("g1", "germany", "infantry", 3, "M32"), unit("r1", "germany", "replacement", 1, "M32"), unit("p1", "poland", "infantry", 1, "M33")]);
    expect(applyAction(CTX, s, { type: "ATTACK", side: "axis", units: ["g1", "r1"], target: "M33" })).toMatchObject({ ok: false });
    expect(applyAction(CTX, s, { type: "ATTACK", side: "axis", units: ["g1"], target: "M33" })).toMatchObject({ ok: true });
  });
  it("air units and airbases alone are not fought on the ground: the attack is a sweep with no roll (tests/lone-units.test.ts)", () => {
    const s = at7h([unit("g1", "germany", "infantry", 3, "M32"), unit("a1", "poland", "air", 3, "M33"), unit("b1", "poland", "airbase", 1, "M33")]);
    const r = ok(applyAction(CTX, s, { type: "ATTACK", side: "axis", units: ["g1"], target: "M33" }));
    expect(r.events.find((e) => e.type === "COMBAT_RESOLVED")).toMatchObject({ rounds: [], defenseFactors: 0, outcome: "defender-eliminated" });
  });
});

describe("the combat record across real turns", () => {
  it("is dropped when the Player Turn changes: next turn the same units may attack again", () => {
    const start = at7h([unit("g1", "germany", "infantry", 6, "M32"), unit("p1", "poland", "infantry", 1, "M33")], seedRolling(6));
    const after = ok(applyAction(CTX, start, { type: "ATTACK", side: "axis", units: ["g1"], target: "M33" })).state;
    expect(combatOf(after)).toMatchObject({ attacked: ["g1"], targets: ["M33"] });
    // Play on, moving past every step, until the Axis is up again in a later Game Turn.
    let s = after;
    for (let guard = 0; guard < 400 && !(s.season !== "fall" && s.activeSide === "axis" && s.position?.part === "player-turn" && s.position.step === "8b"); guard++) {
      s = ok(applyAction(CTX, s, legalActions(CTX, s).at(-1)!)).state;
    }
    expect(s.season).not.toBe("fall");
    expect(s.combat?.turn).not.toBe(`${s.year}-${s.season}-${s.activeSide}`); // the stored record is stale...
    expect(combatOf(s)).toMatchObject({ attacked: [], targets: [], pending: null, advances: [] }); // ...and not used
    // A Polish unit appears again at M33; g1 (if it is still at M32) can attack it, which a stale record would forbid.
    const again = { ...s, units: { ...s.units, p2: unit("p2", "poland", "infantry", 1, "M33"), g1: { ...s.units.g1!, at: "M32" } }, position: { part: "player-turn" as const, turn: 1 as const, step: "7h" } };
    expect(legalActions(CTX, again).filter((a) => a.type === "ATTACK")).toEqual([{ type: "ATTACK", side: "axis", units: ["g1"], target: "M33" }]);
  });
});
