import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { newGame } from "../src/engine/game";
import type { GameState } from "../src/engine/types";

/** Play a whole scenario by always taking the first legal action. */
function playThrough(initial: GameState): Action[] {
  const actions: Action[] = [];
  let state = initial;
  for (let guard = 0; guard < 1000; guard++) {
    const legal = legalActions(state);
    if (legal.length === 0) return actions;
    const r = applyAction(state, legal[0]!);
    if (!r.ok) throw new Error(r.error);
    actions.push(legal[0]!);
    state = r.state;
  }
  throw new Error("Scenario did not end");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe("new game", () => {
  it("requires a valid seed", () => {
    for (const seed of [-1, 1.5, 2 ** 32, Number.NaN]) expect(() => newGame(SCENARIO_1939, seed)).toThrow();
  });

  it("does not share objects with the scenario definition", () => {
    const state = newGame(SCENARIO_1939, 1);
    expect(state.nations.germany).toEqual(SCENARIO_1939.nations.germany);
    expect(state.nations.germany).not.toBe(SCENARIO_1939.nations.germany);
  });
});

describe("actions", () => {
  it("offers only the active side's actions", () => {
    expect(legalActions(newGame(SCENARIO_1939, 1))).toEqual([{ type: "END_PLAYER_TURN", side: "axis" }]);
  });

  it("rejects an action for the wrong side without changing anything", () => {
    const state = newGame(SCENARIO_1939, 1);
    const r = applyAction(state, { type: "END_PLAYER_TURN", side: "allies" });
    expect(r.ok).toBe(false);
  });

  it("runs the 1939 scenario for exactly 12 Game Turns, then stops", () => {
    const initial = newGame(SCENARIO_1939, 1);
    const actions = playThrough(initial);
    expect(actions).toHaveLength(24);
    const { state, events } = replay(initial, actions);
    expect([state.phase, state.year, state.season]).toEqual(["game-over", 1942, "summer"]);
    expect(events.filter((e) => e.type === "GAME_OVER")).toHaveLength(1);
    expect(legalActions(state)).toEqual([]);
    expect(applyAction(state, { type: "END_PLAYER_TURN", side: state.activeSide }).ok).toBe(false);
  });

  it("never mutates the state it is given", () => {
    const initial = deepFreeze(newGame(SCENARIO_1939, 1));
    expect(() => replay(initial, playThrough(initial))).not.toThrow();
  });
});

describe("determinism and serialization", () => {
  it("replays identically, including from a JSON action log", () => {
    const initial = newGame(SCENARIO_1939, 7);
    const actions = playThrough(initial);
    const a = replay(initial, actions);
    const b = replay(JSON.parse(JSON.stringify(initial)), JSON.parse(JSON.stringify(actions)));
    expect(b).toStrictEqual(a);
  });

  it("round-trips a mid-game state through JSON", () => {
    const initial = newGame(SCENARIO_1939, 7);
    const { state } = replay(initial, playThrough(initial).slice(0, 7));
    expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
  });

  it("refuses to replay an illegal action log", () => {
    const initial = newGame(SCENARIO_1939, 7);
    expect(() => replay(initial, [{ type: "END_PLAYER_TURN", side: "allies" }])).toThrow(/illegal/);
  });
});
