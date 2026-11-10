import { describe, expect, it } from "vitest";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { newAirTurn } from "../src/engine/air-record";
import { newGame } from "../src/engine/game";
import { fleetMoveOptions, movableFleets } from "../src/engine/fleet-move";
import { setManualFleetMove } from "../src/engine/naval-actions";
import { navalOf } from "../src/engine/naval-record";
import { settle } from "../src/engine/turn";
import type { GameState } from "../src/engine/types";
import { describeEvent } from "../src/ui/eventText";
import { actorSide, eventSide } from "../src/ui/logSide";
import { newSession, run } from "../src/ui/session";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { board, counter } from "./board";
import { CTX } from "./helpers";

const path = ["K21", "L20", "L19", "M18", "N18"];
const move: Extract<Action, { type: "MOVE_FLEET" }> = { type: "MOVE_FLEET", side: "allies", fleet: "b1", to: "N18", front: "western" };
function position(enabled = true): GameState {
  const state = board([counter("b1", "britain", "fleet", 9, "K21")], undefined, {
    activeSide: "allies", position: { part: "player-turn", turn: 1, step: "6b" },
    frontOptions: { western: { option: "attrition" } }, control: { N18: "britain" },
  });
  const s = { ...state, air: newAirTurn(state) };
  return enabled ? setManualFleetMove(s, true) : s;
}
function apply(state: GameState, action: Action = move) {
  const result = applyAction(CTX, state, action);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result;
}
const step = (state: GameState) => state.position?.part === "player-turn" ? state.position.step : undefined;
const end: Action = { type: "END_STEP", side: "allies", step: "6b" };

describe("fleet movement wiring (spec 12 R10, Wiring 12-11b; TODO(verify) AER75)", () => {
  it("stops at 6b through the real turn flow only with opt-in and work (AER75)", () => {
    const state = position();
    const before = { ...state, position: { part: "player-turn" as const, turn: 1 as const, step: "3" } };
    const arrived = apply(before, { type: "END_STEP", side: "allies", step: "3" });
    expect(step(arrived.state)).toBe("6b");
    expect(settle(CTX, state).state).toBe(state);
    const empty = { ...state, units: {} };
    expect(step(settle(CTX, empty).state)).not.toBe("6b");
  });

  it("lists precisely the movable fleets' deterministic options and END_STEP (R10, AER75)", () => {
    const state = position();
    const expected = movableFleets(CTX, state).flatMap(id => fleetMoveOptions(CTX, state, id).map(o => ({ type: "MOVE_FLEET", side: "allies", ...o })));
    expect(expected).toContainEqual({ ...move, path });
    expect(legalActions(CTX, state)).toEqual([...expected, end]);
    expect(legalActions(CTX, state)).toEqual(legalActions(CTX, structuredClone(state)));
    for (const action of legalActions(CTX, state)) expect(applyAction(CTX, state, action).ok).toBe(true);
  });

  it.each([undefined, false])("absent/false flag (%s) preserves skipping, no action and legal END_STEP (AER75)", enabled => {
    const old = position(false);
    const state = enabled === false ? setManualFleetMove(old, false) : old;
    const before = structuredClone(state);
    expect(legalActions(CTX, state)).toEqual([end]);
    expect(applyAction(CTX, state, move).ok).toBe(false);
    expect(step(settle(CTX, state).state)).not.toBe("6b");
    expect(applyAction(CTX, state, end).ok).toBe(true);
    expect(state).toEqual(before);
  });

  it.each(["3", "6f", "7b", "9e"])("does not list or apply movement at %s (R10)", id => {
    const state = { ...position(), position: { part: "player-turn" as const, turn: 1 as const, step: id } };
    expect(legalActions(CTX, state).some(a => a.type === "MOVE_FLEET")).toBe(false);
    expect(applyAction(CTX, state, move).ok).toBe(false);
  });

  it("rejects setup, wrong side, enemy fleet, unknown fleet, illegal port/front/course (R10)", () => {
    const state = position();
    const before = structuredClone(state);
    expect(applyAction(CTX, { ...state, phase: "setup" }, move).ok).toBe(false);
    for (const change of [{ side: "axis" as const }, { fleet: "missing" }, { to: "K21" }, { front: "eastern" as const }, { path: [] }]) {
      expect(applyAction(CTX, state, { ...move, ...change }).ok).toBe(false);
    }
    expect(applyAction(CTX, { ...state, units: { b1: { ...state.units.b1!, owner: "germany" } } }, move).ok).toBe(false);
    expect(state).toEqual(before);
  });

  it("moves, stores the resolved course, emits the event and replays deterministically (R10)", () => {
    const state = position();
    const before = structuredClone(state);
    const result = apply(state);
    expect(result.state.units.b1!.at).toBe("N18");
    const course = { fleet: "b1", from: "K21", to: "N18", front: "western", path };
    expect(result.state.naval!.moves).toEqual([course]);
    expect(result.state.naval!.moved).toEqual(["b1"]);
    expect(result.events).toEqual([{ type: "FLEET_MOVED", side: "allies", ...course }]);
    expect(replay(CTX, state, [move])).toEqual({ state: result.state, events: result.events });
    expect(applyAction(CTX, result.state, { ...move, to: "K21" }).ok).toBe(false);
    expect(legalActions(CTX, result.state)).toEqual([end]);
    expect(applyAction(CTX, result.state, end).ok).toBe(true);
    expect(state).toEqual(before);
  });

  it("retains explicit courses and earlier moves without sharing the input path (R10)", () => {
    const state = position();
    state.naval!.moves = [{ fleet: "earlier", from: "K21", to: "N18", front: "western", path: [...path] }];
    const input = [...path];
    const result = apply(state, { ...move, path: input });
    expect(result.state.naval!.moves).toHaveLength(2);
    expect(result.state.naval!.moves![0]).toEqual(state.naval!.moves[0]);
    input.pop();
    expect(result.state.naval!.moves![1]!.path).toEqual(path);
  });

  it("expires courses but preserves the opt-in at Player/Game Turn boundaries (R10, AER75)", () => {
    const state = apply(position()).state;
    for (const change of [{ activeSide: "axis" as const }, { year: state.year + 1 }]) {
      const record = navalOf({ ...state, ...change });
      expect(record.moves).toBeUndefined();
      expect(record.moved).toEqual([]);
      expect(record.manualFleetMove).toBe(true);
    }
  });

  it("loads old JSON state unchanged and leaves engine/watch creation defaults empty (AER75)", () => {
    const state = position(false);
    const loaded = JSON.parse(JSON.stringify(state)) as GameState;
    expect(loaded).toEqual(state);
    expect(navalOf(loaded).manualFleetMove).toBeUndefined();
    expect(navalOf(newGame(SCENARIO_1939, 1)).moves).toBeUndefined();
    expect(newSession(SCENARIO_1939, "axis", 1).state.naval).toBeUndefined();
    expect(legalActions(CTX, loaded)).toEqual([end]);
    expect(apply(loaded, end)).toEqual(apply(state, end));
  });

  it("provides a pure opt-in setter and writes a side-coloured log line (R10, AER75)", () => {
    const session = newSession(SCENARIO_1939, "allies", 1);
    const before = structuredClone(session.state);
    const enabled = setManualFleetMove(session.state, true);
    expect(enabled.naval!.manualFleetMove).toBe(true);
    expect(session.state).toEqual(before);
    expect(setManualFleetMove(enabled, false).naval!.manualFleetMove).toBe(false);
    session.state = position();
    const event = apply(session.state).events[0]!;
    expect(describeEvent(event, CTX, new Set(), new Map(), session.state)).toMatch(/changes base from .* to .*Western Front/);
    expect(actorSide(move)).toBe("allies");
    expect(eventSide(event, "axis", session.state)).toBe("allies");
    expect(run(session, move)).toBe(true);
    expect(session.log.at(-1)).toMatch(/changes base/);
    expect(session.logSides!.get(session.log.length - 1)).toBe("allies");
  });
});
