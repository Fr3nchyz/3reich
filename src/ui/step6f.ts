import { computerToMove } from "./computerPlay";
import type { Session } from "./session";

/** Whether the move taps work: step 6f, or step 4 where an attacked minor moves its own units (spec 15 R15; the engine lists only that minor's moves there). */
export function atMoveStep(s: Session): boolean {
  const p = s.state.position;
  return atStep6f(s) || (s.state.phase === "player-turn" && p?.part === "player-turn" && p.step === "4" && !s.watch && !computerToMove(s));
}

/** Whether it is step 6f of a Player Turn the player plays (not watched, not the computer's): spec 10's Move card, its marks and "Take back last move" live only here. */
export function atStep6f(s: Session): boolean {
  const p = s.state.position;
  return s.state.phase === "player-turn" && p?.part === "player-turn" && p.step === "6f" && !s.watch && !computerToMove(s);
}
