import { chooseAction, placeOf } from "../ai";
import { createMemory, type AiMemory } from "../ai/memory";
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

/** What the computer remembers in each game (the targets of its units), and the ground moves it has made but not yet written up. */
const memories = new WeakMap<Session, AiMemory>();
const moveTally = new WeakMap<Session, { moves: number; units: number }>();

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
  let lastCost = 0;
  for (let i = 0; i < MAX_ACTIONS_PER_TICK && placeOf(s.state) === here && computerToMove(s); i++) {
    // Another action only if the last one's cost fits in what is left of the budget: one slow action never runs on top of a spent budget.
    if (i > 0 && (now() - started >= budgetMs || lastCost > budgetMs - (now() - started))) return "more";
    const before = now();
    if (!computerAct(s).ok) return "stuck";
    lastCost = now() - before;
  }
  return placeOf(s.state) === here ? "more" : "done";
}

/** The result of one computer action: it was taken, or why it was not. */
export type ActResult = { ok: true } | { ok: false; kind: "no-action" | "refused"; detail: string };

/**
 * The computer takes one action for the side now to move and logs its reason (the one place a computer action is chosen,
 * logged and applied: the single-player ticks and the watch mode's finer steps both use it). When the player is playing, ground
 * moves are written up in one line when the step ends; when two computers play and the player watches, each is logged as it happens.
 */
export function computerAct(s: Session): ActResult {
  const memory = memories.get(s) ?? memories.set(s, createMemory()).get(s)!;
  const decision = chooseAction(s.ctx, s.state, { seed: s.seed, memory });
  if (!decision) return { ok: false, kind: "no-action", detail: "the computer has no action to take" };
  const who = `Computer (${sideName(computerSide(s))})`;
  if (decision.action.type === "MOVE" && !s.watch) {
    // Up to 40 moves a turn would bury the log: they are written up in one line when the step ends.
    const tally = moveTally.get(s) ?? { moves: 0, units: 0 };
    moveTally.set(s, { moves: tally.moves + 1, units: tally.units + decision.action.units.length });
  } else {
    const tally = moveTally.get(s);
    if (tally) {
      s.log.push(`${who}: moved ${tally.units} unit${tally.units === 1 ? "" : "s"} in ${tally.moves} move${tally.moves === 1 ? "" : "s"}, each toward the nearest enemy-held capital or objective.`);
      moveTally.delete(s);
    }
    s.log.push(`${who}: ${decision.why}`);
  }
  return run(s, decision.action) ? { ok: true } : { ok: false, kind: "refused", detail: s.toast || "the engine refused the action" };
}
