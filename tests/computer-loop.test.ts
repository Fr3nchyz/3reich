import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { COMPUTER_DELAY_MS, createComputerLoop, SLICE_DELAY_MS } from "../src/ui/computerLoop";
import { computerToMove } from "../src/ui/computerPlay";
import { createSession, setupView, type Session } from "../src/ui/session";
import { fillRest, finishOwner } from "../src/ui/sessionActions";

/** The loop that paces the computer's steps in the browser (timers, new game, a place where it cannot move). */

function computersTurn(): Session {
  const s = createSession(SCENARIO_1939, "allies", 2);
  for (let i = 0; i < 20 && s.state.phase === "setup"; i++) {
    fillRest(s);
    const v = setupView(s);
    if (v) finishOwner(s, v.owner);
  }
  expect(computerToMove(s)).toBe(true);
  return s;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createComputerLoop", () => {
  it("plays nothing before its delay, one step after it, and redraws", () => {
    const s = computersTurn();
    const redraw = vi.fn();
    const loop = createComputerLoop(() => s, redraw);
    const before = s.log.length;
    loop.kick();
    loop.kick(); // a second kick does not schedule a second step
    vi.advanceTimersByTime(COMPUTER_DELAY_MS - 1);
    expect(s.log.length).toBe(before);
    vi.advanceTimersByTime(1);
    expect(redraw).toHaveBeenCalledTimes(1);
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)).toMatch(/^Computer \(Axis\):/);
  });

  it("does nothing when it is the player's turn", () => {
    const s = createSession(SCENARIO_1939, "axis", 2);
    const redraw = vi.fn();
    createComputerLoop(() => s, redraw).kick();
    vi.advanceTimersByTime(10_000);
    expect(redraw).not.toHaveBeenCalled();
  });

  it("runs long steps in short slices and ends with the player to move", () => {
    const s = computersTurn();
    let draws = 0;
    const loop = createComputerLoop(() => s, () => { draws++; loop.kick(); });
    loop.kick();
    vi.advanceTimersByTime(60_000);
    expect(computerToMove(s)).toBe(false);
    expect(draws).toBeGreaterThan(2);
    expect(SLICE_DELAY_MS).toBeLessThan(COMPUTER_DELAY_MS);
  });

  it("stops trying where the computer cannot move, and tries again after reset (a new game)", () => {
    const s = computersTurn();
    s.state = { ...s.state, position: null }; // no step to act at: the chooser has nothing
    const redraw = vi.fn();
    const loop = createComputerLoop(() => s, redraw);
    loop.kick();
    vi.advanceTimersByTime(COMPUTER_DELAY_MS);
    expect(s.toast).toContain("could not choose");
    expect(redraw).toHaveBeenCalledTimes(1);
    loop.kick(); // same place: no new timer
    vi.advanceTimersByTime(10_000);
    expect(redraw).toHaveBeenCalledTimes(1);
    loop.reset();
    loop.kick();
    vi.advanceTimersByTime(COMPUTER_DELAY_MS);
    expect(redraw).toHaveBeenCalledTimes(2);
  });

  it("reset cancels a pending step", () => {
    const s = computersTurn();
    const redraw = vi.fn();
    const loop = createComputerLoop(() => s, redraw);
    loop.kick();
    loop.reset();
    vi.advanceTimersByTime(10_000);
    expect(redraw).not.toHaveBeenCalled();
  });
});

