import { applyAction, type Action } from "../engine/actions";
import type { GameState } from "../engine/types";
import { atStep6f } from "./step6f";
import * as T from "./moveText";
import type { Session } from "./session";

/**
 * Take back last move (spec 10, ticket 10-6), a screen convenience at step 6f and not a game rule. The engine has no undo and gets none: the
 * session keeps the position as it was before the first move of the step (`base`) and the MOVE actions made since; taking back builds the earlier
 * position by applying all but the last of them to `base` through `applyAction` again, then cuts the log back to where it was before that move.
 * MOVE reads no dice, so the replay gives exactly the position that was there; a take back followed by the same move is the same game as never having
 * taken back. Screen state only: never saved, never shown to the computer or in watch mode.
 *
 * It is available only while `tip` is still the session's position: any action that is not one of these moves (Done with step 6f, a build, the turn
 * ending, the computer playing) gives a new position, so the history no longer fits and the button says there is nothing to take back.
 */

type Move = Extract<Action, { type: "MOVE" }>;

export interface MoveStep {
  action: Move;
  /** "Moved 2 German infantry from Lodz (N33) to Radom (N34)." as the card said it, for the confirmation. */
  line: string;
  /** How many log lines there were before this move. */
  logLen: number;
}

export interface MoveUndo {
  /** The position before the first move of the history. */
  base: GameState;
  steps: MoveStep[];
  /** The position and the log length after the last move: the history holds only while the session is still there. */
  tip: GameState;
  tipLog: number;
  /** `base` is the position just after a move that revealed something hidden (a die was rolled): the moves before it cannot be taken back, which the reason says when nothing later is left. */
  hidden: boolean;
}

/**
 * Whether a move showed something hidden. The spec's list is a combat roll (decision 3); the engine says nothing else is hidden. A move reads no
 * dice, so this is never true today. TODO(verify, spec 10 decision 3): any die read (a change of `rngState`) counts, the safer reading: no take back.
 */
export const revealedHidden = (before: GameState, after: GameState): boolean => after.rngState !== before.rngState;

/**
 * The history that still fits the session, or null. `tip === s.state` is the test that matters (any other action gives a new position, and a position
 * only ever follows the one before it in the same Player Turn, so no turn check is needed); the log length catches a line added to the log without a
 * new position, which a cut back to the move's length would otherwise delete.
 */
function live(s: Session): MoveUndo | null {
  const u = s.undo;
  return u && u.tip === s.state && u.tipLog === s.log.length ? u : null;
}

/** Called after each MOVE of the player went through `run`: `before` and `logLen` are the position and the log length it was made in. */
export function noteMove(s: Session, before: GameState, logLen: number, action: Move, line: string): void {
  const u = s.undo && s.undo.tip === before && s.undo.tipLog === logLen ? s.undo : null;
  const base = u ? u.base : before;
  if (revealedHidden(before, s.state)) {
    s.undo = { base: s.state, steps: [], tip: s.state, tipLog: s.log.length, hidden: true };
    return;
  }
  s.undo = { base, steps: [...(u?.steps ?? []), { action, line, logLen }], tip: s.state, tipLog: s.log.length, hidden: u?.hidden ?? false };
}

/** Why there is nothing to take back, or null when there is. */
export function takeBackReason(s: Session): string | null {
  if (!atStep6f(s)) return T.UNDO_UNAVAILABLE; // not the player's step 6f: not on the computer's turn, not in watch mode
  const u = live(s);
  if (u && u.steps.length > 0) return null;
  return u?.hidden ? T.UNDO_HIDDEN : T.UNDO_NOTHING;
}

/** Whether the button is on the page at all: only the player's own step 6f. */
export const takeBackShown = (s: Session): boolean => atStep6f(s);

/** The last move the button would take back, in words ("Moved 2 German infantry from A to B."), or null. */
export const lastMoveLine = (s: Session): string | null => {
  const u = live(s);
  return u && u.steps.length > 0 ? u.steps[u.steps.length - 1]!.line : null;
};

/**
 * Takes back the last move of this step. The position is rebuilt by replaying the earlier moves; the log lines of the move go (and their colours, kept
 * by index); the choice is dropped and the toast says in words what was taken back. False, and no change, when nothing can be taken back.
 */
export function takeBack(s: Session): boolean {
  const u = live(s);
  if (!atStep6f(s) || !u || u.steps.length === 0) return false;
  const kept = u.steps.slice(0, -1);
  const last = u.steps[u.steps.length - 1]!;
  let state = u.base;
  for (const step of kept) {
    const r = applyAction(s.ctx, state, step.action);
    if (!r.ok) {
      s.undo = null; // cannot happen (the same actions were accepted before); never leave a half-built game
      return false;
    }
    state = r.state;
  }
  s.state = state;
  s.log.length = last.logLen;
  if (s.logSides) for (const i of [...s.logSides.keys()]) if (i >= last.logLen) s.logSides.delete(i);
  s.moveChosen = null;
  s.undo = { base: u.base, steps: kept, tip: state, tipLog: s.log.length, hidden: u.hidden };
  s.toast = T.tookBack(last.line);
  return true;
}
