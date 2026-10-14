import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, replay, type Action, type GameEvent } from "../src/engine/actions";
import type { GameContext } from "../src/engine/context";
import { newGame } from "../src/engine/game";
import { FIRST_STEP, IMPLEMENTED_STEPS, LAST_STEP, PLAYER_TURN_STEPS, playerTurnStepIds } from "../src/engine/sequence";
import { beginPlay, positionId } from "../src/engine/turn";
import type { GameState } from "../src/engine/types";
import { CTX, ctxFor, started } from "./helpers";

/** Spec 01: the engine knows where in the Sequence of Play it is and refuses actions out of order. */

const STEPS = playerTurnStepIds();
/** A context in which every step has rules built, so the engine waits at each one. */
const EVERY_STEP: GameContext = { ...CTX, implementedSteps: new Set([...STEPS, "II.B"]) };

const stepOf = (s: GameState) => (s.position?.part === "player-turn" ? s.position.step : positionId(s.position!));
const apply = (ctx: GameContext, s: GameState, a: Action) => {
  const r = applyAction(ctx, s, a);
  if (!r.ok) throw new Error(r.error);
  return r;
};
/** The one move-on action the engine offers. */
const moveOn = (ctx: GameContext, s: GameState): Action => {
  const legal = legalActions(ctx, s);
  expect(legal).toHaveLength(1);
  return legal[0]!;
};

describe("the position in the game", () => {
  it("has none during setup, and starts play at the first resting step", () => {
    expect(newGame(SCENARIO_1939, 1).position).toBeNull();
    expect(started(SCENARIO_1939, 1).position).toEqual({ part: "player-turn", turn: 1, step: LAST_STEP });
    expect(started(SCENARIO_1939, 1).phase).toBe("player-turn");
  });

  it("waits at step 1 of the first Player Turn when step 1 has rules", () => {
    const s = beginPlay(EVERY_STEP, { ...newGame(SCENARIO_1939, 1), phase: "player-turn", setup: null }).state;
    expect(s.position).toEqual({ part: "player-turn", turn: 1, step: FIRST_STEP });
    expect(legalActions(EVERY_STEP, s)).toEqual([{ type: "END_STEP", side: "axis", step: FIRST_STEP }]);
  });
});

describe("walking the whole Sequence of Play", () => {
  it("visits every step of both Player Turns in order, then reaches the next Game Turn", () => {
    let s = started(SCENARIO_1939, 1);
    s = { ...s, position: { part: "player-turn", turn: 1, step: FIRST_STEP } };
    const seen: string[] = [];
    const sides: string[] = [];
    // Two Player Turns of one Game Turn.
    for (let i = 0; i < STEPS.length * 2; i++) {
      seen.push(`${(s.position as { turn: number }).turn}:${stepOf(s)}`);
      sides.push(s.activeSide);
      const a = moveOn(EVERY_STEP, s);
      expect(a.type).toBe(stepOf(s) === LAST_STEP ? "END_PLAYER_TURN" : "END_STEP");
      s = apply(EVERY_STEP, s, a).state;
    }
    expect(seen).toEqual([...STEPS.map((id) => `1:${id}`), ...STEPS.map((id) => `2:${id}`)]);
    expect(new Set(sides.slice(0, STEPS.length))).toEqual(new Set(["axis"]));
    expect(new Set(sides.slice(STEPS.length))).toEqual(new Set(["allies"]));
    // The next Game Turn (Winter 1939): II.A passed, II.B decided the order, step 1 of the first Player Turn.
    expect([s.year, s.season]).toEqual([1939, "winter"]);
    expect(s.position).toEqual({ part: "player-turn", turn: 1, step: FIRST_STEP });
  });

  it("covers all 45 steps the card prints", () => {
    expect(STEPS).toHaveLength(45);
    expect(PLAYER_TURN_STEPS).toHaveLength(10);
  });
});

describe("steps without rules are passed, and the passing is recorded", () => {
  it("passes steps 1 to 10a in order and waits at 10b, so a turn is still ended with one action", () => {
    const s = started(SCENARIO_1939, 1);
    const r = apply(CTX, s, { type: "END_PLAYER_TURN", side: "axis" });
    const passed = r.events.filter((e): e is Extract<GameEvent, { type: "STEPS_PASSED" }> => e.type === "STEPS_PASSED");
    // Second Player Turn: steps 1 to 10a passed; then at 10b.
    expect(passed.at(-1)!.steps).toEqual(STEPS.filter((id) => id !== LAST_STEP));
    expect(r.state.activeSide).toBe("allies");
    expect(r.state.position).toEqual({ part: "player-turn", turn: 2, step: LAST_STEP });
  });

  it("records exactly the steps not in the implemented list, and never one that is", () => {
    // Play a full Game Turn from 10b of the first Player Turn through the second.
    let s = started(SCENARIO_1939, 1);
    const events: GameEvent[] = [];
    for (let i = 0; i < 2; i++) {
      const r = apply(CTX, s, { type: "END_PLAYER_TURN", side: s.activeSide });
      s = r.state;
      events.push(...r.events);
    }
    const passed = events.flatMap((e) => (e.type === "STEPS_PASSED" ? e.steps : []));
    expect(passed).toEqual([...STEPS.filter((id) => !IMPLEMENTED_STEPS.has(id)), "II.A", ...STEPS.filter((id) => !IMPLEMENTED_STEPS.has(id))]);
    expect(passed.filter((id) => IMPLEMENTED_STEPS.has(id))).toEqual([]);
  });

  it("lists the unbuilt game-level steps as passed and decides the Initiative at II.B", () => {
    let s = started(SCENARIO_1939, 1);
    const events: GameEvent[] = [];
    for (let i = 0; i < 2; i++) {
      const r = apply(CTX, s, { type: "END_PLAYER_TURN", side: s.activeSide });
      s = r.state;
      events.push(...r.events);
    }
    const order = events.map((e) => (e.type === "STEPS_PASSED" ? `passed:${e.steps.length}` : e.type));
    expect(order.join(" ")).toContain("passed:1 INITIATIVE_DETERMINED PLAYER_TURN_STARTED");
  });
});

describe("the Year Start Sequence and the Russian-Winter roll", () => {
  const lastOfTurn = (year: number, season: GameState["season"]): GameState => ({
    ...started(SCENARIO_1939, 1),
    year,
    season,
    activeSide: "allies",
    position: { part: "player-turn", turn: 2, step: LAST_STEP },
  });

  it("run between a Winter and the next Spring, and nowhere else", () => {
    const all = (s: GameState) => {
      const r = apply(CTX, s, { type: "END_PLAYER_TURN", side: "allies" });
      return r.events.flatMap((e) => (e.type === "STEPS_PASSED" ? e.steps : []));
    };
    expect(all(lastOfTurn(1940, "winter"))).toContain("YSS");
    for (const season of ["spring", "summer", "fall"] as const) expect(all(lastOfTurn(1940, season))).not.toContain("YSS");
  });

  it("keep the order YSS, II.A, II.B", () => {
    const r = apply(CTX, lastOfTurn(1940, "winter"), { type: "END_PLAYER_TURN", side: "allies" });
    const kinds = r.events.map((e) => (e.type === "STEPS_PASSED" ? e.steps.join(",").slice(0, 10) : e.type));
    expect(kinds.slice(0, 3)).toEqual(["YSS,II.A", "INITIATIVE_DETERMINED", "PLAYER_TURN_STARTED"]);
  });
});

describe("actions out of order", () => {
  it("refuses a step action at the wrong step, naming the current step", () => {
    const s = started(SCENARIO_1939, 1);
    const r = applyAction(CTX, s, { type: "END_STEP", side: "axis", step: "6f" });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/10b/);
  });

  it("refuses to end the Player Turn before its last step, naming the step", () => {
    const s = { ...started(SCENARIO_1939, 1), position: { part: "player-turn", turn: 1, step: "6f" } } as GameState;
    const r = applyAction(EVERY_STEP, s, { type: "END_PLAYER_TURN", side: "axis" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/6f \(Conduct normal ground\/air movement\)/);
  });

  it("refuses END_STEP at the last step", () => {
    const r = applyAction(EVERY_STEP, started(SCENARIO_1939, 1), { type: "END_STEP", side: "axis", step: LAST_STEP });
    expect(r.ok).toBe(false);
  });

  it("refuses setup actions once play has begun, naming the step", () => {
    const r = applyAction(CTX, started(SCENARIO_1939, 1), { type: "SETUP_DONE", owner: "germany" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Setup is over.*10b/);
  });

  it("refuses an action for the side that is not up", () => {
    expect(applyAction(CTX, started(SCENARIO_1939, 1), { type: "END_PLAYER_TURN", side: "allies" }).ok).toBe(false);
    expect(applyAction(EVERY_STEP, { ...started(SCENARIO_1939, 1), position: { part: "player-turn", turn: 1, step: "3" } }, { type: "END_STEP", side: "allies", step: "3" }).ok).toBe(false);
  });

  it("refuses a stale END_STEP, so a repeated action cannot skip a step", () => {
    const at3 = { ...started(SCENARIO_1939, 1), position: { part: "player-turn", turn: 1, step: "3" } } as GameState;
    const after = apply(EVERY_STEP, at3, { type: "END_STEP", side: "axis", step: "3" });
    expect(stepOf(after.state)).toBe("4");
    expect(applyAction(EVERY_STEP, after.state, { type: "END_STEP", side: "axis", step: "3" }).ok).toBe(false);
  });

  it("refuses everything in a game that has no position (an old save), with a clear message", () => {
    const old = { ...started(SCENARIO_1939, 1), position: null };
    expect(legalActions(CTX, old)).toEqual([]);
    const r = applyAction(CTX, old, { type: "END_PLAYER_TURN", side: "axis" });
    expect(!r.ok && r.error).toMatch(/no turn position/);
  });

  it("offers nothing after the scenario ends", () => {
    const over = { ...started(SCENARIO_1939, 1), phase: "game-over" } as GameState;
    expect(legalActions(CTX, over)).toEqual([]);
    expect(applyAction(CTX, over, { type: "END_PLAYER_TURN", side: "axis" }).ok).toBe(false);
  });
});

describe("replay", () => {
  it("reproduces the state, including the position, across Game Turns", () => {
    const initial = started(SCENARIO_1939, 5);
    const actions: Action[] = [];
    let s = initial;
    for (let i = 0; i < 7; i++) {
      const a = moveOn(CTX, s);
      actions.push(a);
      s = apply(CTX, s, a).state;
    }
    expect(replay(CTX, initial, actions).state).toEqual(s);
    expect(s.position).toEqual({ part: "player-turn", turn: 2, step: LAST_STEP });
    expect(ctxFor(SCENARIO_1939).implementedSteps).toBeUndefined();
  });
});
