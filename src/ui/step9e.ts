import { computerToMove } from "./computerPlay";
import type { Session } from "./session";

/** Whether it is step 9e of a Player Turn the player plays (not watched, not the computer's): the Redeploy panel of spec 16 D4 and its take back live only here. */
export function atStep9e(s: Session): boolean {
  const p = s.state.position;
  return s.state.phase === "player-turn" && p?.part === "player-turn" && p.step === "9e" && !s.watch && !computerToMove(s);
}
