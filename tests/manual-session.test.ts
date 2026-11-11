import { expect, it } from "vitest";
import { chooseAction } from "../src/ai/choose";
import { AI_USES_AIR } from "../src/ai/air";
import { AI_USES_FLEETS } from "../src/ai/policies";
import { legalActions, moveOnAction, applyAction, type Action } from "../src/engine/actions";
import { sideToAct } from "../src/engine/actor";
import { autoSetup } from "../src/engine/autosetup";
import { setManualDas } from "../src/engine/air-defense-wire";
import { setManualAirDrop } from "../src/engine/air-drop-wire";
import { newGame } from "../src/engine/game";
import { setManualFleetMove } from "../src/engine/naval-actions";
import { navalOf } from "../src/engine/naval-record";
import type { GameState } from "../src/engine/types";
import { fingerprint } from "../src/save/fingerprint";
import type { JsonObject, SaveFile } from "../src/save/format";
import { createSnapshotValidator, validateSnapshotInvariants } from "../src/save/snapshotInvariants";
import { restore } from "../src/save/restore";
import { readSave } from "../src/save/validate";
import { newSession, createSession, run, type Session } from "../src/ui/session";
import { sessionSave } from "../src/ui/saveFile";
import { newWatchSession } from "../src/ui/watchPlay";
import { board, counter } from "./board";
import { CTX } from "./helpers";

const options = { now: () => 0, yield: async () => {}, cancelled: () => false, validateSnapshot: createSnapshotValidator() };
async function roundTrip(s: Session, start: SaveFile["start"] = { kind: "new" }) {
  const save = sessionSave(s, "test", start);
  expect(validateSnapshotInvariants(save.snapshot, s.ctx)).toEqual({ ok: true });
  const opened = await restore(JSON.stringify(save), s.ctx, options);
  expect(opened).toMatchObject({ kind: "opened", via: "replay" });
  if (opened.kind !== "opened") throw Error(opened.message);
  expect(opened.state).toEqual(JSON.parse(JSON.stringify(s.state)));
  expect(fingerprint(opened.state)).toBe(save.fingerprint);
  const rescue = await restore(JSON.stringify({ ...save, fingerprint: "00000000" }), s.ctx, options);
  expect(rescue.kind, rescue.message).toBe("rescue");
  if (rescue.kind === "rescue") expect(rescue.state).toEqual(JSON.parse(JSON.stringify(s.state)));
  if (rescue.kind !== "rescue") throw Error(rescue.message);
  const continued = await restore(JSON.stringify(rescue.save), s.ctx, options);
  expect(continued.kind).toBe("opened");
  if (continued.kind === "opened") expect(continued.state).toEqual(JSON.parse(JSON.stringify(s.state)));
}

it("AER116: human starts enable exactly three gates; engine/watch defaults and policies stay off", () => {
  for (const side of ["axis", "allies"] as const) {
    for (const s of [newSession(CTX.scenario, side, 1), createSession(CTX.scenario, side, 1)]) {
      expect(s.state.naval).toMatchObject({ manualFleetMove: true, manualSeaAir: true });
      expect(s.state.air?.manualDas).toBe(true);
      expect(s.state.airDrop?.manual).toBeUndefined();
    }
  }
  for (const state of [newGame(CTX.scenario, 1), newWatchSession(CTX.scenario, 1, "slow", null).state]) {
    expect(state.naval?.manualFleetMove).toBeUndefined();
    expect(state.naval?.manualSeaAir).toBeUndefined();
    expect(state.air?.manualDas).toBeUndefined();
    expect(state.airDrop?.manual).toBeUndefined();
  }
  expect(AI_USES_AIR).toBe(false);
  expect(AI_USES_FLEETS).toBe(false);
});

it.each(["axis", "allies"] as const)("AER116: %s human and real computer complete two Player Turns and save exactly", async human => {
  const s = newSession(CTX.scenario, human, 1);
  expect(run(s, ...autoSetup(s.ctx, s.state))).toBe(true);
  let turns = 0;
  const computerSteps = new Set<string>();
  for (let guard = 0; guard < 1500 && turns < 2; guard++) {
    const computer = sideToAct(s.state) !== human;
    const legal = legalActions(s.ctx, s.state);
    const action = computer ? chooseAction(s.ctx, s.state, { seed: 1 })?.action
      : moveOnAction(s.state).find(a => legal.some(b => JSON.stringify(a) === JSON.stringify(b))) ?? legal[0];
    expect(action, JSON.stringify(s.state.position)).toBeDefined();
    if (!action) throw Error("stalled");
    if (computer && s.state.position?.part === "player-turn") computerSteps.add(s.state.position.step);
    expect(run(s, action), s.toast).toBe(true);
    expect(s.state.air?.manualDas).toBe(true);
    expect(navalOf(s.state)).toMatchObject({ manualFleetMove: true, manualSeaAir: true });
    if (action.type === "END_PLAYER_TURN") { turns++; await roundTrip(s); }
  }
  expect(turns).toBe(2);
  expect(computerSteps.has("6b")).toBe(true);
});

it.each(["fleet", "das", "sea", "drop"])("AER116: individual %s gate persists and round trips across two Player Turns", async flag => {
  const s = newSession(CTX.scenario, "axis", 1, false);
  if (flag === "fleet") s.state = setManualFleetMove(s.state, true);
  if (flag === "das") s.state = setManualDas(s.state, true);
  if (flag === "sea") s.state = { ...s.state, naval: { ...navalOf(s.state), manualSeaAir: true } };
  if (flag === "drop") s.state = setManualAirDrop(s.state, true);
  const start: SaveFile["start"] = { kind: "snapshot", state: JSON.parse(JSON.stringify(s.state)) as JsonObject };
  expect(run(s, ...autoSetup(s.ctx, s.state))).toBe(true);
  let turns = 0;
  for (let guard = 0; guard < 120 && turns < 2; guard++) {
    const legal = legalActions(s.ctx, s.state);
    const action = moveOnAction(s.state).find(a => legal.some(b => JSON.stringify(a) === JSON.stringify(b))) ?? legal[0]!;
    expect(run(s, action), s.toast).toBe(true);
    const enabled = flag === "fleet" ? navalOf(s.state).manualFleetMove : flag === "sea" ? navalOf(s.state).manualSeaAir
      : flag === "das" ? s.state.air?.manualDas : s.state.airDrop?.manual;
    expect(enabled).toBe(true);
    if (action.type === "END_PLAYER_TURN") { turns++; await roundTrip(s, start); }
  }
  expect(turns).toBe(2);
});

it("AER116: old-format new starts replay without gates or fingerprint changes", async () => {
  const s = newSession(CTX.scenario, "axis", 1, false);
  expect(run(s, ...autoSetup(s.ctx, s.state))).toBe(true);
  expect(sessionSave(s, "test", { kind: "new" }).start).toEqual({ kind: "new" });
  await roundTrip(s);
});

function moved(ships = true): GameState {
  const s = board([
    counter("b", "britain", "fleet", 9, "K21"),
    ...(ships ? [counter("g", "germany", "fleet", 9, "K28")] : []),
    counter("p", "germany", "air", 1, "N19"), counter("base", "germany", "airbase", 0, "N19"),
  ], undefined, { activeSide: "allies", position: { part: "player-turn", turn: 1, step: "6b" },
    control: { N18: "britain", N19: "germany" }, frontOptions: { western: { option: "attrition" } } });
  const enabled = setManualFleetMove(s, true);
  let state: GameState = { ...enabled, naval: { ...navalOf(enabled), manualSeaAir: true } };
  for (const a of [{ type: "MOVE_FLEET", side: "allies", fleet: "b", to: "N18", front: "western" },
    { type: "END_STEP", side: "allies", step: "6b" }] as Action[]) {
    const result = applyAction(CTX, state, a);
    if (!result.ok) throw Error(result.error);
    state = result.state;
  }
  return state;
}

it.each([true, false])("AER118: 6c actor, legal pass and computer agree with fleet interceptors=%s", ships => {
  let s = moved(ships);
  expect(s.position).toMatchObject({ step: "6c" });
  for (const side of ["axis", "allies"] as const) {
    expect(sideToAct(s)).toBe(side);
    expect(moveOnAction(s)).toEqual([{ type: "PASS_INTERCEPT", side }]);
    expect(legalActions(CTX, s)).toContainEqual(moveOnAction(s)[0]);
    const choice = chooseAction(CTX, s, { seed: 1 });
    expect(choice?.action).toEqual({ type: "PASS_INTERCEPT", side });
    const result = applyAction(CTX, s, choice!.action);
    if (!result.ok) throw Error(result.error);
    s = result.state;
  }
  expect(s.position).not.toMatchObject({ step: "6c" });
});

it("AER116: manual action envelopes survive cleaning; malformed optional flags are refused for rescue", () => {
  const save = sessionSave(newSession(CTX.scenario, "axis", 1), "test", { kind: "new" });
  save.actions = [{ type: "MOVE_FLEET", side: "axis", fleet: "u1", to: "N18", front: "western", path: ["N18"] },
    { type: "DESIGNATE_DAS", side: "allies", units: ["u2"], hex: "N18" },
    { type: "AIRDROP", side: "axis", unit: "u3", to: "N18" }];
  const read = readSave(JSON.stringify(save), [CTX.scenario]);
  expect(read.ok && read.save.actions).toEqual(save.actions);
  for (const key of ["manualFleetMove", "manualSeaAir"]) {
    const snapshot = structuredClone(save.snapshot);
    (snapshot.naval as JsonObject)[key] = "true";
    expect(validateSnapshotInvariants(snapshot, CTX).ok).toBe(false);
  }
  const snapshot = structuredClone(save.snapshot);
  (snapshot.air as JsonObject).manualDas = "true";
  expect(validateSnapshotInvariants(snapshot, CTX).ok).toBe(false);
});

it("AER116: a human fleet action replays and survives rescue with its complete course", async () => {
  const s = newSession(CTX.scenario, "axis", 1);
  expect(run(s, ...autoSetup(s.ctx, s.state))).toBe(true);
  for (let guard = 0; guard < 20 && !(s.state.position?.part === "player-turn" && s.state.position.step === "6b"); guard++) {
    const legal = legalActions(s.ctx, s.state);
    const action = moveOnAction(s.state).find(a => legal.some(b => JSON.stringify(a) === JSON.stringify(b))) ?? legal[0]!;
    expect(run(s, action), s.toast).toBe(true);
  }
  expect(s.state.position).toMatchObject({ step: "6b" });
  const move = legalActions(s.ctx, s.state).find(a => a.type === "MOVE_FLEET");
  expect(move).toBeDefined();
  expect(run(s, move!), s.toast).toBe(true);
  expect(s.state.naval?.moves).toHaveLength(1);
  await roundTrip(s);
});

it("AER116: optional future airdrop marker replays, and malformed start markers are rejected", async () => {
  const s = newSession(CTX.scenario, "axis", 1, false);
  s.state = setManualAirDrop(s.state, true);
  const save = sessionSave(s, "test", { kind: "new" });
  expect(save.start).toEqual({ kind: "new", manualAirDrop: true });
  await roundTrip(s);
  for (const key of ["manual", "manualAirDrop"]) for (const value of [false, "true", 1, null]) {
    expect(readSave(JSON.stringify({ ...save, start: { kind: "new", [key]: value } }), [CTX.scenario]).ok).toBe(false);
  }
});

it("AER116: every manual action envelope retains its fields through the save reader", () => {
  const save = sessionSave(newSession(CTX.scenario, "axis", 1), "test", { kind: "new" });
  save.actions = [
    { type: "DECLARE_INTERCEPT", side: "axis", target: "move:0", fleets: ["u1"], meetingPoint: "N18", breakOff: true },
    { type: "PASS_INTERCEPT", side: "allies" },
    { type: "RESOLVE_INTERCEPTIONS", side: "allies", turnBack: ["move:0"] },
    { type: "DESIGNATE_SEA_AIR", side: "axis", target: "move:0", point: "N18", units: ["u2"] },
    { type: "RESOLVE_SEA_AIR", side: "allies" },
    { type: "DESIGNATE_DAS_INTERCEPT", side: "axis", units: ["u2"], hex: "N18" },
    { type: "RESOLVE_COUNTER_AIR", side: "axis" },
    { type: "RESOLVE_PORT_ATTACKS", side: "axis" },
  ];
  const read = readSave(JSON.stringify(save), [CTX.scenario]);
  expect(read.ok && read.save.actions).toEqual(save.actions);
});

it("AER116/AER96: rescue rejects malformed and nested drop records, retaining valid optional records", () => {
  const s = newSession(CTX.scenario, "axis", 1, false);
  const start = JSON.parse(JSON.stringify(s.state)) as JsonObject;
  const snapshot = { ...start, airDrop: { manual: true, record: { start, dropped: {} } } };
  expect(validateSnapshotInvariants(snapshot, CTX)).toEqual({ ok: true });
  for (const airDrop of [null, { manual: "true" }, { record: { start: {}, dropped: {} } },
    { record: { start: { ...start, airDrop: {} }, dropped: {} } },
    { record: { start, dropped: { u1: -1 } } }]) {
    expect(validateSnapshotInvariants({ ...start, airDrop }, CTX).ok).toBe(false);
  }
});

it("AER125: legacy full-state drop starts survive save/load and snapshot rescue unchanged", async () => {
  const s = newSession(CTX.scenario, "axis", 1, false);
  const start = JSON.parse(JSON.stringify(s.state)) as GameState;
  s.state = { ...s.state, airDrop: { manual: true, record: { start, dropped: {} } } };
  await roundTrip(s, { kind: "snapshot", state: JSON.parse(JSON.stringify(s.state)) as JsonObject });
});
