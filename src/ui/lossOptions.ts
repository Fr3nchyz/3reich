import type { Action } from "../engine/actions";
import { lossSetError } from "../engine/attack-losses";
import { combatOf, type PendingLosses } from "../engine/combat-record";
import type { GameContext } from "../engine/context";
import type { GameState, Unit } from "../engine/types";
import { plural } from "./attackText";
import { placeName, stackSummary, unitName, unitsWithIds } from "./names";

/**
 * "Choose your losses" (spec 07, State 4): the data of the card for an Exchange the player settles (ALLOCATE_LOSSES). Pure: the engine's pending
 * Exchange, the legal actions and the units chosen so far in, plain data out. No rule here: the sets that are just enough come from the ALLOCATE_LOSSES
 * actions `legalActions` lists, and the factors each counter counts for come from `PendingLosses.values` (the defenders' terrain multiple is already in).
 */

export interface LossChip {
  id: string;
  /** "3-3 German infantry". */
  name: string;
  /** "Lodz (N33)". */
  from: string;
  /** "1 of 2" when an identical counter stands in the same hex; otherwise null. */
  nth: string | null;
  chosen: boolean;
  /** What this counter counts for in the Exchange. */
  value: number;
  /** "counts as 6 factors" when that differs from the printed factors (defenders count at their terrain multiple); otherwise null. */
  countsAs: string | null;
}

/** Ways to lose that read the same ("4-6 German armor and 3-3 German infantry"): the first of them is what a tap on the quick pick chooses. */
export interface LossGroup {
  /** The units of the first such set. */
  ids: string[];
  /** "4-6 German armor, 3-3 German infantry". */
  text: string;
  factors: number;
  /** How many legal sets read like this one (they differ in which hex the counters come from). */
  variants: number;
}

export interface LossModel {
  target: string;
  targetName: string;
  required: number;
  chosenFactors: number;
  chips: LossChip[];
  /** The quick picks: the legal sets grouped by what they cost, the cheapest in units first. At most `MAX_GROUPS`. */
  groups: LossGroup[];
  /** True when more groups exist than are shown. */
  moreGroups: boolean;
  /** "Chosen 2 of at least 4 factors: 2 more needed." */
  total: string;
  /** The chosen units are exactly one of the legal sets. */
  legal: boolean;
  button: { text: string; disabled: boolean };
}

/** The most quick picks the card lists; the chips reach every other legal set. */
export const MAX_GROUPS = 6;

/** The pending Exchange the player must settle, or null. */
export function ownPending(state: GameState, humanSide: "axis" | "allies"): PendingLosses | null {
  const p = combatOf(state).pending;
  return p && p.chooser === humanSide ? p : null;
}

/** The legal sets (just enough) as lists of ids, from the ALLOCATE_LOSSES actions on offer (at most the first 100 the engine lists). */
export const legalSets = (actions: readonly Action[]): string[][] => actions.flatMap((a) => (a.type === "ALLOCATE_LOSSES" ? [a.units] : []));

const nthOf = (units: readonly Unit[], u: Unit): string | null => {
  const twins = units.filter((x) => x.at === u.at && unitName(x) === unitName(u));
  return twins.length > 1 ? `${twins.indexOf(u) + 1} of ${twins.length}` : null;
};

function groupsOf(state: GameState, sets: readonly string[][], values: Readonly<Record<string, number>>): LossGroup[] {
  const by = new Map<string, LossGroup>();
  for (const ids of sets) {
    const units = unitsWithIds(state, ids);
    const key = units.map((u) => unitName(u)).sort().join("|");
    const seen = by.get(key);
    if (seen) seen.variants++;
    else by.set(key, { ids, text: stackSummary(units), factors: ids.reduce((n, id) => n + (values[id] ?? 0), 0), variants: 1 });
  }
  return [...by.values()].sort((a, b) => a.ids.length - b.ids.length || a.factors - b.factors);
}

/** The card for the Exchange the player settles, or null when there is none. `actions` are the legal actions now; `chosen` the ids picked so far. */
export function lossModel(ctx: GameContext, state: GameState, humanSide: "axis" | "allies", actions: readonly Action[], chosen: readonly string[]): LossModel | null {
  const p = ownPending(state, humanSide);
  if (!p) return null;
  const units = unitsWithIds(state, p.candidates);
  const sum = chosen.reduce((n, id) => n + (p.values[id] ?? 0), 0);
  const sets = legalSets(actions);
  // The engine lists at most 100 sets (MAX_LISTED_SETS in attack-losses.ts), so a set the player picks by hand may be legal without being
  // listed: the engine's own check (`lossSetError`) decides. No listed set at all means the player may not act now (`actions` is empty).
  const legal = sets.length > 0 && lossSetError(p, [...chosen]) === null;
  const groups = groupsOf(state, sets, p.values);
  const chips = units.map((u): LossChip => ({
    id: u.id,
    name: unitName(u),
    from: placeName(ctx.map, u.at),
    nth: nthOf(units, u),
    chosen: chosen.includes(u.id),
    value: p.values[u.id] ?? u.strength,
    countsAs: (p.values[u.id] ?? u.strength) !== u.strength ? `counts as ${plural(p.values[u.id] ?? 0, "factor")}` : null,
  }));
  const head = `Chosen ${sum} of at least ${p.required} factors`;
  const total = legal ? `${head}. That is enough.` : sum < p.required ? `${head}: ${p.required - sum} more needed.` : `${head}: more than the Exchange takes. Take one off.`;
  return {
    target: p.target,
    targetName: placeName(ctx.map, p.target),
    required: p.required,
    chosenFactors: sum,
    chips,
    groups: groups.slice(0, MAX_GROUPS),
    moreGroups: groups.length > MAX_GROUPS,
    total,
    legal,
    button: legal ? { text: `Lose ${stackSummary(unitsWithIds(state, chosen))}`, disabled: false } : { text: sum < p.required ? `Choose ${plural(p.required - sum, "more factor")} to lose` : "Take one unit off to lose exactly enough", disabled: true },
  };
}
