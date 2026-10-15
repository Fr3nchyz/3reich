import type { Action } from "../engine/actions";
import type { GameContext } from "../engine/context";
import type { GameState, Unit } from "../engine/types";
import { plural } from "./attackText";
import { placeName, unitName, unitsWithIds } from "./names";

/**
 * "Advance into <place>?" (spec 07, State 4): the data of the card for the advance after a won battle (ADVANCE). Pure: the legal actions, the state and
 * the units chosen in, plain data out. No rule here: the units that may advance and the sets that fit the hex are those of the ADVANCE actions
 * `legalActions` lists (the engine checks stacking and the Anglo-French rule). The engine has no "decline" action: staying is the absence of an ADVANCE.
 */

export interface AdvanceChip {
  id: string;
  name: string;
  /** "Lodz (N33)": where the counter stands now. */
  from: string;
  /** "1 of 2" when an identical counter stands in the same hex; otherwise null. */
  nth: string | null;
  chosen: boolean;
}

export interface AdvanceModel {
  to: string;
  toName: string;
  chips: AdvanceChip[];
  chosenCount: number;
  legal: boolean;
  button: { text: string; disabled: boolean };
}

type Advance = Extract<Action, { type: "ADVANCE" }>;
const advances = (actions: readonly Action[], to?: string): Advance[] => actions.filter((a): a is Advance => a.type === "ADVANCE" && (to === undefined || a.to === to));

/** The hexes the player may advance into now, once each, in the engine's order. */
export const advanceOffers = (actions: readonly Action[]): string[] => [...new Set(advances(actions).map((a) => a.to))];

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** The units that may advance into `to`, and the set the card starts with: the most units that fit, then the most factors (the first such set if several). */
export function defaultAdvance(state: GameState, actions: readonly Action[], to: string): string[] {
  const best = advances(actions, to).map((a) => a.units).sort((a, b) => b.length - a.length || strength(state, b) - strength(state, a))[0];
  return best ? [...best] : [];
}

const strength = (state: GameState, ids: readonly string[]): number => unitsWithIds(state, ids).reduce((n, u) => n + u.strength, 0);

const nthOf = (units: readonly Unit[], u: Unit): string | null => {
  const twins = units.filter((x) => x.at === u.at && unitName(x) === unitName(u));
  return twins.length > 1 ? `${twins.indexOf(u) + 1} of ${twins.length}` : null;
};

/** The card for the advance into `to`, or null when none is on offer. `chosen` null: the card's starting choice. */
export function advanceModel(ctx: GameContext, state: GameState, actions: readonly Action[], to: string, chosen: readonly string[] | null): AdvanceModel | null {
  const sets = advances(actions, to).map((a) => a.units);
  if (sets.length === 0) return null;
  const picked = chosen ?? defaultAdvance(state, actions, to);
  const units = unitsWithIds(state, [...new Set(sets.flat())]);
  const toName = placeName(ctx.map, to);
  const legal = sets.some((s) => sameSet(s, picked));
  const n = picked.length;
  return {
    to,
    toName,
    chips: units.map((u): AdvanceChip => ({ id: u.id, name: unitName(u), from: placeName(ctx.map, u.at), nth: nthOf(units, u), chosen: picked.includes(u.id) })),
    chosenCount: n,
    legal,
    button: legal ? { text: `Advance ${plural(n, "unit")} into ${toName}`, disabled: false } : { text: n === 0 ? "Choose at least one unit to advance" : `These ${n} units do not all fit in ${toName}`, disabled: true },
  };
}
