import { turnKey } from "./combat-record";
import type { SrUsed } from "./sr-rules";
import type { GameState } from "./types";

/**
 * What Strategic Redeployment has done in the Player Turn now being played (step 9e; spec 16 C1). It lives in `GameState.sr` and, like the move
 * record, is replaced by a fresh one when a different Player Turn asks for it (the key names the Game Turn and the side), so no step clears it.
 * An old saved game has none, and reads as "nothing has been redeployed". It holds ids and counts, never copies of units.
 */
export interface SrRecord {
  /** "year-season-side" of the Player Turn the record belongs to. */
  turn: string;
  /** Redeployments each Major Power has used this Player Turn (Ref 11.72; R18). Grants add to it (ticket 16-18). */
  used: SrUsed;
  /** Units redeployed this Player Turn: each once (AER28). */
  moved: string[];
  /** Fleet that escorted each redeployed unit across the sea (Sea Escort, ticket 16-21); empty until then. */
  escorted: Record<string, string>;
}

/** The record for the Player Turn now being played: the stored one, or an empty one. */
export function srOf(state: Pick<GameState, "sr" | "year" | "season" | "activeSide">): SrRecord {
  const rec = state.sr;
  return rec && rec.turn === turnKey(state) ? rec : { turn: turnKey(state), used: {}, moved: [], escorted: {} };
}
