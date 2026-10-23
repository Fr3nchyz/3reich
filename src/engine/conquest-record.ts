import type { Combatant, ForceOwner, GameState, GameTurn, Side } from "./types";

/**
 * A country that has been conquered (spec 14 C1; Ref 2.0, 18.1). This module holds the record's shape; the victory function (victory.ts) reads it, and
 * the rules that write it are `fall()` for a Major Power (ticket 14-5) and `fallCountry` for every other country (ticket 14-6, conquest-minor.ts). A saved
 * game without `GameState.conquests` reads as "nobody has been conquered".
 */

/** The colonies and mandates of the Ref 29.0 / spec 15 list: conquered by holding all their cities, not a capital (spec 15 R12, R13). */
export type ColonyId = "albania" | "algeria" | "egypt" | "iraq" | "lebanon-syria" | "libya" | "morocco" | "palestine" | "transjordan" | "tunisia";

/** Every country that can be conquered: a Major Power, a minor country or Minor-Ally, a colony, or "eastern-europe", the group the Polish Partition creates (Ref 29.0). */
export type FallenCountry = Combatant | ColonyId | "eastern-europe";

export interface Conquest {
  /** The country that fell. */
  country: FallenCountry;
  /** The conqueror: the owner of the unit that holds the capital (for a colony or Eastern Europe, the owner that holds all the cities); Germany for a Russian surrender. */
  by: ForceOwner;
  /** The side the conquered country fought on. */
  side: Side;
  /** "capital": a hostile unit holds the capital; "all-cities": a colony or Eastern Europe, the conqueror holds every city (spec 15). */
  how: "capital" | "all-cities" | "surrender" | "last-unit" | "italian-surrender";
  /** The Game Turn in which the conquest completed (the end of the conquered side's Combat Phase, or of the attacker's for a minor country), not the one in which the capital was first taken. TODO(verify) V4. */
  at: GameTurn;
  /** For a Major Power: the BRPs it began the scenario with. */
  startingBrps?: number;
}

/**
 * A hex that did not pass on at a fall because a ground unit hostile to the conqueror stood on it (V12, simplified), with what the fall would have done
 * to it. It passes on that way once no such unit stands there, if nobody has taken it in the meantime (ticket 14-25, `releaseKept` in conquest-kept.ts, V62).
 */
export interface KeptHex {
  /** The country whose fall kept it. */
  country: FallenCountry;
  /** The conqueror's side: a ground unit of the other side keeps the hex. */
  side: Side;
  /** Where the hex goes: the conqueror, or nobody (`null`, V11). */
  to: ForceOwner | null;
  /** Who controlled it just after the fall (null: nobody). If that has changed, the hex is no longer the fallen country's to pass on, and the record is dropped. */
  was: ForceOwner | null;
}

/** The Conquest record of a country, or undefined while it stands. Spec 15 reads this for the income of a conquered country and to keep a conquered Minor-Ally asleep for good. */
export const conquestOf = (state: GameState, country: FallenCountry): Conquest | undefined => state.conquests?.find((c) => c.country === country);

/** Whether a country has been conquered. */
export const isConquered = (state: GameState, country: FallenCountry): boolean => conquestOf(state, country) !== undefined;
