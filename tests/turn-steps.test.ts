import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { applyAction, legalActions, replay, type Action, type GameEvent } from "../src/engine/actions";
import type { GameContext } from "../src/engine/context";
import { newGame } from "../src/engine/game";
import { FIRST_STEP, IMPLEMENTED_STEPS, LAST_STEP, PLAYER_TURN_STEPS, playerTurnStepIds } from "../src/engine/sequence";
import { beginPlay, positionId } from "../src/engine/turn";
import type { GameState, Scenario } from "../src/engine/types";
import { CTX, atStart, ctxFor, started } from "./helpers";

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
/** The move-on action: always the last one offered (declarations of war come before it). */
const moveOn = (ctx: GameContext, s: GameState): Action => {
  const legal = legalActions(ctx, s);
  expect(legal.length).toBeGreaterThan(0);
  return legal.at(-1)!;
};
const play = (ctx: GameContext, scenario: Scenario) => beginPlay(ctx, { ...newGame(scenario, 1), phase: "player-turn", setup: null }).state;
const passedIn = (events: GameEvent[]) => events.flatMap((e) => (e.type === "STEPS_PASSED" ? e.steps : []));

describe("the position in the game", () => {
  it("has none during setup", () => {
    expect(newGame(SCENARIO_1939, 1).position).toBeNull();
  });

  it("starts play at step 1 when the side to move has a declaration of war to make", () => {
    const s = atStart(SCENARIO_1939, 1);
    expect(s.position).toEqual({ part: "player-turn", turn: 1, step: FIRST_STEP });
    expect(legalActions(CTX, s).at(-1)).toEqual({ type: "END_STEP", side: "axis", step: FIRST_STEP });
  });

  it("passes step 1 when there is nothing to declare and waits at 8b, where the Germans may build (1944: no war on neutrals)", () => {
    const ctx = ctxFor(SCENARIO_1944);
    const s = play(ctx, SCENARIO_1944);
    expect(s.position).toEqual({ part: "player-turn", turn: 1, step: "8b" });
    expect(legalActions(ctx, s).at(-1)).toEqual({ type: "END_STEP", side: s.activeSide, step: "8b" });
  });

  it("leaves step 1 for 8b once the side is done, passing steps 2 to 8a", () => {
    const s = atStart(SCENARIO_1939, 1);
    const r = apply(CTX, s, moveOn(CTX, s));
    expect(r.state.position).toEqual({ part: "player-turn", turn: 1, step: "8b" });
    expect(passedIn(r.events)).toEqual(STEPS.slice(1, STEPS.indexOf("8b")));
  });

  it("passes 9a when there is nothing to grant and waits at 10b", () => {
    const at8b = apply(CTX, atStart(SCENARIO_1939, 1), moveOn(CTX, atStart(SCENARIO_1939, 1))).state;
    const r = apply(CTX, at8b, moveOn(CTX, at8b));
    expect(r.state.position).toEqual({ part: "player-turn", turn: 1, step: LAST_STEP });
    expect(passedIn(r.events)).toEqual(STEPS.slice(STEPS.indexOf("8b") + 1, -1));
  });
});

describe("walking the whole Sequence of Play", () => {
  it("visits every step of both Player Turns in order, then reaches the next Game Turn", () => {
    let s = play(EVERY_STEP, SCENARIO_1939);
    const seen: string[] = [];
    const sides: string[] = [];
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
  /** Plays one whole Game Turn from where `s` stands, always moving on, and returns every event. */
  function oneGameTurn(ctx: GameContext, s: GameState): GameEvent[] {
    const events: GameEvent[] = [];
    const turn = s.season;
    for (let guard = 0; guard < 200 && (s.season === turn || events.length === 0); guard++) {
      const r = apply(ctx, s, moveOn(ctx, s));
      s = r.state;
      events.push(...r.events);
    }
    return events;
  }

  it("records exactly the steps that are not waited at, and never a step that is", () => {
    const events = oneGameTurn(CTX, atStart(SCENARIO_1939, 1));
    const passed = passedIn(events);
    // Both sides had something to declare and to build, so steps 1 and 8b were waited at and never recorded as
    // passed. Germany has nobody to grant to, so 9a passed for the Axis; the Allies (Britain to France) waited at it.
    const without = (waited: string[]) => STEPS.slice(1, -1).filter((id) => !waited.includes(id));
    expect(passed).toEqual([...without(["8b"]), ...without(["8b", "9a"]), "II.A"]);
    // A step is only ever passed if it has no rules yet, or its rules found nothing to do (the gated steps).
    for (const id of passed) expect(!IMPLEMENTED_STEPS.has(id) || ["1", "8b", "9a"].includes(id)).toBe(true);
  });

  it("records step 1 as passed when a side has nothing to declare", () => {
    const ctx = ctxFor(SCENARIO_1944);
    const events = oneGameTurn(ctx, play(ctx, SCENARIO_1944));
    expect(passedIn(events)).toContain(FIRST_STEP);
  });

  it("decides the Initiative at II.B, right after the passed II.A", () => {
    const order = oneGameTurn(CTX, atStart(SCENARIO_1939, 1)).map((e) => (e.type === "STEPS_PASSED" ? `passed:${e.steps.length}` : e.type));
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
    const all = (s: GameState) => passedIn(apply(CTX, s, { type: "END_PLAYER_TURN", side: "allies" }).events);
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
    const r = applyAction(CTX, atStart(SCENARIO_1939, 1), { type: "END_PLAYER_TURN", side: "axis" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/step 1 \(Make Declarations of War/);
  });

  it("refuses a declaration of war after step 1, naming the current step", () => {
    const r = applyAction(CTX, started(SCENARIO_1939, 1), { type: "DECLARE_WAR", by: "germany", on: "norway" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Declarations of war are made in step 1.*10b/);
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
    const initial = atStart(SCENARIO_1939, 5);
    const actions: Action[] = [];
    let s = initial;
    // Move on until the second Player Turn of the next Game Turn waits at its last step.
    for (let i = 0; i < 40 && !(s.season === "winter" && s.position?.part === "player-turn" && s.position.turn === 2 && s.position.step === LAST_STEP); i++) {
      const a = moveOn(CTX, s);
      actions.push(a);
      s = apply(CTX, s, a).state;
    }
    expect(replay(CTX, initial, actions).state).toEqual(s);
    expect(s.position).toEqual({ part: "player-turn", turn: 2, step: LAST_STEP });
    expect(actions.length).toBeGreaterThan(8);
  });
});
