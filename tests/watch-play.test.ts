import { describe, expect, it, vi } from "vitest";
import { runGame } from "../scripts/selfplay/runner";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { replay } from "../src/engine/actions";
import { newGame } from "../src/engine/game";
import { computerToMove, computerTick } from "../src/ui/computerPlay";
import { beginStep, overOf, pause, setSpeed, shouldRun, SLICE_MS } from "../src/ui/watchController";
import { endText, newWatchSession, recordFor, stuckText, takeOver, watchSlice, whereText } from "../src/ui/watchPlay";
import { recordName } from "../src/ui/watchRecord";
import { statusLine } from "../src/ui/watchBar";
import { summarise } from "../src/ui/watchSummary";
import { MAX_TURNS, parseSeed, parseTurns, seedError, SEED_ERROR, turnsError, TURNS_ERROR } from "../src/ui/watchMenu";
import { describeUnits } from "../src/ui/format";
import type { Session } from "../src/ui/session";

/** The session glue of the watch mode (spec 06): setup, slices, records, take over. */

const fresh = (turns: number | null = null, speed: "slow" | "turbo" = "slow"): Session => newWatchSession(SCENARIO_1939, 7, speed, turns);
const w = (s: Session) => s.watch!;

describe("a new watched game", () => {
  it("is set up for both sides by the engine's automatic setup and waits at the first Player Turn", () => {
    const s = fresh();
    expect(s.state.phase).toBe("player-turn");
    expect(w(s).actions).toBe(0);
    expect(w(s).setupActions).toBeGreaterThan(10);
    expect(s.record).toHaveLength(w(s).setupActions);
    expect(s.log[0]).toContain("seed 7");
    expect(computerToMove(s)).toBe(true);
  });
  it("starts running at the chosen speed", () => {
    expect(w(fresh()).paused).toBe(false);
    expect(w(fresh(null, "turbo")).speed).toBe("turbo");
  });
});

describe("a slice of play", () => {
  it("plays one action at Slow and logs who did what", () => {
    const s = fresh();
    const log = s.log.length;
    watchSlice(s);
    expect(w(s).actions).toBe(1);
    expect(s.record.length).toBe(w(s).setupActions + 1);
    expect(s.log.length).toBeGreaterThan(log);
    expect(s.log.some((l) => /^Computer \((Axis|Allied)\):/.test(l))).toBe(true);
  });
  it("plays nothing when paused, and exactly one action for 'step one action'", () => {
    const s = fresh();
    s.watch = pause(w(s));
    watchSlice(s);
    expect(w(s).actions).toBe(0);
    s.watch = beginStep(w(s), "action", s.state);
    watchSlice(s);
    expect(w(s).actions).toBe(1);
    watchSlice(s);
    expect(w(s).actions).toBe(1);
  });
  it("at Turbo plays many actions but stops when the time slice is used up", () => {
    const s = fresh(null, "turbo");
    let t = 0;
    watchSlice(s, () => (t += 10));
    expect(w(s).actions).toBeGreaterThan(1);
    expect(w(s).actions).toBeLessThanOrEqual(Math.ceil(SLICE_MS / 10) + 1);
  });
  it("does not start another action when the last one cost more than is left of the slice (a slow decision is followed by a repaint)", () => {
    const s = fresh(null, "turbo");
    const clock = [0, 0, 30, 30, 30, 30]; // slice start, action 1 start and end (30 ms), then the check before action 2
    let i = 0;
    watchSlice(s, () => clock[Math.min(i++, clock.length - 1)]!);
    expect(w(s).actions).toBe(1);
  });
  it("'step to next turn' runs to the next Game Turn and stays paused there", () => {
    const s = fresh();
    const turn = `${s.state.year}${s.state.season}`;
    s.watch = beginStep(w(s), "turn", s.state);
    for (let i = 0; i < 400 && shouldRun(w(s), s.state); i++) watchSlice(s);
    expect(`${s.state.year}${s.state.season}`).not.toBe(turn);
    expect(w(s).paused).toBe(true);
    expect(w(s).stuck).toBeNull();
  });
});

describe("the end of a game and the saved record", () => {
  it("stops after the chosen number of Game Turns, with an End of game text and a summary", () => {
    const s = fresh(1, "turbo");
    for (let i = 0; i < 1000 && shouldRun(w(s), s.state); i++) watchSlice(s);
    expect(overOf(w(s), s.state)).toBe("turn-limit");
    expect(endText(s)).toMatch(/Stopped after the chosen number of Game Turns/);
    const sum = summarise(s.ctx, s.state);
    expect(sum.units.axis).toBeGreaterThan(0);
    expect(sum.units.allies).toBeGreaterThan(0);
    expect(sum.hexes.axis + sum.hexes.allies).toBeGreaterThan(100);
    expect(sum.brps.germany).toBe(s.state.nations.germany.brpTotal);
    expect(statusLine(s)).toMatch(/ended/);
  }, 60_000);

  it("at the end of the scenario the End of game text and the log give the result (Ref 2.0; spec 14 ticket 14-3)", () => {
    const s = newWatchSession({ ...SCENARIO_1942, end: SCENARIO_1942.start }, 3, "turbo", null);
    for (let i = 0; i < 2000 && shouldRun(w(s), s.state); i++) watchSlice(s);
    expect(overOf(w(s), s.state)).toBe("game-over");
    expect(s.state.result).toBeDefined();
    expect(endText(s)).toBe("The scenario ends after Spring 1942. Axis Decisive Victory. Objectives held: Axis 25, Allies 14, nobody 3.");
    expect(s.log.some((l) => l.includes("Axis Decisive Victory. Objectives held: Axis 25"))).toBe(true);
  }, 60_000);

  it("is a self-play recording: the engine's replay() reproduces the game from the scenario and seed", () => {
    const s = fresh(1, "turbo");
    for (let i = 0; i < 1000 && shouldRun(w(s), s.state); i++) watchSlice(s);
    const saved = JSON.parse(JSON.stringify(recordFor(s))) as ReturnType<typeof recordFor>;
    expect(saved).toMatchObject({ format: 1, scenario: "1939", seed: 7, turns: 1, ended: "turn-limit", setupActions: w(s).setupActions, anomalies: [] });
    expect(recordName(saved)).toBe("1939-seed7.json");
    const again = replay(s.ctx, newGame(SCENARIO_1939, saved.seed), saved.actions);
    expect(JSON.stringify(again.state)).toBe(JSON.stringify(s.state));
  }, 60_000);

  it("is the same game as the self-play runner plays for the same scenario and seed", () => {
    const s = fresh(1, "turbo");
    for (let i = 0; i < 1000 && shouldRun(w(s), s.state); i++) watchSlice(s);
    const headless = runGame({ scenario: "1939", seed: 7, turns: 1 });
    expect(s.record).toEqual(headless.actions);
  }, 60_000);

  it("is the same game for the same seed, and a different one for another seed", () => {
    const play = (seed: number) => {
      const s = newWatchSession(SCENARIO_1939, seed, "turbo", null);
      let t = 0;
      for (let i = 0; i < 20; i++) watchSlice(s, () => (t += 10));
      return JSON.stringify(s.record);
    };
    expect(play(3)).toBe(play(3));
    expect(play(3)).not.toBe(play(4));
  }, 60_000);
});

describe("a computer that cannot move", () => {
  it("stops with a message that says where, keeps the state, and is not asked again", async () => {
    vi.resetModules();
    vi.doMock("../src/ai", async (orig) => ({ ...(await orig<Record<string, unknown>>()), chooseAction: () => null }));
    const play = await import("../src/ui/watchPlay");
    const ctl = await import("../src/ui/watchController");
    const s = play.newWatchSession(SCENARIO_1942, 1, "slow", null);
    const before = s.state;
    play.watchSlice(s);
    expect(s.watch!.stuck?.kind).toBe("stuck");
    expect(play.stuckText(s)).toMatch(/^The computer got stuck at .*step .*: the computer has no action to take\.$/);
    expect(s.state).toBe(before);
    expect(ctl.shouldRun(s.watch!, s.state)).toBe(false);
    expect(play.recordFor(s).anomalies[0]?.kind).toBe("stuck");
    vi.doUnmock("../src/ai");
  });
  it("a thrown error is caught and reported the same way", async () => {
    vi.resetModules();
    vi.doMock("../src/ai", async (orig) => ({ ...(await orig<Record<string, unknown>>()), chooseAction: () => { throw new Error("boom"); } }));
    const play = await import("../src/ui/watchPlay");
    const s = play.newWatchSession(SCENARIO_1939, 1, "turbo", null);
    play.watchSlice(s);
    expect(s.watch!.stuck).toEqual({ kind: "exception", detail: "boom" });
    expect(play.stuckText(s)).toContain("boom");
    vi.doUnmock("../src/ai");
  });
  it("is not stuck when all is well", () => {
    expect(stuckText(fresh())).toBe("");
  });
});

describe("take over", () => {
  it("turns the game into a single-player one: the human has the chosen side, the computer the other, and the state is unchanged", () => {
    const s = fresh(null, "turbo");
    for (let i = 0; i < 12; i++) watchSlice(s);
    const state = s.state;
    const mover = state.activeSide;
    takeOver(s, mover === "axis" ? "allies" : "axis");
    expect(s.watch).toBeUndefined();
    expect(s.record.length).toBeGreaterThan(0); // spec 11 part G: takeover retains the record.
    expect(s.state).toBe(state);
    expect(computerToMove(s)).toBe(true); // the human took the side that is not up: the computer keeps playing the side that is
    expect(computerTick(s)).not.toBe("stuck");
    expect(s.log.at(-1)).not.toBeUndefined();
  });
  it("when the human takes the side that is up, the computer waits for the human", () => {
    const s = fresh();
    takeOver(s, s.state.activeSide);
    expect(computerToMove(s)).toBe(false);
  });
});

describe("text and menu helpers", () => {
  it("says where the game is", () => {
    expect(whereText(fresh())).toMatch(/^\w+ 19\d\d, (Axis|Allied) player turn, step /);
  });
  it("the status line holds scenario, Game Turn, side to move, step, action count and the acting side", () => {
    const s = fresh();
    s.watch = setSpeed(w(s), "fast");
    const line = statusLine(s);
    expect(line).toMatch(/^1939 Scenario · Game Turn \w+ 19\d\d · (Axis|Allied) to move · step \S+ \(.+\) · action 0 · (Axis|Allied) acting · running \(Fast\)$/);
    watchSlice(s);
    expect(statusLine(s)).toContain("action 1");
    s.watch = pause(w(s));
    expect(statusLine(s)).toMatch(/paused$/);
  });
  it("reads a seed and a number of turns from the menu fields", () => {
    expect(parseSeed("42")).toBe(42);
    expect(parseSeed(" 4294967295 ")).toBe(4294967295);
    expect([parseSeed("4294967296"), parseSeed("-1"), parseSeed("1.5"), parseSeed(""), parseSeed("abc")]).toEqual([null, null, null, null, null]);
    expect([parseTurns("3"), parseTurns(" 99 "), parseTurns(""), parseTurns("0"), parseTurns("100"), parseTurns("2.5"), parseTurns("-1"), parseTurns("x")]).toEqual([3, MAX_TURNS, null, null, null, null, null, null]);
  });
  it("tells the player what is wrong with a seed or a number of Game Turns instead of falling back", () => {
    expect([seedError("0"), seedError("4294967295"), seedError(" 12 ")]).toEqual(["", "", ""]);
    expect([seedError(""), seedError("abc"), seedError("-3"), seedError("1.5"), seedError("4294967296"), seedError("99999999999")]).toEqual(Array(6).fill(SEED_ERROR));
    expect([turnsError(""), turnsError("  "), turnsError("1"), turnsError("99")]).toEqual(["", "", "", ""]);
    expect([turnsError("0"), turnsError("100"), turnsError("2.5"), turnsError("x"), turnsError("-1")]).toEqual(Array(5).fill(TURNS_ERROR));
  });
  it("lists the counters of a hex for the hex info: grouped, with factor, type and nation", () => {
    const s = fresh();
    const [a, b] = Object.values(s.state.units).filter((u) => s.ctx.map.hexes[u.at]);
    const one = describeUnits(s.state, a!.at);
    expect(one).toMatch(/^Units: \d+ x \d+-\w+ \(.+\)/);
    expect(describeUnits(s.state, "no-such-hex")).toBe("");
    expect(describeUnits({ ...s.state, units: { x: { ...a!, id: "x" }, y: { ...a!, id: "y" } } }, a!.at)).toMatch(/^Units: 2 x /);
    expect(b).toBeDefined();
  });
});
