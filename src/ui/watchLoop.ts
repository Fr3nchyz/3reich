import type { Session } from "./session";
import { delayBefore, shouldRun } from "./watchController";
import { watchSlice } from "./watchPlay";

export interface WatchLoop {
  /** Called after every draw: schedules the next slice if a watched game should play on and none is waiting. */
  kick: () => void;
  /** Forgets a waiting slice (a new game, or a control changed the pace): the next kick schedules afresh. */
  reset: () => void;
}

/** Plays a watched game slice by slice with the pause the chosen speed asks for, redrawing after each (the same shape as the single-player computer's loop). */
export function createWatchLoop(current: () => Session, redraw: () => void): WatchLoop {
  let pending: ReturnType<typeof setTimeout> | null = null;
  const kick = (): void => {
    const s = current();
    if (pending !== null || !s.watch || !shouldRun(s.watch, s.state)) return;
    pending = setTimeout(() => {
      pending = null;
      watchSlice(current());
      redraw();
    }, delayBefore(s.watch));
  };
  const reset = (): void => {
    if (pending !== null) clearTimeout(pending);
    pending = null;
  };
  return { kick, reset };
}
