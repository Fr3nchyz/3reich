import type { Action } from "../engine/actions";
import type { AiMemory } from "./memory";

/**
 * The computer opponent (spec 05). It reads the game state and the list of legal actions and
 * answers with one action at a time; every action goes through applyAction like a human's.
 */

export interface AiConfig {
  /** Breaks ties between equally good actions, the same way every time for the same seed. */
  seed: number;
  /**
   * What the computer remembers during a game (the target each unit is heading for, where it has been lately), owned by the
   * caller and filled by the choosers. Without it every choice depends on the position alone, which is still legal and
   * terminates, but units may change their minds between turns.
   */
  memory?: AiMemory;
  /** The computer's supply rules (src/ai/lines.ts), which act only while the supply effects are on. Absent or true: used; false: the computer plays as if supply did not matter (to measure the rules against). */
  supplyRules?: boolean;
}

/** One thing the computer chose, with a short reason for the log. */
export interface Decision {
  action: Action;
  why: string;
}
