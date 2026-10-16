import { turnKey } from "../engine/combat-record";
import type { GameState } from "../engine/types";

/**
 * The stack the player has chosen to move at step 6f (spec 10, ticket 10-3): its hex and which of its units are ticked. Screen state, never saved and
 * never part of the game; what is saved is the MOVE action it ends in. Pure data; the session operations are in moveTap.ts.
 */
export interface MoveChoice {
  /** The hex the units move from. */
  hex: string;
  /** The ids of the units ticked to move. */
  ticked: string[];
  /** The Player Turn the choice was made in (`turnKey`): a choice never outlives it. */
  turn: string;
  /** Just chosen: the card's heading takes the keyboard focus on the next draw, once. */
  fresh: boolean;
  /** Chosen from the list, where the hex may be off the visible map: the map moves to show it, once. */
  focus: boolean;
  /** The fold-out "Where they can go" is open (ticket 10-7); it stays as the player left it while the card is redrawn. */
  whereOpen?: boolean;
}

export const newChoice = (state: GameState, hex: string, ticked: readonly string[], focus = false): MoveChoice => ({ hex, ticked: [...ticked], turn: turnKey(state), fresh: true, focus });

/** The choice with these units ticked (the same hex, no longer fresh). */
export const withTicks = (c: MoveChoice, ticked: readonly string[]): MoveChoice => ({ ...c, ticked: [...ticked], fresh: false, focus: false });
