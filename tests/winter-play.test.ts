import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { chooseAction } from "../src/ai";
import { WINTER_POSTPONE_WHEN_ALLOWED } from "../src/ai/winter";
import { applyAction, legalActions, type Action, type GameEvent } from "../src/engine/actions";
import { sideToAct } from "../src/engine/actor";
import type { GameState } from "../src/engine/types";
import { winterAsking } from "../src/engine/winter-record";
import { runGame, type Hooks } from "../scripts/selfplay/runner";
import { computerSide, computerTick, computerToMove } from "../src/ui/computerPlay";
import { createSession, run } from "../src/ui/session";
import { overOf } from "../src/ui/watchController";
import { newWatchSession, watchSlice } from "../src/ui/watchPlay";
import { buttonLabels, statusHtml } from "../src/ui/statusView";
import { winterLine } from "../src/ui/winterText";
import { eventSide } from "../src/ui/logSide";

// Spec 14 ticket 14-11: the computer answers the new prompt at II.A, whole computer games run to the end with it, and the browser asks the right side.

/** The U.S.S.R. is at war with Germany from the first turn, so the Winter 1939 turn rolls the dice, and no Axis unit stands in Russia: the Allies may postpone. */
const warWithRussia: NonNullable<Hooks["prepare"]> = (s) => ({
  ...s,
  wars: [...s.wars, ["germany", "ussr"]],
  nations: { ...s.nations, ussr: { ...s.nations.ussr, status: "allied" } },
});

/** Replays a finished run, collecting the events with the index of the action that produced each, and checking that every state has something to do. */
function replayChecked(r: ReturnType<typeof runGame>, prepare: Hooks["prepare"] = warWithRussia): { events: (GameEvent & { index: number })[]; asked: number } {
  let state = r.initial;
  const events: (GameEvent & { index: number })[] = [];
  let asked = 0;
  r.actions.forEach((a, i) => {
    if (i === r.setupActions && prepare) state = prepare(state); // the runner changed the state once the setup was over
    const res = applyAction(r.ctx, state, a);
    if (!res.ok) throw new Error(`action ${i} refused: ${res.error}`);
    for (const e of res.events) events.push({ ...e, index: i });
    state = res.state;
    // no state is left with nothing to do (a step nobody can act on) while the game is on
    if (state.phase === "player-turn") {
      expect(legalActions(r.ctx, state).length, `legal actions after action ${i}`).toBeGreaterThan(0);
      if (winterAsking(state)) {
        asked++;
        expect(sideToAct(state)).toBe("allies");
      }
    }
  });
  return { events, asked };
}

describe("the computer at II.A", () => {
  it("answers with the postponement the policy names, from the legal list", () => {
    expect(WINTER_POSTPONE_WHEN_ALLOWED).toBe(true);
    const r = runGame({ scenario: "1939", seed: 1, turns: 2, verify: true }, { prepare: warWithRussia });
    // the run stops after two Game Turns: the question was asked at the start of the second, answered, and the game went on
    expect(r.anomalies).toEqual([]);
    const { events } = replayChecked(r);
    expect(events.filter((e) => e.type === "WINTER_ROLLED")).toHaveLength(1);
    expect(r.actions.filter((a) => a.type === "CHOOSE_WINTER")).toEqual([{ type: "CHOOSE_WINTER", side: "allies", postpone: true }]);
  });
  it("chooseAction at the question is the policy's answer, for either side's turn having been the last", () => {
    const r = runGame({ scenario: "1939", seed: 1, turns: 1, verify: false }, { prepare: warWithRussia });
    expect(r.final.position).toEqual({ part: "russian-winter" });
    for (const activeSide of ["axis", "allies"] as const) {
      const s: GameState = { ...r.final, activeSide };
      const d = chooseAction(r.ctx, s, { seed: 1 });
      expect(d?.action).toEqual({ type: "CHOOSE_WINTER", side: "allies", postpone: true });
      expect(d?.why).not.toBe("");
    }
  });
  it("once answered, chooseAction plays the Player Turn again and never repeats the answer", () => {
    const r = runGame({ scenario: "1939", seed: 1, turns: 1, verify: false }, { prepare: warWithRussia });
    const answered = applyAction(r.ctx, r.final, { type: "CHOOSE_WINTER", side: "allies", postpone: false });
    if (!answered.ok) throw new Error(answered.error);
    expect(chooseAction(r.ctx, answered.state, { seed: 1 })?.action.type).not.toBe("CHOOSE_WINTER");
  });
});

describe("whole computer games with the winter question", () => {
  it("1939, postponing: Winter 1939 asks, the Allies wait, Winter 1940 starts with no question, and the winter is never rolled again; six Game Turns, no anomaly", () => {
    const r = runGame({ scenario: "1939", seed: 1, turns: 6, verify: true }, { prepare: warWithRussia });
    expect(r.anomalies).toEqual([]);
    const { events, asked } = replayChecked(r);
    const w = events.filter((e) => e.type.startsWith("WINTER"));
    expect(w.map((e) => e.type)).toEqual(["WINTER_ROLLED", "WINTER_POSTPONED", "WINTER_STARTED"]);
    expect(w[0]).toMatchObject({ mayPostpone: true, axisUnits: 0 });
    expect(w[2]).toMatchObject({ turn: { year: 1940, season: "winter" }, postponedFrom: { year: 1939, season: "winter" } });
    expect(asked).toBe(1); // one state in the whole game waited at II.A
    expect(r.final.winter).toMatchObject({ stage: "over", inForce: "1940-winter", asking: false });
    expect(r.actions.filter((a) => a.type === "CHOOSE_WINTER")).toHaveLength(1);
  });
  it("1939, starting at once: the same game with the Allies answering 'now' has the winter in force in Winter 1939 and never again", () => {
    const now: Hooks["choose"] = (ctx, state, cfg) => {
      const d = chooseAction(ctx, state, cfg);
      return d && d.action.type === "CHOOSE_WINTER" ? { action: { ...d.action, postpone: false }, why: "test" } : d;
    };
    const r = runGame({ scenario: "1939", seed: 1, turns: 6, verify: true }, { prepare: warWithRussia, choose: now });
    expect(r.anomalies).toEqual([]);
    const { events } = replayChecked(r);
    expect(events.filter((e) => e.type.startsWith("WINTER")).map((e) => e.type)).toEqual(["WINTER_ROLLED", "WINTER_STARTED"]);
    expect(r.final.winter).toMatchObject({ stage: "over", inForce: "1939-winter" });
  });
  it("the same game twice gives the same actions and the same state", () => {
    const a = runGame({ scenario: "1939", seed: 2, turns: 3, verify: false }, { prepare: warWithRussia });
    const b = runGame({ scenario: "1939", seed: 2, turns: 3, verify: false }, { prepare: warWithRussia });
    expect(b.actions).toEqual(a.actions);
    expect(b.final).toEqual(a.final);
  });
  // Seed 4 since ticket 16-1 (seed 2 since spec 17, ticket 17-1; seeds 4, 7, 9, 11, 12 tell the story on the combined code): with lost units rebuilt, the Axis of seed 1 now stands in Russia with 18 ground units when Winter 1941 comes (the dice make 8),
  // so the Allies may not wait there; seed 2 is the game this test had in seed 1 (no Axis unit in Russia, dice 9).
  it("1939 seed 4 played to the end: Germany is at war with Russia by Winter 1941, the Axis has no unit in Russia, the Allies wait, and the game ends with a result and no anomaly", () => {
    const r = runGame({ scenario: "1939", seed: 4, turns: "end", verify: true });
    expect(r.anomalies).toEqual([]);
    expect(r.ended).toBe("game-over");
    const { events } = replayChecked(r, (x) => x);
    const w = events.filter((e) => e.type.startsWith("WINTER"));
    expect(w[0]).toMatchObject({ type: "WINTER_ROLLED", mayPostpone: true });
    expect(w[1]).toMatchObject({ type: "WINTER_POSTPONED", turn: { year: 1941, season: "winter" } });
    expect(w).toHaveLength(2); // the 1939 game ends in Summer 1942, before the postponed winter
    expect(r.final.winter?.stage).toBe("postponed");
    expect(r.final.result).toBeDefined();
  });
  it("1942 plays two Game Turns that include no winter roll and no question, and ends at the same place as before", () => {
    const r = runGame({ scenario: "1942", seed: 1, turns: 2, verify: true });
    expect(r.anomalies).toEqual([]);
    expect(r.actions.some((a) => a.type === "CHOOSE_WINTER")).toBe(false);
    expect(r.final.winter).toBeUndefined();
  });
});

describe("a chooser that never answers is an anomaly the self-play runner reports (the question cannot be skipped)", () => {
  it("a computer that tries END_STEP at II.A is refused, and the run stops with a refusal, not a loop", () => {
    const skip: Hooks["choose"] = (ctx, state, cfg) => {
      const d = chooseAction(ctx, state, cfg);
      return d && d.action.type === "CHOOSE_WINTER" ? { action: { type: "END_STEP", side: "allies", step: "10b" } as Action, why: "skip" } : d;
    };
    const r = runGame({ scenario: "1939", seed: 1, turns: 2, verify: true }, { prepare: warWithRussia, choose: skip });
    expect(r.anomalies.map((x) => x.kind)).toContain("refused");
    expect(r.final.position).toEqual({ part: "russian-winter" });
  });
});

describe("the browser asks the right side (computerToMove, computerSide)", () => {
  /** A session standing at the question: the winter state of a computer game, in a session of the 1939 scenario. */
  const atQuestion = (human: "axis" | "allies", activeSide: "axis" | "allies") => {
    const r = runGame({ scenario: "1939", seed: 1, turns: 1, verify: false }, { prepare: warWithRussia });
    const s = createSession(SCENARIO_1939, human, 1);
    s.state = { ...r.final, activeSide };
    return s;
  };
  for (const activeSide of ["axis", "allies"] as const) {
    it(`the player is the Allies (last played: ${activeSide}): the computer does not move, the two answers are the buttons of the winter card`, () => {
      const s = atQuestion("allies", activeSide);
      expect(computerToMove(s)).toBe(false);
      const legal = legalActions(s.ctx, s.state);
      expect(buttonLabels(legal, s.ctx, s.state).map((b) => b.text)).toEqual(["Winter starts now", "Wait for next winter"]);
      const html = statusHtml(s, null, legal);
      expect(html).not.toContain("Computer is playing");
      expect(html).not.toContain("CHOOSE_WINTER");
      expect(html).toContain("step II.A (Russian winter): the Allies say whether it waits");
      expect(html.indexOf("Wait for next winter")).toBeGreaterThan(html.indexOf('id="winter-card"'));
      expect(html).not.toContain("player turn");
    });
    it(`the player is the Axis (last played: ${activeSide}): the computer, playing the Allies, answers`, () => {
      const s = atQuestion("axis", activeSide);
      expect(computerToMove(s)).toBe(true);
      expect(computerSide(s)).toBe("allies");
      expect(statusHtml(s, null, [])).toContain("Computer is playing");
    });
  }
  it("a computer tick at the question answers it, logs the reason, and the game is on its way (no stall, whoever played last)", () => {
    for (const activeSide of ["axis", "allies"] as const) {
      const s = atQuestion("axis", activeSide);
      expect(winterAsking(s.state)).toBe(true);
      const logBefore = s.log.length;
      expect(computerTick(s, 1e9)).not.toBe("stuck");
      expect(winterAsking(s.state)).toBe(false);
      expect(s.state.position?.part).toBe("player-turn");
      expect(s.log.slice(logBefore).some((l) => l.startsWith("Computer (") && l.includes("Russian winter"))).toBe(true);
      expect(s.toast).toBe("");
    }
  });
  it("watching two computers: the Allies are the side acting at the question", () => {
    const s = atQuestion("axis", "axis");
    s.watch = { speed: 1 } as never;
    expect(computerToMove(s)).toBe(true);
    expect(computerSide(s)).toBe("allies");
  });
});

describe("the watch mode passes the question (two computers, spec 06)", () => {
  it("a watched game in which the Allies are asked at Winter 1939 runs on to its turn limit with nothing stuck, and the log shows the dice and the wait", () => {
    const s = newWatchSession(SCENARIO_1939, 7, "turbo", 3);
    s.state = warWithRussia(s.state);
    for (let i = 0; i < 400 && s.watch && !overOf(s.watch, s.state); i++) watchSlice(s);
    expect(s.watch!.stuck).toBeNull();
    expect(overOf(s.watch!, s.state)).toBe("turn-limit");
    expect(s.log.some((l) => l.startsWith("Russian winter: the dice show"))).toBe(true);
    expect(s.log).toContain("The Allies put the Russian winter off: it starts in the next Winter turn.");
    expect(s.log.some((l) => l.startsWith("Computer (Allied): The dice allow it"))).toBe(true);
  });
});

describe("the log lines", () => {
  const turn = { year: 1941, season: "winter" } as const;
  it("say the dice, the count and what the Allies may do, in words with no raw ids", () => {
    const may = winterLine({ type: "WINTER_ROLLED", dice: [3, 3, 1, 3], total: 10, axisUnits: 1, mayPostpone: true })!;
    expect(may).toBe("Russian winter: the dice show 3, 3, 1, 3, a total of 10. The Axis has 1 ground unit in Russia (Finns not counted), so the Allies may put the winter off for a year.");
    const may0 = winterLine({ type: "WINTER_ROLLED", dice: [6, 6, 6, 6], total: 24, axisUnits: 30, mayPostpone: false })!;
    expect(may0).toContain("30 ground units");
    expect(may0).toContain("cannot put the winter off");
  });
  it("say when the Allies wait and when the winter starts (after a wait, and at once by a Russian declaration)", () => {
    expect(winterLine({ type: "WINTER_POSTPONED", turn })).toBe("The Allies put the Russian winter off: it starts in the next Winter turn.");
    expect(winterLine({ type: "WINTER_STARTED", turn })).toBe("The Russian winter starts in Winter 1941.");
    expect(winterLine({ type: "WINTER_STARTED", turn: { year: 1942, season: "winter" }, postponedFrom: turn })).toBe("The Russian winter starts in Winter 1942, put off from Winter 1941.");
    expect(winterLine({ type: "WINTER_STARTED", turn, early: true })).toContain("declared war on Germany in a Winter turn");
  });
  it("say nothing for other events, and the log side is plain for the dice and the start, the Allies' for the wait", () => {
    expect(winterLine({ type: "SETUP_COMPLETE" })).toBeNull();
    expect(eventSide({ type: "WINTER_ROLLED", dice: [1, 1, 1, 1], total: 4, axisUnits: 0, mayPostpone: true }, "axis")).toBeNull();
    expect(eventSide({ type: "WINTER_STARTED", turn }, "axis")).toBeNull();
    expect(eventSide({ type: "WINTER_POSTPONED", turn }, "axis")).toBe("allies");
  });
  it("the session logs them when the player (or the computer) acts: the dice line on the turn that asks, the wait when the Allies answer", () => {
    const r = runGame({ scenario: "1939", seed: 1, turns: 1, verify: false }, { prepare: warWithRussia });
    const s = createSession(SCENARIO_1939, "allies", 1);
    s.state = r.final;
    expect(run(s, { type: "CHOOSE_WINTER", side: "allies", postpone: true })).toBe(true);
    expect(s.log.some((l) => l === "The Allies put the Russian winter off: it starts in the next Winter turn.")).toBe(true);
    expect(s.logSides?.get(s.log.findIndex((l) => l.startsWith("The Allies put the Russian winter off")))).toBe("allies");
    expect(s.state.position?.part).toBe("player-turn");
  });
});
