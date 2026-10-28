import { applyAction, type Action } from "../engine/actions";
import type { GameState } from "../engine/types";
import * as T from "./redeployText";
import type { Session } from "./session";
import { atStep9e } from "./step9e";

/**
 * Take back last redeployment (spec 16 R25, ticket 16-19), a screen convenience at step 9e and not a game rule, built as spec 10's take back at 6f is:
 * the engine has no undo and gets none. The session keeps the position before the first redeployment of the step (`base`) and the SR_UNITS actions made
 * since; taking back applies all but the last of them to `base` through `applyAction` again and cuts the log back. Step 9e reads no dice, so the replay gives
 * exactly the position that was there. Screen state only: never saved, never shown to the computer or in watch mode. It holds only while `tip` is still the
 * session's position and the log is as long as it was: any other action gives a new position (and when the last redeployment leaves nothing more to
 * redeploy the step passes by itself and the panel is gone, so that last one cannot be taken back: the engine, not the screen, ends the step).
 */

type Redeploy = Extract<Action, { type: "SR_UNITS" }>;

export interface SrStep {
  action: Redeploy;
  /** "Redeployed 2 German infantry from A to B." */
  line: string;
  /** How many log lines there were before this redeployment. */
  logLen: number;
}

export interface SrUndo {
  base: GameState;
  steps: SrStep[];
  tip: GameState;
  tipLog: number;
}

function live(s: Session): SrUndo | null {
  const u = s.srUndo;
  return u && u.tip === s.state && u.tipLog === s.log.length ? u : null;
}

/** Called after each SR_UNITS of the player went through `run`: `before` and `logLen` are the position and the log length it was made in. */
export function noteRedeploy(s: Session, before: GameState, logLen: number, action: Redeploy, line: string): void {
  const u = s.srUndo && s.srUndo.tip === before && s.srUndo.tipLog === logLen ? s.srUndo : null;
  s.srUndo = { base: u ? u.base : before, steps: [...(u?.steps ?? []), { action, line, logLen }], tip: s.state, tipLog: s.log.length };
}

/** Why there is nothing to take back, or null when there is. */
export function takeBackReason(s: Session): string | null {
  const u = live(s);
  return u && u.steps.length > 0 ? null : T.UNDO_NOTHING;
}

/** The last redeployment the button would take back, in words, or null. */
export const lastLine = (s: Session): string | null => {
  const u = live(s);
  return u && u.steps.length > 0 ? u.steps[u.steps.length - 1]!.line : null;
};

/** Takes back the last redeployment of this step. False, and no change, when nothing can be taken back. */
export function takeBackRedeploy(s: Session): boolean {
  const u = live(s);
  if (!atStep9e(s) || !u || u.steps.length === 0) return false;
  const kept = u.steps.slice(0, -1);
  const last = u.steps[u.steps.length - 1]!;
  let state = u.base;
  for (const step of kept) {
    const r = applyAction(s.ctx, state, step.action);
    if (!r.ok) {
      s.srUndo = null; // cannot happen (the same actions were accepted before); never leave a half-built game
      return false;
    }
    state = r.state;
  }
  s.state = state;
  s.log.length = last.logLen;
  if (s.logSides) for (const i of [...s.logSides.keys()]) if (i >= last.logLen) s.logSides.delete(i);
  s.redeploy = null;
  s.srUndo = { base: u.base, steps: kept, tip: state, tipLog: s.log.length };
  s.toast = T.tookBack(last.line);
  return true;
}
