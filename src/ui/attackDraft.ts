import type { Action } from "../engine/actions";
import { turnKey } from "../engine/combat-record";
import type { GameState } from "../engine/types";

/**
 * The attack the player is putting together (spec 07, part B): the hex being attacked and the units chosen. Screen state, never saved and never
 * part of the game; what is saved is the ATTACK action it ends in. Pure functions on plain data; the session operations are in attackTap.ts.
 */

export interface AttackDraft {
  target: string;
  /** The ids of the units chosen to attack. */
  units: string[];
  /** The Player Turn the draft was made in (`turnKey`): a draft never outlives it. */
  turn: string;
  /** Just opened: the card's heading takes the keyboard focus on the next draw, once. */
  fresh: boolean;
  /** Opened from the list, where the hex may be off the visible map: the map moves to show it, once. */
  focus: boolean;
}

type Attack = Extract<Action, { type: "ATTACK" }>;

const attacks = (actions: readonly Action[]): Attack[] => actions.filter((a): a is Attack => a.type === "ATTACK");

/** The hexes that can be attacked now: the targets of the ATTACK actions the engine lists, once each, in order. */
export const attackTargets = (actions: readonly Action[]): string[] => [...new Set(attacks(actions).map((a) => a.target))];

/** Every unit that can attack `target` now: the largest group the engine lists for it (spec 07 part C). */
export const attackersOf = (actions: readonly Action[], target: string): string[] => [...new Set(attacks(actions).filter((a) => a.target === target).flatMap((a) => a.units))];

export const newDraft = (state: GameState, target: string, units: readonly string[], focus: boolean): AttackDraft => ({ target, units: [...units], turn: turnKey(state), fresh: true, focus });

/** The draft with this unit added, or taken out if it is chosen. */
export const toggled = (d: AttackDraft, id: string): AttackDraft => ({ ...d, fresh: false, units: d.units.includes(id) ? d.units.filter((u) => u !== id) : [...d.units, id] });

/**
 * The draft as it stands in `actions` (the legal actions now): dropped when the Player Turn has changed or the hex can no longer be attacked,
 * and with any unit that can no longer attack taken out. Returns the same object when nothing changed.
 */
export function reconciled(d: AttackDraft | null | undefined, state: GameState, actions: readonly Action[]): AttackDraft | null {
  if (!d || d.turn !== turnKey(state) || !attackTargets(actions).includes(d.target)) return null;
  const can = attackersOf(actions, d.target);
  return d.units.every((u) => can.includes(u)) ? d : { ...d, units: d.units.filter((u) => can.includes(u)) };
}
