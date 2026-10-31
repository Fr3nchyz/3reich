import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { chooseAction } from "../src/ai/choose";
import { applyAction, legalActions, type Action, type GameEvent } from "../src/engine/actions";
import { applyOutcome } from "../src/engine/attack-losses";
import { placeableArmor } from "../src/engine/breakthrough";
import { combatOf, turnKey } from "../src/engine/combat-record";
import { exploitOf, exploiterIds, type ExploitRecord } from "../src/engine/exploit-record";
import { movesOf } from "../src/engine/move-record";
import { advance, settle } from "../src/engine/turn";
import type { ForceOwner, GameState, Unit, UnitType } from "../src/engine/types";
import { CTX, atStart } from "./helpers";

/**
 * Spec 16 R10, R11 (Ref 12.31; Ops 5.46h), ticket 16-9: a won attack with armor in it, advanced into, makes a Breakthrough hex, and armor that stood in or
 * next to the attackers' hexes may move in free until step 7h is left. Real map: M32 and N32 are German hexes next to Poznan (M33, Polish); M31 is next to
 * M32 only, O32 next to N32 only, K30 next to neither.
 */

const unit = (id: string, owner: ForceOwner, type: UnitType, strength: number, at: string): Unit => ({ id, owner, type, strength, at });
const ARM = (id: string, at: string, strength = 4) => unit(id, "germany", "armor", strength, at);
const INF = (id: string, at: string, strength = 3) => unit(id, "germany", "infantry", strength, at);
const POL = (id: string, at: string, strength = 1) => unit(id, "poland", "infantry", strength, at);

function at7h(units: Unit[], seed = 1, extra: Partial<GameState> = {}): GameState {
  return { ...atStart(SCENARIO_1939, 1), activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7h" }, units: Object.fromEntries(units.map((u) => [u.id, u])), rngState: seed, ...extra };
}
const ok = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const act = (s: GameState, a: Action) => applyAction(CTX, s, a);
const place = (s: GameState, units: string[], hex = "M33") => act(s, { type: "PLACE_EXPLOITERS", side: "axis", hex, units });
const placements = (s: GameState) => legalActions(CTX, s).filter((a) => a.type === "PLACE_EXPLOITERS");
const ofType = <T extends GameEvent["type"]>(events: GameEvent[], type: T) => events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** The first seed whose attack by `attackers` on M33 eliminates the defenders, and the state after it. */
function won(units: Unit[], attackers: string[]): GameState {
  for (let seed = 1; seed < 500; seed++) {
    const r = act(at7h(units, seed), { type: "ATTACK", side: "axis", units: attackers, target: "M33" });
    if (r.ok && r.events.some((e) => e.type === "COMBAT_RESOLVED" && e.outcome === "defender-eliminated")) return r.state;
  }
  throw new Error("no seed wins");
}

// The attackers: armor a1 and infantry g1 at M32, infantry g2 at N32. Candidates: a2 at M31 (next to M32), a3 at M32 (stacked with an attacker, did not attack),
// a4 at O32 (next to N32), far at K30 (next to neither), i9 an infantry at M31 (not armor).
const BASE = [ARM("a1", "M32"), INF("g1", "M32"), INF("g2", "N32"), POL("p1", "M33"), ARM("a2", "M31"), ARM("a3", "M32", 3), ARM("a4", "O32"), ARM("far", "K30"), INF("i9", "M31")];
const afterWin = (attackers = ["a1", "g1", "g2"]) => won(BASE, attackers);
const advanced = (s: GameState, units = ["g1"]) => ok(act(s, { type: "ADVANCE", side: "axis", units, to: "M33" }));

describe("R10: the Breakthrough", () => {
  it("a won attack with armor in it records the armor and the attackers' hexes with the advance chance", () => {
    expect(combatOf(afterWin()).advances).toEqual([{ to: "M33", units: ["a1", "g1", "g2"], armor: true, from: ["M32", "N32"] }]);
  });

  it("the advance makes the hex a Breakthrough hex, and lists the armor that may move in", () => {
    const r = advanced(afterWin());
    expect(ofType(r.events, "BREAKTHROUGH")).toEqual([{ type: "BREAKTHROUGH", side: "axis", hex: "M33", placeable: ["a2", "a3", "a4"] }]);
    expect(exploitOf(r.state).groups).toEqual([{ hex: "M33", from: ["M32", "N32"], placeable: ["a2", "a3", "a4"], placed: [], moved: {}, attacked: [] }]);
  });

  it("an attack with no armor makes no Breakthrough", () => {
    const s = won(BASE, ["g1", "g2"]);
    expect(combatOf(s).advances[0]).toEqual({ to: "M33", units: ["g1", "g2"] });
    const r = advanced(s);
    expect(ofType(r.events, "BREAKTHROUGH")).toEqual([]);
    expect(r.state.exploit).toBeUndefined();
    expect(placements(r.state)).toEqual([]);
  });

  it("no advance, no Breakthrough: the chance alone opens nothing", () => {
    const s = afterWin();
    expect(s.exploit).toBeUndefined();
    expect(placements(s)).toEqual([]);
  });

  it("the armor need not survive (AER12): an Exchange that costs the armor still makes a Breakthrough of the infantry's advance", () => {
    const s = at7h([ARM("a1", "M32", 2), INF("g1", "M32"), POL("p1", "M33", 2), ARM("a2", "M31")]);
    const units = (ids: string[]) => ids.map((id) => s.units[id]!);
    const marked = { ...s, combat: { ...combatOf(s), attacked: ["a1", "g1"], targets: ["M33"] } };
    const out = applyOutcome(CTX, marked, { outcome: { kind: "exchange", multipliedDefense: true }, side: "axis", target: "M33", attackers: units(["a1", "g1"]), defenders: units(["p1"]), multiplier: 1 });
    expect(combatOf(out.state).pending?.chooser).toBe("axis");
    const lost = ok(act(out.state, { type: "ALLOCATE_LOSSES", side: "axis", units: ["a1"] }));
    expect(combatOf(lost.state).advances).toEqual([{ to: "M33", units: ["g1"], armor: true, from: ["M32"] }]);
    expect(ofType(advanced(lost.state).events, "BREAKTHROUGH")).toHaveLength(1);
  });

  it("an attack on a hex with only air units (a sweep: the vacant-hex case of R16, ticket 16-14) makes no Breakthrough", () => {
    const s = at7h([ARM("a1", "M32"), unit("air", "poland", "air", 1, "M33"), ARM("a2", "M31")]);
    const r = ok(act(s, { type: "ATTACK", side: "axis", units: ["a1"], target: "M33" }));
    expect(combatOf(r.state).advances).toEqual([{ to: "M33", units: ["a1"] }]);
    expect(ofType(advanced(r.state, ["a1"]).events, "BREAKTHROUGH")).toEqual([]);
  });

  it("an advance chance saved before this ticket (no armor mark) makes no Breakthrough (B3)", () => {
    const s = at7h([INF("g1", "M32"), ARM("a2", "M31")]);
    const old = { ...s, combat: { ...combatOf(s), attacked: ["g1"], targets: ["M33"], advances: [{ to: "M33", units: ["g1"] }] } };
    const r = advanced(old);
    expect(r.state.exploit).toBeUndefined();
    expect(exploitOf(r.state).groups).toEqual([]);
  });
});

describe("R11: armor that moves in", () => {
  it("the placements listed: all the armor together, then each unit alone; move-on stays last", () => {
    const legal = legalActions(CTX, advanced(afterWin()).state);
    expect(legal.filter((a) => a.type === "PLACE_EXPLOITERS")).toEqual([
      { type: "PLACE_EXPLOITERS", side: "axis", hex: "M33", units: ["a2", "a3", "a4"] },
      { type: "PLACE_EXPLOITERS", side: "axis", hex: "M33", units: ["a2"] },
      { type: "PLACE_EXPLOITERS", side: "axis", hex: "M33", units: ["a3"] },
      { type: "PLACE_EXPLOITERS", side: "axis", hex: "M33", units: ["a4"] },
    ]);
    expect(legal.at(-1)).toEqual({ type: "END_STEP", side: "axis", step: "7h" });
  });

  it("armor that attacked, armor next to no attacker's hex and an infantry unit cannot be placed, with the reason", () => {
    const s = advanced(afterWin()).state;
    expect(place(s, ["a1"])).toMatchObject({ ok: false, error: expect.stringMatching(/attacked/) });
    expect(place(s, ["far"])).toMatchObject({ ok: false, error: expect.stringMatching(/not in or next to/) });
    expect(place(s, ["i9"])).toMatchObject({ ok: false, error: expect.stringMatching(/armor/) });
    expect(place(s, ["p1"])).toMatchObject({ ok: false, error: expect.stringMatching(/not on the map|armor/) });
    expect(place(s, ["a2", "a2"])).toMatchObject({ ok: false });
    expect(place(s, [])).toMatchObject({ ok: false });
  });

  it("placement is free and ignores the stacking limit; the units become exploiters and count as having moved (AER13)", () => {
    const s = advanced(afterWin()).state;
    const r = ok(place(s, ["a2", "a3", "a4"]));
    for (const id of ["a2", "a3", "a4"]) expect(r.state.units[id]!.at).toBe("M33");
    expect(Object.values(r.state.units).filter((u) => u.at === "M33")).toHaveLength(4); // g1 and three armor: over the limit of two
    expect(ofType(r.events, "EXPLOITERS_PLACED")).toEqual([{ type: "EXPLOITERS_PLACED", side: "axis", units: ["a2", "a3", "a4"], from: ["M31", "M32", "O32"], hex: "M33" }]);
    expect(exploiterIds(r.state)).toEqual(["a2", "a3", "a4"]);
    expect(movesOf(r.state).moved).toEqual(expect.arrayContaining(["a2", "a3", "a4"]));
    expect(placements(r.state)).toEqual([]);
    expect(place(r.state, ["a2"])).toMatchObject({ ok: false, error: expect.stringMatching(/already/) });
  });

  it("units may be placed one at a time; the rest stay offered", () => {
    const r = ok(place(advanced(afterWin()).state, ["a3"]));
    expect(placements(r.state)[0]).toEqual({ type: "PLACE_EXPLOITERS", side: "axis", hex: "M33", units: ["a2", "a4"] });
    expect(exploitOf(r.state).groups[0]!.placed).toEqual(["a3"]);
  });

  it("a placed unit takes no part in ordinary combat at 7h (AER13)", () => {
    const s = ok(place(advanced(afterWin()).state, ["a2"])).state;
    const withEnemy = { ...s, units: { ...s.units, p2: POL("p2", "M34") } };
    expect(legalActions(CTX, withEnemy).filter((a) => a.type === "ATTACK").flatMap((a) => (a.type === "ATTACK" ? a.units : []))).not.toContain("a2");
    expect(act(withEnemy, { type: "ATTACK", side: "axis", units: ["a2"], target: "M34" })).toMatchObject({ ok: false, error: expect.stringMatching(/Breakthrough/) });
  });

  it("armor that attacks after the Breakthrough can no longer be placed", () => {
    const s = advanced(afterWin()).state;
    const withEnemy = { ...s, units: { ...s.units, p2: POL("p2", "L32") } };
    const r = ok(act(withEnemy, { type: "ATTACK", side: "axis", units: ["a2"], target: "L32" }));
    expect(placeableArmor(CTX, r.state, exploitOf(r.state).groups[0]!)).not.toContain("a2");
  });

  it("refuses the other side, a hex that is no Breakthrough, the wrong step and a pending Exchange", () => {
    const s = advanced(afterWin()).state;
    expect(act(s, { type: "PLACE_EXPLOITERS", side: "allies", hex: "M33", units: ["a2"] })).toMatchObject({ ok: false });
    expect(place(s, ["a2"], "M32")).toMatchObject({ ok: false, error: expect.stringMatching(/not a Breakthrough/) });
    expect(place({ ...s, position: { part: "player-turn", turn: 1, step: "7j" } }, ["a2"])).toMatchObject({ ok: false });
    const pending = { ...s, combat: { ...combatOf(s), pending: { chooser: "axis" as const, target: "N33", candidates: ["g2"], values: { g2: 3 }, required: 1, attackers: ["g2"] } } };
    expect(place(pending, ["a2"])).toMatchObject({ ok: false, error: expect.stringMatching(/Exchange/) });
  });

  it("with the supply effects on, armor out of supply cannot be placed; with them off nothing is checked (R14, AER15)", () => {
    const s = advanced(afterWin()).state;
    const cut = { ...s, minorAllies: [], control: { ...s.control, L31: "poland" as const } }; // Berlin held by the enemy: no German unit is in supply (and no sleeping Axis ally, whose capital would supply them, spec 15 R10)
    const on = { ...CTX, supplyEffects: true };
    expect(placeableArmor(CTX, cut, exploitOf(cut).groups[0]!)).toEqual(["a2", "a3", "a4"]);
    expect(placeableArmor(on, s, exploitOf(s).groups[0]!)).toEqual(["a2", "a3", "a4"]);
    expect(placeableArmor(on, cut, exploitOf(cut).groups[0]!)).toEqual([]);
    expect(applyAction(on, cut, { type: "PLACE_EXPLOITERS", side: "axis", hex: "M33", units: ["a2"] })).toMatchObject({ ok: false, error: expect.stringMatching(/supply/) });
  });
});

describe("step 7h waits for a Breakthrough, and leaving it lapses what was not placed", () => {
  it("7h waits while armor can be placed, though no attack is left", () => {
    const s = at7h([INF("g1", "M33"), ARM("a2", "M31")]);
    const rec: ExploitRecord = { turn: turnKey(s), groups: [{ hex: "M33", from: ["M32"], placeable: ["a2"], placed: [], moved: {}, attacked: [] }] };
    expect(settle(CTX, { ...s, exploit: rec }).state.position).toEqual({ part: "player-turn", turn: 1, step: "7h" });
    expect(settle(CTX, s).state.position).not.toEqual({ part: "player-turn", turn: 1, step: "7h" });
  });

  it("leaving 7h with nothing placed drops the record: the state is as it was before this rule", () => {
    const s = advanced(afterWin()).state;
    const left = advance(CTX, s).state;
    expect(left.exploit).toBeUndefined();
    expect(left.position).toEqual({ part: "player-turn", turn: 1, step: "7i" });
  });

  it("leaving 7h keeps the exploiters and closes the offer", () => {
    const s = ok(place(advanced(afterWin()).state, ["a3"])).state;
    const left = ok(act(s, { type: "END_STEP", side: "axis", step: "7h" })).state;
    expect(left.exploit?.groups).toEqual([{ hex: "M33", from: ["M32", "N32"], placeable: [], placed: ["a3"], moved: {}, attacked: [] }]);
  });

  it("an old saved game has no record and reads as no Breakthrough", () => {
    const s = at7h([INF("g1", "M32")]);
    expect(s.exploit).toBeUndefined();
    expect(exploitOf(s)).toEqual({ turn: turnKey(s), groups: [] });
    expect(exploitOf({ ...s, exploit: { turn: "1900-spring-axis", groups: [{ hex: "M33", from: [], placeable: ["x"], placed: ["x"], moved: {}, attacked: [] }] } }).groups).toEqual([]);
  });

  it("the computer places the armor offered (ticket 16-13), so it does not stall at the step", () => {
    const s = at7h([INF("g1", "M33"), ARM("a2", "M31")]);
    const rec: ExploitRecord = { turn: turnKey(s), groups: [{ hex: "M33", from: ["M32"], placeable: ["a2"], placed: [], moved: {}, attacked: [] }] };
    const d = chooseAction(CTX, { ...s, exploit: rec }, { seed: 1 });
    expect(d?.action).toEqual({ type: "PLACE_EXPLOITERS", side: "axis", hex: "M33", units: ["a2"] });
  });
});
