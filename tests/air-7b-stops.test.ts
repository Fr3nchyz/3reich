import { describe, expect, it } from "vitest";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { hasAirWork, hasManualAirWork } from "../src/engine/air-missions";
import { airOf, markFlown } from "../src/engine/air-record";
import { settle } from "../src/engine/turn";
import type { GameContext } from "../src/engine/context";
import type { MapHex } from "../src/engine/map";
import type { GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX, NO_AIRBASES_LEFT } from "./helpers";
import { okOf } from "./helpers-move";

// TODO(verify) AER122, spec 09: only opted-in human air adds direct-mission work at 7b.
// A1 to A5 is exactly four hexes; no ground units or ground-support targets exist.
const hexes: Record<string, MapHex> = Object.fromEntries(Array.from({ length: 6 }, (_, n) => {
  const id = `A${n + 1}`;
  return [id, { id, land: "plain", sea: false, country: n === 0 ? "germany" : "britain",
    front: "western", features: ["city", "port"] }];
}));
const ctx: GameContext = { ...CTX, map: { ...CTX.map, hexes: { ...CTX.map.hexes, ...hexes } } };
const plane = (id = "a", at = "A1", owner: Unit["owner"] = "germany") => counter(id, owner, "air", 3, at, 4);
const target = (type: "air" | "fleet", at = "A5", owner: Unit["owner"] = "britain") => counter("d", owner, type, 3, at);
function start(type: "air" | "fleet", flag: boolean | undefined = true, units = [plane(), target(type)]): GameState {
  const s = board(units, undefined, { activeSide: "axis", firstSide: "axis",
    position: { part: "player-turn", turn: 1, step: "6f" }, airbasesPlaced: NO_AIRBASES_LEFT,
    control: Object.fromEntries(Object.keys(hexes).map(id => [id, id === "A1" ? "germany" : "britain"])) });
  return flag === undefined ? s : { ...s, air: { ...airOf(s), manualDas: flag } };
}
const end = (step: string): Action => ({ type: "END_STEP", side: "axis", step });
const enter = (s: GameState, context = ctx) => okOf(applyAction(context, s, end("6f"))).state;
const waits = (s: GameState) => s.position?.part === "player-turn" && s.position.step === "7b";

describe.each(["air", "fleet"] as const)("AER122: 7b for %s targets through the real turn flow", type => {
  it("stops without ground support; direct designation reaches explicit resolution", () => {
    const s = start(type);
    const before = JSON.stringify(s);
    const b = enter(s);
    expect(waits(b)).toBe(true);
    expect(hasAirWork(ctx, b)).toBe(false);
    expect(hasManualAirWork(ctx, b)).toBe(true);
    expect(b.rngState).toBe(s.rngState);
    expect(b.units).toEqual(s.units);
    expect(JSON.stringify(s)).toBe(before);
    expect(legalActions(ctx, b)).toContainEqual(end("7b"));
    const mission = type === "air" ? "counter-air" : "port-attack";
    expect(legalActions(ctx, b).some(a => a.type === "DESIGNATE_AIR" && a.mission === mission)).toBe(false);
    const assigned = okOf(applyAction(ctx, b, { type: "DESIGNATE_AIR", side: "axis", mission, units: ["a"], target: "A5" })).state;
    expect(hasManualAirWork(ctx, assigned)).toBe(false);
    const next = okOf(applyAction(ctx, assigned, end("7b"))).state;
    expect(next.position).toMatchObject({ step: type === "air" ? "7c" : "7i" });
    const resolve: Action = { type: type === "air" ? "RESOLVE_COUNTER_AIR" : "RESOLVE_PORT_ATTACKS", side: "axis" };
    expect(legalActions(ctx, next)).toEqual([resolve]);
    expect(okOf(applyAction(ctx, next, resolve)).state.rngState).not.toBe(s.rngState);
    expect(waits(okOf(applyAction(ctx, b, end("7b"))).state)).toBe(false);
  });

  it("absent/false human gate preserves the skip and serialized input", () => {
    for (const flag of [undefined, false]) {
      const base = start(type, false);
      const s = flag === undefined ? { ...base, air: undefined } : base;
      const before = JSON.stringify(s);
      expect(waits(enter(s))).toBe(false);
      expect(JSON.stringify(s)).toBe(before);
    }
  });

  it("spent or newly built attackers, enemy attackers and off-map attackers do not hold 7b", () => {
    for (const kind of ["ground-support", "new"] as const) expect(waits(enter(markFlown(start(type), ["a"], kind)))).toBe(false);
    expect(waits(enter(start(type, true, [plane("a", "A1", "britain"), target(type)])))).toBe(false);
    expect(waits(enter(start(type, true, [plane("a", "force-pool"), target(type)])))).toBe(false);
  });

  it("five-hex, friendly and missing targets do not hold 7b", () => {
    for (const units of [[plane(), target(type, "A6")], [plane(), target(type, "A5", "germany")], [plane()]]) {
      expect(waits(enter(start(type, true, units)))).toBe(false);
    }
  });

  it("neutral flight barriers and targets without the required base/port do not hold 7b", () => {
    const blocked: GameContext = { ...ctx, map: { ...ctx.map, hexes: { ...ctx.map.hexes, A3: { ...hexes.A3!, country: "spain" } } } };
    const s = start(type);
    const control = { ...s.control };
    delete control.A3;
    expect(waits(enter({ ...s, control }, blocked))).toBe(false);
    const noBase: GameContext = { ...ctx, map: { ...ctx.map, hexes: { ...ctx.map.hexes, A5: { ...hexes.A5!, features: [] } } } };
    expect(waits(enter(s, noBase))).toBe(false);
  });

  it("7k remains ground-support-only even with the human gate", () => {
    const s: GameState = { ...start(type), position: { part: "player-turn", turn: 1, step: "7k" } };
    expect(hasManualAirWork(ctx, s)).toBe(false);
    expect(settle(ctx, s).state.position).not.toMatchObject({ step: "7k" });
  });
});

it("AER122 / R12: already-flown defending planes still permit counter-air", () => {
  expect(waits(enter(markFlown(start("air"), ["d"], "ground-support")))).toBe(true);
});

it("AER122: an enemy fleet outside an enemy-controlled port does not hold 7b", () => {
  const s = start("fleet");
  expect(waits(enter({ ...s, control: { ...s.control, A5: "germany" } }))).toBe(false);
});

it.each(["air", "fleet"] as const)("AER122: the active Allied side can stop for a German %s target", type => {
  const s = start(type, true, [plane("a", "A1", "britain"), target(type, "A5", "germany")]);
  const allies: GameState = { ...s, activeSide: "allies", firstSide: "allies", control: { ...s.control, A1: "britain", A5: "germany" } };
  const ready: GameState = { ...allies, air: { ...airOf(allies), manualDas: true } };
  const b = okOf(applyAction(ctx, ready, { type: "END_STEP", side: "allies", step: "6f" })).state;
  expect(waits(b)).toBe(true);
  expect(okOf(applyAction(ctx, b, { type: "DESIGNATE_AIR", side: "allies", mission: type === "air" ? "counter-air" : "port-attack", units: ["a"], target: "A5" })).ok).toBe(true);
});
