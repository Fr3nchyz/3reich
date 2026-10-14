import { chooseAction, placeOf } from "../ai";
import { combatOf } from "../engine/combat-record";
import { otherSide } from "../engine/game";
import type { Side } from "../engine/types";
import { sideName } from "./format";
import { run, type Session } from "./session";

/**
 * The computer's turns in the browser: when the player has picked a side, the other side's
 * Player Turns are played by the computer, a slice of one step per tick. No DOM here; every
 * action goes through the engine like a tap would (spec 05).
 */

/** A safety stop per tick: more actions than any one step offers. */
const MAX_ACTIONS_PER_TICK = 300;

/** The most time one tick may keep the page busy before it yields to the browser (a build step can run dozens of actions of tens of milliseconds each). */
export const TICK_BUDGET_MS = 60;

/** The side the computer plays: the one the player did not pick; when two computers play (watch mode), the side now acting (the one to choose the losses of a pending Exchange, else the side whose Player Turn it is). */
export const computerSide = (s: Session): Side => (s.watch ? (combatOf(s.state).pending?.chooser ?? s.state.activeSide) : otherSide(s.humanSide));

/**
 * Whether the computer is the one to move now: its Player Turn, or an Exchange (step 7h) whose losses it must choose
 * even though the other side is attacking (the chooser is the owner of the units that lose, Ref 12.2).
 */
export const computerToMove = (s: Session): boolean => {
  if (s.state.phase !== "player-turn") return false;
  if (s.watch) return true;
  const pending = combatOf(s.state).pending;
  return pending ? pending.chooser === computerSide(s) : s.state.activeSide === computerSide(s);
};

/** "more": the step is not finished, tick again soon. "done": it left the step. "stuck": the computer could not act. */
export type TickResult = "more" | "done" | "stuck";

/** Plays the computer's current step, logging each choice with its reason, until the step is left or `budgetMs` has passed. */
export function computerTick(s: Session, budgetMs = TICK_BUDGET_MS, now: () => number = () => performance.now()): TickResult {
  if (!computerToMove(s)) return "stuck";
  const here = placeOf(s.state);
  const started = now();
  for (let i = 0; i < MAX_ACTIONS_PER_TICK && placeOf(s.state) === here && computerToMove(s); i++) {
    if (i > 0 && now() - started >= budgetMs) return "more";
    const decision = chooseAction(s.ctx, s.state, { seed: s.seed });
    if (!decision) return "stuck";
    s.log.push(`Computer (${sideName(computerSide(s))}): ${decision.why}`);
    if (!run(s, decision.action)) return "stuck";
  }
  return placeOf(s.state) === here ? "more" : "done";
}

/** The result of one computer action: it was taken, or why it was not. */
export type ActResult = { ok: true } | { ok: false; kind: "no-action" | "refused"; detail: string };

/** The computer takes one action for the side now to move, logging its reason like computerTick does (one action, for the watch mode's finer steps). */
export function computerAct(s: Session): ActResult {
  const decision = chooseAction(s.ctx, s.state, { seed: s.seed });
  if (!decision) return { ok: false, kind: "no-action", detail: "the computer has no action to take" };
  s.log.push(`Computer (${sideName(computerSide(s))}): ${decision.why}`);
  return run(s, decision.action) ? { ok: true } : { ok: false, kind: "refused", detail: s.toast || "the engine refused the action" };
}
