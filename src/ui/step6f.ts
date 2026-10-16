import { computerToMove } from "./computerPlay";
import type { Session } from "./session";

/** Whether it is step 6f of a Player Turn the player plays (not watched, not the computer's): spec 10's Move card, its marks and "Take back last move" live only here. */
export function atStep6f(s: Session): boolean {
  const p = s.state.position;
  return s.state.phase === "player-turn" && p?.part === "player-turn" && p.step === "6f" && !s.watch && !computerToMove(s);
}
