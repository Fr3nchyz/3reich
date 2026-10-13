/**
 * Tap detection. A tap is a single pointer that went down and up without travelling or joining a pinch.
 * Pure state, no DOM, so the rule is unit tested.
 */

/** A pointer that moves more than this many screen pixels (a finger wobbles) is a drag, not a tap. */
export const TAP_SLOP_PX = 6;

/** True when a pointer that went down at (x0, y0) and is now at (x, y) has travelled too far to be a tap. */
export const movedTooFar = (x0: number, y0: number, x: number, y: number): boolean => Math.hypot(x - x0, y - y0) > TAP_SLOP_PX;

export interface TapTracker {
  /** A pointer went down; `pointers` is how many are down now, this one included. */
  down(id: number, x: number, y: number, pointers: number): void;
  /** A tracked pointer moved; `pointers` is how many are down. */
  move(x: number, y: number, pointers: number): void;
  /** A pointer went up or was cancelled. True when that finished a tap. */
  end(id: number, released: boolean): boolean;
}

export function createTapTracker(): TapTracker {
  let tap: { id: number; x: number; y: number; ok: boolean } | null = null;
  return {
    down(id, x, y, pointers) {
      tap = pointers === 1 ? { id, x, y, ok: true } : null;
    },
    move(x, y, pointers) {
      if (tap && (pointers > 1 || movedTooFar(tap.x, tap.y, x, y))) tap.ok = false;
    },
    end(id, released) {
      const done = tap !== null && tap.id === id && tap.ok && released;
      tap = null;
      return done;
    },
  };
}
