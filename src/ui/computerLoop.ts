import { placeOf } from "../ai";
import { computerTick, computerToMove } from "./computerPlay";
import type { Session } from "./session";

/** Pause after each of the computer's steps, so the player can see "Computer is playing" and read the log. */
export const COMPUTER_DELAY_MS = 450;
/** Pause inside a step that needs more than one slice of work, just long enough for the page to draw. */
export const SLICE_DELAY_MS = 20;

export interface ComputerLoop {
  kick: () => void;
  /** Forget everything about the game before (a pending timer, a place where the computer was stuck): call when a new game starts. */
  reset: () => void;
}

/**
 * Plays the computer's steps one after another with a pause between them. `kick` is called after
 * every draw: if the computer is to move and nothing is already scheduled, it schedules the next slice.
 */
export function createComputerLoop(current: () => Session, redraw: () => void): ComputerLoop {
  let pending: ReturnType<typeof setTimeout> | null = null;
  // Where the computer last failed to move: it does not try again from the same place, so it can never spin.
  let stuckAt: string | null = null;
  let nextDelay = COMPUTER_DELAY_MS;
  const kick = (): void => {
    if (pending !== null || !computerToMove(current()) || placeOf(current().state) === stuckAt) return;
    pending = setTimeout(() => {
      pending = null;
      const s = current();
      if (computerToMove(s)) {
        const result = computerTick(s);
        nextDelay = result === "more" ? SLICE_DELAY_MS : COMPUTER_DELAY_MS;
        if (result === "stuck") {
          stuckAt = placeOf(s.state);
          s.toast = s.toast || "The computer could not choose a move here.";
        }
      }
      redraw();
    }, nextDelay);
  };
  const reset = (): void => {
    if (pending !== null) clearTimeout(pending);
    pending = null;
    stuckAt = null;
    nextDelay = COMPUTER_DELAY_MS;
  };
  return { kick, reset };
}
