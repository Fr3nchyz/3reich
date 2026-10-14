import type { Action } from "../engine/actions";

/**
 * The computer opponent (spec 05). It reads the game state and the list of legal actions and
 * answers with one action at a time; every action goes through applyAction like a human's.
 */

export interface AiConfig {
  /** Breaks ties between equally good actions, the same way every time for the same seed. */
  seed: number;
}

/** One thing the computer chose, with a short reason for the log. */
export interface Decision {
  action: Action;
  why: string;
}
