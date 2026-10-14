import { placeOf } from "../ai";
import { turnIndex } from "../engine/game";
import type { GameState } from "../engine/types";

/**
 * The rules of the "Watch two computers play" mode (spec 06) as plain functions on a plain record: how fast it runs,
 * what a step button runs to, when the game is over, when the computer is stuck. No DOM, no session, no engine calls
 * except reading the state; the browser glue (watchPlay.ts) applies the actions and the bar (watchBar.ts) draws.
 */

export type Speed = "slow" | "normal" | "fast" | "turbo";

/** Pause between two actions at each speed, as the product owner asked: Slow ~600 ms, Normal ~150 ms, Fast ~20 ms, Turbo none (it runs for a whole time slice). */
export const SPEEDS: Record<Speed, { label: string; delayMs: number }> = {
  slow: { label: "Slow", delayMs: 600 },
  normal: { label: "Normal", delayMs: 150 },
  fast: { label: "Fast", delayMs: 20 },
  turbo: { label: "Turbo", delayMs: 0 },
};
export const SPEED_ORDER: readonly Speed[] = ["slow", "normal", "fast", "turbo"];

/** The longest one slice of actions may keep the page busy before it yields and repaints. One slow computer action is not cut short, so a single action can still hold the page for about half a second. */
export const SLICE_MS = 40;
/** Most actions at one step, and most in one Game Turn, before the computer counts as stuck: the self-play runner's limits (docs/SELFPLAY.md). */
export const STEP_ACTION_LIMIT = 1000;
export const TURN_ACTION_LIMIT = 8000;

/** What a step button runs to: one action, or the end of the Game Turn it started in. */
export type StepMode = "action" | "turn";

export type StuckKind = "setup" | "stuck" | "refused" | "exception" | "no-progress" | "turn-budget";
export interface Stuck {
  kind: StuckKind;
  detail: string;
}

export interface WatchInfo {
  paused: boolean;
  speed: Speed;
  /** Set by a step button: the run goes on until this much is done, then stays paused. */
  step: StepMode | null;
  /** The Game Turn index a "turn" step started in. */
  stepFromTurn: number;
  /** Actions played since setup, and actions the setup took. */
  actions: number;
  setupActions: number;
  /** Stop when the Game Turn index reaches this (the "stop after N Game Turns" field), or null to play to the end of the scenario. */
  endAtTurn: number | null;
  /** The number of Game Turns asked for, or "end", as the saved record states it. */
  turns: number | "end";
  /** Where the game is, and for how many actions it has been at this step / in this Game Turn. */
  place: string;
  turn: number;
  atPlace: number;
  inTurn: number;
  stuck: Stuck | null;
}

/** A new run from `state` (just after setup). `turns` is the optional number of Game Turns to play. */
export function createWatchInfo(state: GameState, setupActions: number, speed: Speed = "normal", turns: number | null = null): WatchInfo {
  return { paused: false, speed, step: null, stepFromTurn: turnIndex(state), actions: 0, setupActions, endAtTurn: turns && turns > 0 ? turnIndex(state) + turns : null, turns: turns && turns > 0 ? turns : "end", place: placeOf(state), turn: turnIndex(state), atPlace: 0, inTurn: 0, stuck: null };
}

export const speedDelay = (speed: Speed): number => SPEEDS[speed].delayMs;

export type Over = "game-over" | "turn-limit";
/** Why the game cannot go on (the scenario ended, or the chosen number of Game Turns is done), or null. */
export function overOf(info: WatchInfo, state: GameState): Over | null {
  if (state.phase === "game-over") return "game-over";
  return info.endAtTurn !== null && turnIndex(state) >= info.endAtTurn ? "turn-limit" : null;
}

/** Whether actions are being played or waiting to be: a run that is not paused, or a step button being served. */
export const isRunning = (info: WatchInfo): boolean => !info.paused || info.step !== null;

/** Whether the run should play now: not paused (or a step button is waiting to be served), not stuck, not over. */
export const shouldRun = (info: WatchInfo, state: GameState): boolean => !info.stuck && !overOf(info, state) && isRunning(info);

/** Actions in one slice: a single one, except at Turbo and for "next turn", which take as many as fit in SLICE_MS. */
export const actionsPerSlice = (info: WatchInfo): number => (info.step === "action" ? 1 : info.step === "turn" || info.speed === "turbo" ? Infinity : 1);

/** The wait before the next slice: none while a step button is being served (it runs flat out), else the chosen speed's. */
export const delayBefore = (info: WatchInfo): number => (info.step ? 0 : speedDelay(info.speed));

/** Pause stops everything at once, including a step that is still running to the next Game Turn. */
export const pause = (info: WatchInfo): WatchInfo => ({ ...info, paused: true, step: null });
export const play = (info: WatchInfo): WatchInfo => ({ ...info, paused: false, step: null });
export const setSpeed = (info: WatchInfo, speed: Speed): WatchInfo => ({ ...info, speed });
/** A step button: pause and serve exactly this much. */
export const beginStep = (info: WatchInfo, mode: StepMode, state: GameState): WatchInfo => ({ ...info, paused: true, step: mode, stepFromTurn: turnIndex(state) });

/** Records one action taken, leaving `next`: counts it, notes whether the step or Game Turn changed, finishes a step, flags a stuck run. */
export function afterAction(info: WatchInfo, next: GameState): WatchInfo {
  const place = placeOf(next);
  const turn = turnIndex(next);
  const out: WatchInfo = { ...info, actions: info.actions + 1, place, turn, atPlace: place === info.place ? info.atPlace + 1 : 0, inTurn: turn === info.turn ? info.inTurn + 1 : 0 };
  if (out.atPlace > STEP_ACTION_LIMIT) out.stuck = { kind: "no-progress", detail: `more than ${STEP_ACTION_LIMIT} actions at one step` };
  else if (out.inTurn > TURN_ACTION_LIMIT) out.stuck = { kind: "turn-budget", detail: `more than ${TURN_ACTION_LIMIT} actions in one Game Turn` };
  const turnDone = turn !== info.stepFromTurn || next.phase !== "player-turn";
  if (info.step === "action" || (info.step === "turn" && turnDone)) out.step = null;
  return out;
}

/** The run cannot continue (the kinds are the names the self-play runner gives the same anomalies, so a saved record reads the same): the computer had no action, the engine refused it, or it threw. */
export const markStuck = (info: WatchInfo, kind: StuckKind, detail: string): WatchInfo => ({ ...info, stuck: { kind, detail }, step: null });

/** The message shown when stuck, with `where` as "Spring 1940, Allied player turn, step 6f". */
export const stuckMessage = (stuck: Stuck, where: string): string => `The computer got stuck at ${where}: ${stuck.detail}.`;
