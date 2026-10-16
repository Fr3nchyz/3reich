import type { Scenario, Side } from "../engine/types";
import { computerAct } from "./computerPlay";
import { cap, sideName } from "./format";
import { describeStep } from "../engine/sequence";
import { resetLog } from "./logSide";
import { newSession, placeTheRest, type Session } from "./session";
import {
  actionsPerSlice, afterAction, createWatchInfo, markStuck, overOf, shouldRun, SLICE_MS, stuckMessage, type Speed, type WatchInfo,
} from "./watchController";
import { recordOf, type GameRecord } from "./watchRecord";

/** A watched game (spec 06) in the browser: two computers, one session. No DOM here; every action goes through the engine like the single-player computer's. */

/** More nations than any scenario has: a stop for the setup loop. */
const MAX_SETUP_OWNERS = 20;

/** A new watched game: the engine's automatic setup for every nation (the code the single-player computer's own setup uses), recorded, then play is ready to start. */
export function newWatchSession(scenario: Scenario, seed: number, speed: Speed, turns: number | null): Session {
  const s = newSession(scenario, "axis", seed);
  s.record = [];
  resetLog(s, [`${scenario.name} started with seed ${seed}: the computer plays both sides and you watch.`]);
  for (let guard = 0; guard < MAX_SETUP_OWNERS && s.state.phase === "setup"; guard++) if (!placeTheRest(s)) break;
  s.watch = createWatchInfo(s.state, s.record.length, speed, turns);
  if (s.state.phase === "setup") s.watch = markStuck(s.watch, "setup", "the automatic setup did not finish");
  return s;
}

/** Where the game is, in words: "Summer 1939, Axis player turn, step 6f (Conduct normal ground/air movement)". */
export function whereText(s: Session): string {
  const { state } = s;
  const turn = `${cap(state.season)} ${state.year}`;
  if (state.phase === "setup") return `${turn}, setup`;
  if (state.phase === "game-over") return `${turn}, game over`;
  return `${turn}, ${sideName(state.activeSide)} player turn${state.position?.part === "player-turn" ? `, step ${describeStep(state.position.step)}` : ""}`;
}

/**
 * Plays actions for one slice: one action, or at Turbo and for "next turn" as many as fit in SLICE_MS, so the page
 * can repaint. Stops at a step button's goal, at the end of the game, or when the computer is stuck (never throws).
 */
export function watchSlice(s: Session, now: () => number = () => performance.now()): void {
  const started = now();
  let lastCost = 0;
  for (let n = 0; s.watch && shouldRun(s.watch, s.state) && n < actionsPerSlice(s.watch); n++) {
    // Another action only if the last one's cost fits in what is left of the slice: after a slow action the page repaints first.
    const before = now();
    if (n > 0 && (before - started >= SLICE_MS || lastCost > SLICE_MS - (before - started))) return;
    let result: ReturnType<typeof computerAct>;
    try {
      result = computerAct(s);
      lastCost = now() - before;
    } catch (e) {
      s.watch = markStuck(s.watch, "exception", (e as Error).message);
      return;
    }
    if (!result.ok) {
      s.watch = markStuck(s.watch, result.kind, result.detail);
      return;
    }
    s.watch = afterAction(s.watch, s.state);
  }
}

/** The message for a stuck run, or "" when it is not stuck. */
export const stuckText = (s: Session): string => (s.watch?.stuck ? stuckMessage(s.watch.stuck, whereText(s)) : "");

/** What the game stopped on, for the End of game panel, or null while it is playable. */
export const endText = (s: Session): string | null => {
  const over = s.watch ? overOf(s.watch, s.state) : null;
  return over === "game-over" ? `The scenario ends after ${cap(s.state.season)} ${s.state.year}.` : over === "turn-limit" ? `Stopped after the chosen number of Game Turns, at ${cap(s.state.season)} ${s.state.year}.` : null;
};

/** The game so far as a self-play recording (docs/SELFPLAY.md). */
export function recordFor(s: Session): GameRecord {
  const w = s.watch as WatchInfo;
  const over = overOf(w, s.state);
  return recordOf({
    scenarioId: s.ctx.scenario.id, seed: s.seed, turns: w.turns, ended: over ?? "stopped", setupActions: w.setupActions,
    anomalies: w.stuck ? [{ kind: w.stuck.kind, at: whereText(s), detail: w.stuck.detail }] : [], actions: s.record ?? [],
  });
}

/** Turns the watched game into a normal one at this point: the human takes `side`, the computer the other. Between actions by construction. */
export function takeOver(s: Session, side: Side): void {
  s.humanSide = side;
  s.watch = undefined;
  s.record = undefined;
  s.toast = "";
  s.log.push(`You take over the ${sideName(side)} side; the computer keeps the other.`);
}
