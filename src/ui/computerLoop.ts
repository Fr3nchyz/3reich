import { placeOf } from "../ai";
import { computerTick, computerToMove } from "./computerPlay";
import type { Session } from "./session";

/** Pause before each of the computer's steps, so the player can see "Computer is playing" and read the log. */
export const COMPUTER_DELAY_MS = 450;

/**
 * Plays the computer's steps one after another with a pause between them. `kick` is called after
 * every draw: if the computer is to move and no step is already scheduled, it schedules one.
 */
export function createComputerLoop(current: () => Session, redraw: () => void): { kick: () => void } {
  let pending: ReturnType<typeof setTimeout> | null = null;
  // Where the computer last failed to move: it does not try again from the same place, so it can never spin.
  let stuckAt: string | null = null;
  const kick = (): void => {
    if (pending !== null || !computerToMove(current()) || placeOf(current().state) === stuckAt) return;
    pending = setTimeout(() => {
      pending = null;
      const s = current();
      if (computerToMove(s) && !computerTick(s)) {
        stuckAt = placeOf(s.state);
        s.toast = s.toast || "The computer could not choose a move here.";
      }
      redraw();
    }, COMPUTER_DELAY_MS);
  };
  return { kick };
}
