import type { Combatant, ForceOwner, GameTurn, Side } from "./types";

/**
 * A country that has been conquered (spec 14 C1; Ref 2.0, 18.1). This module holds the record's shape only:
 * the victory function (victory.ts) reads it, and the rules that write it (the fall of a capital) come with
 * ticket 14-5. A saved game without `GameState.conquests` reads as "nobody has been conquered".
 */
export interface Conquest {
  /** The country that fell. "eastern-europe" is the group the Polish Partition creates (Ref 29.0). */
  country: Combatant | "eastern-europe";
  /** The conqueror: the owner of the unit that holds the capital; Germany for a Russian surrender. */
  by: ForceOwner;
  /** The side the conquered country fought on. */
  side: Side;
  how: "capital" | "surrender" | "last-unit" | "italian-surrender";
  /** The Game Turn in which the conquest completed (the end of the conquered side's Combat Phase), not the one in which the capital was first taken. TODO(verify) V4. */
  at: GameTurn;
  /** For a Major Power: the BRPs it began the scenario with. */
  startingBrps?: number;
}
