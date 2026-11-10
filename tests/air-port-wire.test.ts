import { describe, expect, it } from "vitest";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { airOf, hasFlown, markFlown, newAirTurn } from "../src/engine/air-record";
import { portAttacksOf, PORT_ATTACK_STEP, PORT_FLEET_LOSS_ORDER } from "../src/engine/air-port-wire";
import { resolvePortAttack } from "../src/engine/air-port-attack";
import { portCapacity } from "../src/engine/naval-ports";
import { settle } from "../src/engine/turn";
import { newGame } from "../src/engine/game";
import { chooseAction } from "../src/ai/choose";
import { describeEvent } from "../src/ui/eventText";
import { eventSide } from "../src/ui/logSide";
import type { GameContext } from "../src/engine/context";
import type { MapHex } from "../src/engine/map";
import type { GameState, Unit } from "../src/engine/types";
import { fingerprint } from "../src/save/fingerprint";
import type { JsonObject, SaveFile } from "../src/save/format";
import { restore } from "../src/save/restore";
import { createSnapshotValidator } from "../src/save/snapshotInvariants";
import { board, counter } from "./board";
import { CTX, NO_AIRBASES_LEFT } from "./helpers";
import { okOf } from "./helpers-move";

const hexes: Record<string, MapHex> = Object.fromEntries(Array.from({ length: 6 }, (_, n) => {
  const id = `A${n + 1}`;
  return [id, { id, land: "plain", sea: false, country: n === 0 ? "germany" : "britain", front: "western", features: ["port"] }];
}));
const ctx: GameContext = { ...CTX, map: { hexes: { ...CTX.map.hexes, ...hexes }, hexsides: CTX.map.hexsides } };
const plane = (id = "p", strength = 3, at = "A1", owner: Unit["owner"] = "germany") => counter(id, owner, "air", strength, at, 4);
const fleet = (id = "f", strength = 9, at = "A5", owner: Unit["owner"] = "britain") => counter(id, owner, "fleet", strength, at);
const position = (units = [plane(), fleet()], rngState = 13): GameState => board(units, undefined, {
  activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7b" }, rngState,
  airbasesPlaced: NO_AIRBASES_LEFT,
  control: Object.fromEntries(Array.from({ length: 6 }, (_, n) => [`A${n + 1}`, n === 0 ? "germany" : "britain"])),
});
const end = (step: string): Action => ({ type: "END_STEP", side: "axis", step });
const designate = (units = ["p"], target = "A5"): Extract<Action, { type: "DESIGNATE_AIR" }> => ({ type: "DESIGNATE_AIR", side: "axis", mission: "port-attack", units, target });
const resolve: Action = { type: "RESOLVE_PORT_ATTACKS", side: "axis" };
const apply = (s: GameState, a: Action) => okOf(applyAction(ctx, s, a));
const assigned = (s = position()) => apply(s, designate()).state;
const at7i = (s = position()) => apply(assigned(s), end("7b")).state;
const portEvent = (s: GameState) => apply(s, resolve).events.find((e) => e.type === "PORT_ATTACK_RESOLVED")!;

describe("12-15b port attacks through real turn flow (spec 12 R14/R21, AER80–79)", () => {
  it("AER80: leaving 7b stops at 7i only for assigned work; explicit resolution rolls once", () => {
    expect(PORT_ATTACK_STEP).toBe("7i");
    const b = assigned();
    const i = apply(b, end("7b"));
    expect(i.state.position).toMatchObject({ step: "7i" });
    expect(i.state.rngState).toBe(b.rngState);
    expect(i.state.units).toEqual(b.units);
    expect(i.events.some(e => e.type === "PORT_ATTACK_RESOLVED")).toBe(false);
    expect(settle(ctx, i.state).state).toBe(i.state);
    expect(legalActions(ctx, i.state)).toEqual([resolve]);
    expect(applyAction(ctx, i.state, end("7i")).ok).toBe(false);
    const done = apply(i.state, resolve);
    expect(done.state.rngState).not.toBe(b.rngState);
    expect(portAttacksOf(done.state)).toEqual([]);
    expect(legalActions(ctx, done.state)).toEqual([end("7i")]);
    expect(applyAction(ctx, done.state, resolve).ok).toBe(false);
    expect(apply(done.state, end("7i")).state.position).not.toMatchObject({ step: "7i" });
  });

  it("AER80: no queue never lists designation or resolution and keeps computer choice and RNG unchanged", () => {
    const b = position();
    const before = structuredClone(b);
    expect(legalActions(ctx, b)).toEqual([end("7b")]);
    expect(chooseAction(ctx, b, { seed: 1 })?.action).toEqual(end("7b"));
    const done = apply(b, end("7b"));
    expect(done.state.position).not.toMatchObject({ step: "7i" });
    expect(done.events).toContainEqual(expect.objectContaining({ type: "STEPS_PASSED", steps: expect.arrayContaining(["7i"]) }));
    expect(done.state.rngState).toBe(b.rngState);
    expect(done.state.air?.portAttacks).toBeUndefined();
    expect(b).toEqual(before);
    const empty = { ...b, position: { part: "player-turn" as const, turn: 1 as const, step: "7i" } };
    expect(legalActions(ctx, empty)).toEqual([end("7i")]);
    expect(applyAction(ctx, empty, resolve).ok).toBe(false);
    expect(applyAction(ctx, empty, end("7i")).ok).toBe(true);
  });

  it.each(["6f", "7c", "7h", "7i", "7k", "9e"])("R14: designation rejected outside 7b (%s), resolution outside 7i", step => {
    const s = { ...position(), position: { part: "player-turn" as const, turn: 1 as const, step } };
    expect(applyAction(ctx, s, designate()).ok).toBe(false);
    if (step !== "7i") expect(applyAction(ctx, { ...s, air: airOf(assigned()) }, resolve).ok).toBe(false);
    expect(legalActions(ctx, s).some(a => a.type === "RESOLVE_PORT_ATTACKS")).toBe(false);
  });

  it("R14/R19: rejects wrong side, setup, malformed ids/targets, enemy/used planes and illegal ports/range", () => {
    const s = position();
    const before = structuredClone(s);
    const bad = [
      { ...designate(), side: "allies" }, designate([]), designate(["p", "p"]), designate(["missing"]), designate(["f"]),
      designate(["__proto__"]), designate(["p"], "constructor"), designate(["p"], "A1"), designate(["p"], "A6"),
      { ...designate(), units: new Array<string>(1) }, { ...designate(), units: null },
    ] as Action[];
    for (const a of bad) expect(applyAction(ctx, s, a).ok, JSON.stringify(a)).toBe(false);
    expect(applyAction(ctx, { ...s, phase: "setup" }, designate()).ok).toBe(false);
    expect(applyAction(ctx, markFlown(s, ["p"], "new"), designate()).ok).toBe(false);
    expect(applyAction(ctx, position([plane("p", 3, "A5", "britain"), fleet()]), designate()).ok).toBe(false);
    // Spec 12 R19: reuse the permissive ordinary-attack hook, without tightening Options.
    expect(applyAction(ctx, { ...s, frontOptions: { western: { option: "defensive" } } }, designate()).ok).toBe(true);
    expect(applyAction(ctx, { ...s, units: { p: s.units.p! } }, designate()).ok).toBe(false);
    expect(applyAction(ctx, at7i(), { ...resolve, side: "allies" }).ok).toBe(false);
    expect(s).toEqual(before);
  });

  it("R14/AER68/AER83: designation consumes mission, aggregates in order, forbids reuse and reshaping", () => {
    const s = position([plane(), plane("q", 2), fleet()]);
    const first = assigned(s);
    expect(hasFlown(first, "p")).toBe(true);
    expect(first.airFlown!.units.p).toBe("port-attack");
    expect(applyAction(ctx, first, designate()).ok).toBe(false);
    const second = apply(first, designate(["q"]));
    expect(portAttacksOf(second.state)).toEqual([{ target: "A5", units: ["p", "q"] }]);
    for (const a of [
      { type: "DESIGNATE_AIR", side: "axis", mission: "ground-support", units: ["p"], target: "A5" },
      { type: "SPLIT_AIR", side: "axis", unit: "p", parts: [2, 1] },
      { type: "COMBINE_AIR", side: "axis", units: ["p", "q"] },
    ] as Action[]) expect(applyAction(ctx, first, a).ok).toBe(false);
    expect(second.events).toEqual([{ type: "AIR_MISSION_DESIGNATED", mission: "port-attack", units: ["q"], target: "A5" }]);
    const nextTurn = { ...second.state, activeSide: "allies" as const };
    expect(portAttacksOf(nextTurn)).toEqual([]);
    expect(hasFlown(nextTurn, "p")).toBe(true);
  });

  it("R14/AER81: unused based air blocks ships without dice; nearby or previously used air does not defend", () => {
    const s = position([plane(), fleet(), plane("d", 3, "A5", "britain")]);
    expect(portEvent(at7i(s))).toMatchObject({ status: "counter-air-blocked", rolls: [], navalLost: 0, airLost: 0 });
    expect(apply(at7i(s), resolve).state.rngState).toBe(s.rngState);
    for (const state of [markFlown(s, ["d"], "ground-support"), position([plane(), fleet(), plane("d", 3, "A4", "britain")])]) {
      expect(portEvent(at7i(state))).toMatchObject({ status: "resolved", rolls: expect.any(Array) });
      expect(portEvent(at7i(state)).rolls).toHaveLength(3);
    }
  });

  it.each([1, 3, 13, 14, 20, 45])("R14/AER81: separate Counter-Air participants resolve at 7c before ships, seed %s", seed => {
    const s = position([plane(), plane("c", 3), fleet(), plane("d", 3, "A5", "britain")], seed);
    const b = apply(assigned(s), { ...designate(["c"]), mission: "counter-air" }).state;
    const c = apply(b, end("7b")).state;
    expect(c.position).toMatchObject({ step: "7c" });
    const fought = apply(c, { type: "RESOLVE_COUNTER_AIR", side: "axis" });
    const combat = fought.events.find(e => e.type === "AIR_COMBAT_RESOLVED")!;
    const beaten = combat.combat.winner === "attacker";
    expect(portAttacksOf(fought.state)[0]!.counterAir).toBe(beaten ? "beaten" : "not-beaten");
    const i = apply(fought.state, end("7c")).state;
    expect(i.position).toMatchObject({ step: "7i" });
    const done = apply(i, resolve);
    const event = done.events.find(e => e.type === "PORT_ATTACK_RESOLVED")!;
    expect(event.status).toBe(beaten ? "resolved" : "counter-air-blocked");
    expect(event.rolls.map(r => r.id)).toEqual(beaten ? ["p", "p", "p"] : []);
    if (!beaten) expect(done.state.rngState).toBe(i.rngState);
  });

  it("R14/R9: real ground capture displaces the target at 7h before the queued attack at 7i", () => {
    // Real map: Allied infantry at K27 attack German Wilhelmshaven (K28); air shares their airbase at K27.
    const s = board([counter("g", "britain", "infantry", 3, "K27", 3), plane("p", 3, "K27", "britain"), counter("base", "britain", "airbase", 0, "K27"), fleet("f", 9, "K28", "germany")], undefined, {
      activeSide: "allies", position: { part: "player-turn", turn: 1, step: "7b" }, airbasesPlaced: NO_AIRBASES_LEFT, control: { K27: "britain" },
    });
    const b = okOf(applyAction(CTX, s, { ...designate(["p"], "K28"), side: "allies" })).state;
    const h = okOf(applyAction(CTX, b, { type: "END_STEP", side: "allies", step: "7b" })).state;
    expect(h.position).toMatchObject({ step: "7h" });
    expect(legalActions(CTX, h).some(a => a.type === "RESOLVE_PORT_ATTACKS")).toBe(false);
    const captured = okOf(applyAction(CTX, h, { type: "ATTACK", side: "allies", units: ["g"], target: "K28" }));
    expect(captured.events).toContainEqual(expect.objectContaining({ type: "FLEET_DISPLACED", unitId: "f", to: "J30" }));
    const i = okOf(applyAction(CTX, captured.state, { type: "END_STEP", side: "allies", step: "7h" })).state;
    expect(i.position).toMatchObject({ step: "7i" });
    expect(legalActions(CTX, i)).toEqual([{ type: "RESOLVE_PORT_ATTACKS", side: "allies" }]);
    const done = okOf(applyAction(CTX, i, { type: "RESOLVE_PORT_ATTACKS", side: "allies" }));
    expect(done.events).toContainEqual(expect.objectContaining({ type: "PORT_ATTACK_RESOLVED", status: "no-fleets", rolls: [] }));
    expect(done.state.rngState).toBe(s.rngState);
    expect(hasFlown(done.state, "p")).toBe(true);
  });

  it("R14/AER81: Malta uses the same required Counter-Air before ships", () => {
    // Ref 20.45 / Peele: Malta does not bypass Counter-Air.
    const maltaCtx = { ...ctx, map: { ...ctx.map, hexes: { ...ctx.map.hexes,
      GG18: { ...hexes.A1!, id: "GG18", country: "germany" }, GG19: { ...hexes.A5!, id: "GG19", name: "Malta" } } } };
    const s = board([plane("p", 3, "GG18"), fleet("f", 9, "GG19"), plane("d", 3, "GG19", "britain")], undefined, {
      activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7b" }, control: { GG18: "germany", GG19: "britain" }, airbasesPlaced: NO_AIRBASES_LEFT,
    });
    const b = okOf(applyAction(maltaCtx, s, designate(["p"], "GG19"))).state;
    const i = okOf(applyAction(maltaCtx, b, end("7b"))).state;
    const done = okOf(applyAction(maltaCtx, i, resolve));
    expect(done.events).toContainEqual(expect.objectContaining({ type: "PORT_ATTACK_RESOLVED", status: "counter-air-blocked", rolls: [] }));
    expect(done.state.rngState).toBe(s.rngState);
  });

  it("R14/AER83: displaced fleets and missing attackers consume assignments without dice", () => {
    const i = at7i();
    const moved = { ...i, units: { ...i.units, f: { ...i.units.f!, at: "A6" } } };
    expect(portEvent(moved)).toMatchObject({ status: "no-fleets", rolls: [], navalLost: 0 });
    expect(apply(moved, resolve).state.rngState).toBe(i.rngState);
    expect(portAttacksOf(apply(moved, resolve).state)).toEqual([]);
    const missing = { ...i, units: { f: i.units.f! } };
    expect(portEvent(missing)).toMatchObject({ status: "no-air", rolls: [], airLost: 0 });
    expect(portAttacksOf(apply(missing, resolve).state)).toEqual([]);
    expect(apply(missing, resolve).state.rngState).toBe(i.rngState);
    expect(hasFlown(apply(moved, resolve).state, "p")).toBe(true);
  });

  it("R14/AER83: missing planes are omitted while surviving assigned planes still attack", () => {
    const s = position([plane(), plane("q", 2), fleet()]);
    const b = apply(s, designate(["p", "q"])).state;
    const i = apply(b, end("7b")).state;
    const { p: removed, ...units } = i.units;
    expect(removed).toBeDefined();
    const missing = { ...i, units };
    const before = structuredClone(missing);
    const done = apply(missing, resolve);
    const event = done.events.find(e => e.type === "PORT_ATTACK_RESOLVED")!;
    expect(event.status).toBe("resolved");
    expect(event.rolls.map(r => r.id)).toEqual(["q", "q"]);
    expect(portAttacksOf(done.state)).toEqual([]);
    expect(missing).toEqual(before);
  });

  it("R14/R21/AER82: determinism, immutable JSON replay and automatic fleet strength/id allocation", () => {
    expect(PORT_FLEET_LOSS_ORDER).toBe("strength-id");
    const s = position([plane("p", 5), fleet("z", 2), fleet("b", 2), fleet("a", 9)], 14);
    const before = JSON.stringify(s);
    const actions = [designate(), end("7b"), resolve];
    const done = replay(ctx, s, actions);
    expect(replay(ctx, JSON.parse(before) as GameState, actions)).toEqual(done);
    expect(JSON.stringify(s)).toBe(before);
    const reversed = { ...s, units: Object.fromEntries(Object.entries(s.units).reverse()) };
    expect(replay(ctx, reversed, actions)).toEqual(done);
    const event = done.events.find(e => e.type === "PORT_ATTACK_RESOLVED")!;
    expect(event.navalHits).toBeGreaterThan(0);
    expect(event.fleets.find(f => f.id === "b")!.lost).toBe(Math.min(2, event.navalHits));
    expect(event.fleets.find(f => f.id === "a")!.lost).toBe(Math.max(0, event.navalHits - 4));
    // Spec 12 R2/R14 (Ref 21.1/20.45): ship losses do not damage this ordinary port.
    expect(portCapacity(ctx, "A5")).toBe(36);
  });

  it("R14/AER83: partial fleet breakdown preserves nationality/base and uses deterministic replacement ids", () => {
    // Seed 7: a single factor hits; 9 -> 6+2, the lost factor stays lost for good (RB5).
    const s = position([plane("p", 1), { ...fleet(), nationality: "france" }], 7);
    const i = at7i(s);
    const result = apply(i, resolve);
    expect(portEvent(i)).toMatchObject({ navalHits: 1, navalLost: 1, airLost: 0 });
    expect(result.state.units.f).toMatchObject({ strength: 6, at: "A5", nationality: "france" });
    expect(result.state.units[`u${s.nextUnitId}`]).toMatchObject({ strength: 2, at: "A5", nationality: "france" });
    expect(result.state.nextUnitId).toBe(s.nextUnitId + 1);
    expect(result.state.pools).toEqual(s.pools);
    expect(result.events).toContainEqual(expect.objectContaining({ type: "UNIT_LOST_FOR_GOOD", unitId: "f", strength: 1, reason: "partial-fleet" }));
  });

  it("R14/AER69/AER83: pure dice match real air losses and full fleet sinks use pool routing", () => {
    const s = position([plane("p", 5), fleet("f", 1)], 1);
    const i = at7i(s);
    const pure = resolvePortAttack({ target: "A5", attacker: [s.units.p!], fleets: [s.units.f!], counterAir: "not-needed", rngState: 1 }, () => [{ id: "f", factors: 1 }]);
    const done = apply(i, resolve);
    expect(portEvent(i)).toMatchObject({ rolls: pure.rolls, airLost: pure.air.lost, navalLost: pure.navalLost });
    expect(pure.air.lost).toBeGreaterThan(0);
    expect(done.state.units.p?.strength ?? 0).toBe(pure.air.surviving[0]?.strength ?? 0);
    expect(done.events).toContainEqual(expect.objectContaining({ type: "UNIT_RETURNED_TO_POOL", unitType: "air" }));
    expect(done.events).toContainEqual(expect.objectContaining({ type: "UNIT_ELIMINATED", unitId: "f" }));
    expect(done.events).toContainEqual(expect.objectContaining({ type: "UNIT_LOST_FOR_GOOD", unitId: "f", reason: "partial-fleet" }));
  });

  it("R21/AER80: targets and factor rolls follow designation order with one advancing RNG stream", () => {
    const s = position([plane(), plane("q"), fleet(), fleet("g", 9, "A4")], 1);
    const b = apply(assigned(s), designate(["q"], "A4")).state;
    const i = apply(b, end("7b")).state;
    const done = apply(i, resolve);
    const first = resolvePortAttack({ target: "A5", attacker: [s.units.p!], fleets: [s.units.f!], counterAir: "not-needed", rngState: 1 }, (_pool, owed) => [{ id: "f", factors: owed }]);
    const second = resolvePortAttack({ target: "A4", attacker: [s.units.q!], fleets: [s.units.g!], counterAir: "not-needed", rngState: first.rngState }, (_pool, owed) => [{ id: "g", factors: owed }]);
    expect(done.events.filter(e => e.type === "PORT_ATTACK_RESOLVED").map(e => ({ target: e.target, rolls: e.rolls })))
      .toEqual([{ target: "A5", rolls: first.rolls }, { target: "A4", rolls: second.rolls }]);
    expect(done.state.rngState).toBe(second.rngState);
    expect(portAttacksOf(done.state)).toEqual([]);
  });

  it("R14/AER83: whole air losses return once to their pool and a whole sunk fleet returns for rebuilding (RB5)", () => {
    const airLoss = apply(at7i(position([plane("p", 1), fleet()], 2)), resolve);
    expect(airLoss.state.units.p).toBeUndefined();
    expect(airLoss.events.filter(e => e.type === "UNIT_RETURNED_TO_POOL" && e.unitId === "p")).toHaveLength(1);
    const planes = Array.from({ length: 8 }, (_, n) => plane(n === 0 ? "p" : `p${n}`, 5));
    const s = position([...planes, fleet()], 1);
    const b = apply(s, designate(planes.map(u => u.id))).state;
    const done = apply(apply(b, end("7b")).state, resolve);
    expect(done.state.units.f).toBeUndefined();
    expect(done.events).toContainEqual(expect.objectContaining({ type: "UNIT_RETURNED_TO_POOL", unitId: "f", unitType: "fleet", strength: 9 }));
  });

  it("R14: logs port designation, resolution, rolls and loss totals with neutral battle colour", () => {
    const s = position();
    const designation = apply(s, designate()).events[0]!;
    expect(describeEvent(designation, ctx, new Set(), new Map(), s)).toMatch(/fly a port attack/);
    expect(eventSide(designation, "axis", s)).toBe("axis");
    const i = at7i();
    const event = portEvent(i);
    expect(describeEvent(event, ctx, new Set(), new Map(), i)).toMatch(/Port attack on .*resolved; rolls .*losses .*air, .*naval factors/);
    expect(eventSide(event, "axis", i)).toBeNull();
  });

  it("C1/AER80: old saves restore byte-identically, absent queue defaults empty without state changes", async () => {
    const old = newGame(CTX.scenario, 13);
    const snapshot = JSON.stringify(old);
    const saved = JSON.parse(snapshot) as JsonObject;
    const save: SaveFile = { format: 2, app: "3reich", title: "Before port missions", savedAt: "2026-11-10T00:00:00.000Z", gameVersion: "old", stateVersion: 1,
      scenario: CTX.scenario.id, seed: 13, humanSide: "axis", start: { kind: "snapshot", state: saved }, actions: [], setupActions: 0, snapshot: saved, fingerprint: fingerprint(old) };
    const opened = await restore(JSON.stringify(save), CTX, { now: () => 0, yield: async () => {}, cancelled: () => false, validateSnapshot: createSnapshotValidator() });
    if (opened.kind !== "opened") throw Error(opened.message);
    expect(JSON.stringify(opened.state)).toBe(snapshot);
    expect(fingerprint(opened.state)).toBe(save.fingerprint);
    expect(portAttacksOf(opened.state)).toEqual([]);
    expect(opened.state.air).toBeUndefined();
    const legacy = { ...position(), air: newAirTurn(position()) };
    const before = JSON.stringify(legacy);
    expect(portAttacksOf(legacy)).toEqual([]);
    expect(legalActions(ctx, legacy)).toEqual(legalActions(ctx, position()));
    expect(apply(legacy, end("7b")).state.air?.portAttacks).toBeUndefined();
    expect(JSON.stringify(legacy)).toBe(before);
  });
});
