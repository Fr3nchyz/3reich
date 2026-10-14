import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import type { GameState } from "../src/engine/types";
import {
  actionsPerSlice, afterAction, beginStep, createWatchInfo, delayBefore, isRunning, markStuck, overOf, pause, play, setSpeed, shouldRun, SLICE_MS, speedDelay, SPEEDS, STEP_ACTION_LIMIT, stuckMessage,
  TURN_ACTION_LIMIT, type WatchInfo,
} from "../src/ui/watchController";
import { atStart, CTX, endTurn } from "./helpers";

/** The pure rules of the watch mode (spec 06): speeds, step modes, stuck detection, end of game. */

const start = (): GameState => atStart(SCENARIO_1939, 1);
const info = (turns: number | null = null): WatchInfo => createWatchInfo(start(), 12, "normal", turns);
/** A state in the next Player Turn of the same Game Turn, and one in the next Game Turn. */
const nextPlayerTurn = (s: GameState): GameState => { const r = endTurn(CTX, s); if (!r.ok) throw new Error(r.error); return r.state; };

describe("speed", () => {
  it("maps to the delays the product owner asked for", () => {
    expect([speedDelay("slow"), speedDelay("normal"), speedDelay("fast"), speedDelay("turbo")]).toEqual([600, 150, 20, 0]);
    expect(SPEEDS.slow.delayMs).toBeGreaterThan(SPEEDS.normal.delayMs);
    expect(SPEEDS.normal.delayMs).toBeGreaterThan(SPEEDS.fast.delayMs);
  });
  it("is the wait before the next slice, and none while a step is served", () => {
    expect(delayBefore(info())).toBe(150);
    expect(delayBefore(setSpeed(info(), "slow"))).toBe(600);
    expect(delayBefore(beginStep(info(), "action", start()))).toBe(0);
  });
  it("only Turbo and 'next turn' take many actions per slice; a slice is short enough to repaint every 100 ms", () => {
    expect(actionsPerSlice(setSpeed(info(), "slow"))).toBe(1);
    expect(actionsPerSlice(setSpeed(info(), "fast"))).toBe(1);
    expect(actionsPerSlice(setSpeed(info(), "turbo"))).toBe(Infinity);
    expect(actionsPerSlice(beginStep(info(), "turn", start()))).toBe(Infinity);
    expect(actionsPerSlice(beginStep(setSpeed(info(), "turbo"), "action", start()))).toBe(1);
    expect(SLICE_MS).toBeLessThanOrEqual(100);
  });
});

describe("pause, play and the step modes", () => {
  it("runs until paused; a paused run does not play", () => {
    const s = start();
    expect(shouldRun(info(), s)).toBe(true);
    expect(shouldRun(pause(info()), s)).toBe(false);
    expect(shouldRun(play(pause(info())), s)).toBe(true);
  });
  it("'step one action' runs exactly one action, then stays paused", () => {
    const s = start();
    const stepping = beginStep(info(), "action", s);
    expect(stepping.paused).toBe(true);
    expect(shouldRun(stepping, s)).toBe(true);
    const after = afterAction(stepping, s);
    expect(after.actions).toBe(1);
    expect(after.step).toBeNull();
    expect(shouldRun(after, s)).toBe(false);
  });
  it("'step to next turn' keeps going within the Game Turn and stops when the Game Turn changes", () => {
    const s0 = start();
    let i = beginStep(info(), "turn", s0);
    const sameTurn = nextPlayerTurn(s0); // the other side's Player Turn, same Game Turn
    expect(sameTurn.season === s0.season && sameTurn.year === s0.year).toBe(true);
    i = afterAction(i, sameTurn);
    expect(i.step).toBe("turn");
    expect(shouldRun(i, sameTurn)).toBe(true);
    const next = nextPlayerTurn(sameTurn); // the next Game Turn begins
    expect(next.season === s0.season && next.year === s0.year).toBe(false);
    i = afterAction(i, next);
    expect(i.step).toBeNull();
    expect(shouldRun(i, next)).toBe(false);
    expect(i.paused).toBe(true);
  });
  it("'pause' stops a step that is still running to the next Game Turn, and the run counts as running while a step is served", () => {
    const s = start();
    const stepping = beginStep(info(), "turn", s);
    expect(isRunning(stepping)).toBe(true); // the bar then offers "Pause", not "Play"
    expect(isRunning(info())).toBe(true);
    const stopped = pause(stepping);
    expect(stopped.step).toBeNull();
    expect(isRunning(stopped)).toBe(false);
    expect(shouldRun(stopped, s)).toBe(false);
    // and a paused run served one action counts as running only until that action is done
    const one = beginStep(pause(info()), "action", s);
    expect(isRunning(one)).toBe(true);
    expect(isRunning(afterAction(one, s))).toBe(false);
  });
  it("'play' cancels a step in progress and resumes", () => {
    const i = play(beginStep(info(), "turn", start()));
    expect(i.paused).toBe(false);
    expect(i.step).toBeNull();
  });
});

describe("stuck detection", () => {
  it("counts actions at one step and resets when the step changes", () => {
    const s = start();
    let i = info();
    for (let k = 0; k < 5; k++) i = afterAction(i, s);
    expect(i.atPlace).toBe(5);
    i = afterAction(i, nextPlayerTurn(s));
    expect(i.atPlace).toBe(0);
    expect(i.stuck).toBeNull();
  });
  it("flags no progress after the limit at one step, not before", () => {
    const s = start();
    let i = info();
    for (let k = 0; k < STEP_ACTION_LIMIT; k++) i = afterAction(i, s);
    expect(i.stuck).toBeNull();
    i = afterAction(i, s);
    expect(i.stuck?.kind).toBe("no-progress");
    expect(shouldRun(i, s)).toBe(false);
  });
  it("flags a Game Turn that takes too many actions even if steps change", () => {
    const a = start();
    const b = nextPlayerTurn(a); // another place, same Game Turn
    let i = info();
    for (let k = 0; k < TURN_ACTION_LIMIT; k++) i = afterAction(i, k % 2 ? a : b);
    expect(i.stuck).toBeNull();
    i = afterAction(i, a);
    expect(i.stuck?.kind).toBe("turn-budget");
  });
  it("a stuck run stays stuck, ends a step, and names where", () => {
    const s = start();
    const i = markStuck(beginStep(info(), "turn", s), "stuck", "the computer has no action to take");
    expect(i.stuck?.kind).toBe("stuck");
    expect(i.step).toBeNull();
    expect(shouldRun(play(i), s)).toBe(false);
    expect(stuckMessage(i.stuck!, "Summer 1939, Axis, step 6f")).toBe("The computer got stuck at Summer 1939, Axis, step 6f: the computer has no action to take.");
  });
});

describe("end of the game", () => {
  it("is over when the scenario ends", () => {
    const s = { ...start(), phase: "game-over" as const };
    expect(overOf(info(), s)).toBe("game-over");
    expect(shouldRun(info(), s)).toBe(false);
  });
  it("is not over while it is being played", () => {
    expect(overOf(info(), start())).toBeNull();
    expect(overOf(info(null), start())).toBeNull();
  });
  it("is over once the chosen number of Game Turns is played", () => {
    const s0 = start();
    const i = info(1);
    expect(overOf(i, s0)).toBeNull();
    const next = nextPlayerTurn(nextPlayerTurn(s0));
    expect(overOf(i, next)).toBe("turn-limit");
    expect(shouldRun(i, next)).toBe(false);
    expect(overOf(info(2), next)).toBeNull();
  });
  it("a limit of 0 or less means no limit", () => {
    expect(info(0).endAtTurn).toBeNull();
  });
});
