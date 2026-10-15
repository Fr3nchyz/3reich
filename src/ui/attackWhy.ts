import { sideOfOwner } from "../engine/setup";
import { attackPreview } from "./attackPreview";
import { attackTargets } from "./attackDraft";
import { attackActions } from "./attackTap";
import { computerToMove } from "./computerPlay";
import type { Session } from "./session";

/**
 * The one sentence under the hex card for an enemy hex (spec 07, part A): why it cannot be attacked right now, taken from the preview model's
 * problems ("Attacks are made at step 7h.", "This hex has already been attacked this turn.", "You are not at war with Italy."...). Nothing is said
 * for a hex that can be attacked (tapping it opens the attack card), for your own hexes, or when it is the computer's turn.
 */
export function whyNotAttack(s: Session, hex: string): string | null {
  if (s.state.phase !== "player-turn" || s.watch || computerToMove(s)) return null;
  const enemy = Object.values(s.state.units).some((u) => u.at === hex && sideOfOwner(u.owner) !== s.state.activeSide);
  if (!enemy || attackTargets(attackActions(s)).includes(hex)) return null;
  return attackPreview(s.ctx, s.state, hex, []).problems[0] ?? null;
}
