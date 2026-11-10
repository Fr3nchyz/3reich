import { describe, expect, it } from "vitest";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { beginDropTurn, DROP_MANUAL_DEFAULT, legalDrops } from "../src/engine/air-drop-wire";
import { dropTargets, resolveDrop } from "../src/engine/air-drop";
import { turnKey } from "../src/engine/combat-record";
import { newGame, turnIndex } from "../src/engine/game";
import { beginPlay } from "../src/engine/turn";
import type { GameState } from "../src/engine/types";
import { chooseAction } from "../src/ai/choose";
import { fingerprint } from "../src/save/fingerprint";
import type { JsonObject, SaveFile } from "../src/save/format";
import { restore } from "../src/save/restore";
import { createSnapshotValidator } from "../src/save/snapshotInvariants";
import { describeEvent } from "../src/ui/eventText";
import { eventSide } from "../src/ui/logSide";
import { CTX, NO_AIRBASES_LEFT, toEndOfTurn } from "./helpers";
import { at6f, inf, okOf } from "./helpers-move";

const end = (step: string, side: GameState["activeSide"] = "axis"): Action => ({ type: "END_STEP", side, step });
const drop = (to = "L32", unit = "para"): Extract<Action, { type: "AIRDROP" }> => ({ type: "AIRDROP", side: "axis", unit, to });
// Ref 23.1: German airborne starts at Berlin (L31), with a ground battle keeping 7h open.
function initial(manual = true): GameState {
  const s = at6f([inf("para", "germany", "L31", 3, 3, "airborne"), inf("g", "germany", "M32"), inf("p", "poland", "M33")], "axis", undefined,
    { rngState: 13, airbasesPlaced: NO_AIRBASES_LEFT });
  return { ...s, airDrop: { manual } };
}
function reach(state: GameState, step: string): GameState {
  for (let n = 0; n < 30; n++) {
    if (state.position?.part !== "player-turn") throw Error("Expected a Player Turn");
    if (state.position.step === step) return state;
    state = okOf(applyAction(CTX, state, end(state.position.step, state.activeSide))).state;
  }
  throw Error(`Did not reach ${step}`);
}
const movement = (s = initial()) => reach(beginPlay(CTX, s).state, "6f");
const atDrop = (s = initial()) => okOf(applyAction(CTX, movement(s), end("6f"))).state;

describe("09-11b normal airdrop wiring", () => {
  it("AER95: real flow waits at 7g and lists exactly legal pairs plus END_STEP", () => {
    const s = atDrop();
    expect(s.position).toMatchObject({ step: "7g" });
    const record = s.airDrop!.record!;
    const expected = dropTargets(CTX, s, record, "para").map((to) => drop(to));
    expect(expected).toContainEqual(drop());
    expect(legalActions(CTX, s)).toEqual([...expected, end("7g")]);
    expect(okOf(applyAction(CTX, s, end("7g"))).state.position).toMatchObject({ step: "7h" });
  });

  it("AER95: absent/false gate skips 7g even with eligible airborne; computer path is unchanged", () => {
    expect(DROP_MANUAL_DEFAULT).toBe(false);
    const absent = initial();
    delete absent.airDrop;
    for (const source of [absent, initial(false)]) {
      const m = movement(source);
      expect(legalActions(CTX, m).some((a) => a.type === "AIRDROP")).toBe(false);
      expect(chooseAction(CTX, m, { seed: 1 })?.action.type).not.toBe("AIRDROP");
      const next = okOf(applyAction(CTX, m, end("6f")));
      expect(next.state.position).toMatchObject({ step: "7h" });
      expect(next.state.rngState).toBe(m.rngState);
      expect(next.events).toContainEqual({ type: "STEPS_PASSED", steps: expect.arrayContaining(["7g"]) });
      expect(next.state.airDrop).toEqual(source.airDrop);
      const hand = { ...next.state, position: { part: "player-turn" as const, turn: 1 as const, step: "7g" } };
      expect(legalActions(CTX, hand)).toEqual([end("7g")]);
      expect(applyAction(CTX, hand, drop()).ok).toBe(false);
    }
    const a = movement(absent), b = movement(initial(false));
    expect(legalActions(CTX, a)).toEqual(legalActions(CTX, b));
    expect(chooseAction(CTX, a, { seed: 1 })).toEqual(chooseAction(CTX, b, { seed: 1 }));
  });

  it("AER95: enabled gate with no eligible airborne adds no work", () => {
    const s = initial();
    delete s.units.para;
    expect(atDrop(s).position).toMatchObject({ step: "7h" });
    const moved = movement();
    const done = okOf(applyAction(CTX, moved, { type: "MOVE", side: "axis", units: ["para"], path: ["L32"] })).state;
    expect(okOf(applyAction(CTX, done, end("6f"))).state.position).toMatchObject({ step: "7h" });
  });

  it("AER96: captures actual start before movement and never reconstructs missing/stale snapshots", () => {
    const m = movement();
    const start = m.airDrop!.record!.start;
    expect(start.position).toMatchObject({ step: "1" });
    expect(start.airDrop).toBeUndefined();
    expect(turnKey(start)).toBe(turnKey(m));
    for (const airDrop of [{ manual: true }, { manual: true, record: { start: { ...start, year: start.year - 1 }, dropped: {} } }]) {
      const s = { ...atDrop(), airDrop };
      expect(legalActions(CTX, s)).toEqual([end("7g")]);
      expect(applyAction(CTX, s, drop()).ok).toBe(false);
    }
    const m2 = { ...m, airDrop: { manual: true } };
    expect(okOf(applyAction(CTX, m2, end("6f"))).state.position).toMatchObject({ step: "7h" });
  });

  it("R13/AER95: rejects wrong step, side, unit, range and malformed targets atomically", () => {
    const s = atDrop(), before = JSON.stringify(s);
    const actions: Action[] = [
      { ...drop(), side: "allies" }, drop("L32", "g"), drop("L32", "p"), drop("L32", "missing"),
      drop("L32", "constructor"), drop("L32", "__proto__"), drop("ZZ99"), drop("A24"), drop("K23"), drop("AA7"),
      { ...drop(), unit: null } as unknown as Action, { ...drop(), to: null } as unknown as Action,
      drop("constructor"), drop("__proto__"),
    ];
    for (const a of actions) expect(applyAction(CTX, s, a).ok, JSON.stringify(a)).toBe(false);
    for (const step of ["6f", "7b", "7h", "7n"]) {
      expect(applyAction(CTX, { ...s, position: { part: "player-turn", turn: 1, step } }, drop()).ok).toBe(false);
    }
    expect(applyAction(CTX, { ...s, phase: "setup" }, drop()).ok).toBe(false);
    expect(applyAction(CTX, { ...s, phase: "game-over" }, drop()).ok).toBe(false);
    expect(applyAction(CTX, { ...s, position: null }, drop()).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("R13/AER97: pure placement, ledger, supply report, no RNG or control changes; no repeat", () => {
    const s = atDrop(), record = s.airDrop!.record!;
    const pure = resolveDrop(CTX, s, record, "para", "L32");
    if (!pure.ok) throw Error(pure.error);
    const done = okOf(applyAction(CTX, s, drop()));
    expect(done.state.units.para).toEqual({ ...s.units.para, at: "L32" });
    expect(done.state.control).toEqual(s.control);
    expect(done.state.rngState).toBe(s.rngState);
    expect(done.state.airDrop!.record).toEqual(pure.record);
    expect(done.state.airDrop!.record!.dropped.para).toBe(turnIndex(s));
    expect(done.events).toEqual([{ type: "AIR_DROPPED", side: "axis", unit: "para", from: "L31", to: "L32", supplied: pure.supplied }]);
    expect(done.state.position).toMatchObject({ step: "7g" });
    expect(legalActions(CTX, done.state)).toEqual([end("7g")]);
    expect(applyAction(CTX, done.state, drop()).ok).toBe(false);
    expect(okOf(applyAction(CTX, done.state, end("7g"))).state.position).toMatchObject({ step: "7h" });
  });

  it("AER97: logs readable airborne names, origin/destination and both supply outcomes", () => {
    const s = atDrop();
    for (const to of ["L32", "M33"]) {
      const done = okOf(applyAction(CTX, s, drop(to)));
      const e = done.events[0]!;
      expect(e).toMatchObject({ supplied: to === "L32" });
      const line = describeEvent(e, CTX, new Set(), new Map(), s);
      expect(line).toMatch(/drops from .* to .*supply/);
      expect(line).toMatch(/German|Germany/);
      expect(line).not.toMatch(/\[object Object\]|\bpara\b/);
      expect(eventSide(e, "allies", s)).toBe("axis");
    }
  });

  it("AER95: the Allied Phasing side can drop its own eligible unit", () => {
    const base = initial();
    const allied: GameState = { ...base, activeSide: "allies", firstSide: "allies", units: { para: inf("para", "britain", "K23", 3, 3, "airborne") } };
    const s = reach(beginPlay(CTX, allied).state, "7g");
    const action = { ...drop("K23"), side: "allies" as const };
    expect(legalActions(CTX, s)).toContainEqual(action);
    const done = okOf(applyAction(CTX, s, action));
    expect(done.events[0]).toMatchObject({ side: "allies" });
    expect(eventSide(done.events[0]!, "axis", s)).toBe("allies");
  });

  it("AER96/R13: turn boundary refreshes snapshot, keeps drop ledger and avoids recursive growth", () => {
    const done = okOf(applyAction(CTX, atDrop(), drop())).state;
    const last = toEndOfTurn(CTX, done);
    const next = okOf(applyAction(CTX, last, { type: "END_PLAYER_TURN", side: "axis" })).state;
    const record = next.airDrop!.record!;
    expect(turnKey(record.start)).toBe(turnKey(next));
    expect(record.start.activeSide).toBe("allies");
    expect(record.start.airDrop).toBeUndefined();
    expect(record.dropped).toEqual(done.airDrop!.record!.dropped);
    expect(record.dropped).not.toBe(done.airDrop!.record!.dropped);
    expect(record.start.units.para!.at).toBe("L32");
    const nextDrop = { ...next, activeSide: "axis" as const, position: { part: "player-turn" as const, turn: 1 as const, step: "7g" } };
    expect(legalDrops(CTX, beginDropTurn(nextDrop))).toEqual([]); // same Game Turn, even with a fresh snapshot
  });

  it("R15/C1: deterministic JSON replay, stable action order and immutable inputs", () => {
    const m = movement();
    const before = JSON.stringify(m);
    const actions = [end("6f"), drop(), end("7g")];
    const first = replay(CTX, m, actions);
    expect(replay(CTX, JSON.parse(before) as GameState, JSON.parse(JSON.stringify(actions)) as Action[])).toEqual(first);
    expect(JSON.stringify(m)).toBe(before);
    const s = atDrop();
    expect(legalActions(CTX, { ...s, units: Object.fromEntries(Object.entries(s.units).reverse()) })).toEqual(legalActions(CTX, s));
  });

  it("C1/AER95: old snapshot loads byte-for-byte unchanged with empty drop defaults", async () => {
    const old = newGame(CTX.scenario, 13), before = JSON.stringify(old);
    const saved = JSON.parse(before) as JsonObject;
    const save: SaveFile = { format: 2, app: "3reich", title: "Before airdrops", savedAt: "2026-11-09T00:00:00.000Z",
      gameVersion: "old", stateVersion: 1, scenario: CTX.scenario.id, seed: 13, humanSide: "axis",
      start: { kind: "snapshot", state: saved }, actions: [], setupActions: 0, snapshot: saved, fingerprint: fingerprint(old) };
    const opened = await restore(JSON.stringify(save), CTX, { now: () => 0, yield: async () => {}, cancelled: () => false, validateSnapshot: createSnapshotValidator() });
    if (opened.kind !== "opened") throw Error(opened.message);
    expect(JSON.stringify(opened.state)).toBe(before);
    expect(opened.state.airDrop).toBeUndefined();
    expect(beginDropTurn(opened.state)).toBe(opened.state);
    expect(legalDrops(CTX, opened.state)).toEqual([]);
    expect(fingerprint(opened.state)).toBe(save.fingerprint);
  });
});
