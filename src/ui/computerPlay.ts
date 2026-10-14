import { chooseAction, placeOf } from "../ai";
import { otherSide } from "../engine/game";
import type { Side } from "../engine/types";
import { sideName } from "./format";
import { run, type Session } from "./session";

/**
 * The computer's turns in the browser: when the player has picked a side, the other side's
 * Player Turns are played by the computer, one step per tick. No DOM here; every action goes
 * through the engine like a tap would (spec 05).
 */

/** A safety stop per tick: more actions than any one step offers. */
const MAX_ACTIONS_PER_TICK = 300;

export const computerSide = (s: Session): Side => otherSide(s.humanSide);

/** Whether the computer is the one to move now. */
export const computerToMove = (s: Session): boolean => s.state.phase === "player-turn" && s.state.activeSide === computerSide(s);

/** Plays the computer's current step to its end, logging each choice with its reason. Returns false if it could not act. */
export function computerTick(s: Session): boolean {
  if (!computerToMove(s)) return false;
  const here = placeOf(s.state);
  for (let i = 0; i < MAX_ACTIONS_PER_TICK && placeOf(s.state) === here && computerToMove(s); i++) {
    const decision = chooseAction(s.ctx, s.state, { seed: s.seed });
    if (!decision) return false;
    s.log.push(`Computer (${sideName(computerSide(s))}): ${decision.why}`);
    if (!run(s, decision.action)) return false;
  }
  return true;
}
