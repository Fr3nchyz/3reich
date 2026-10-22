import { exchangeCost, minimalSets, type ExchangeCost } from "../engine/attack-losses";
import { FORCED_COUNTERATTACK_COLUMN, OFFENSIVE_CRT, oddsColumn, type CrtResult, type OddsColumn } from "../engine/combat";
import type { Unit } from "../engine/types";

/**
 * The six rows of "if you roll ..." for an attack, in words (spec 07, part B "What the preview shows"). Every row is read from the engine's
 * tables (`OFFENSIVE_CRT`, `FORCED_COUNTERATTACK_COLUMN`, `oddsColumn`) and the Exchange arithmetic from `exchangeCost`, so the card cannot
 * disagree with the battle (Ref 12.1, 12.2). Nothing here decides a rule.
 */

export const MULTIPLE_WORDS: Readonly<Record<number, string>> = { 1: "counted once", 2: "doubled", 3: "tripled", 4: "quadrupled" };
export const multipleWord = (m: number): string => MULTIPLE_WORDS[m] ?? `times ${m}`;

/** What happens to the defenders' counterattack roll, one line per distinct result of the counterattack column. */
export interface CounterLine {
  rollText: string;
  result: CrtResult;
  text: string;
}

export interface CounterInfo {
  /** The column the defenders roll on; null when their factors are so weak against yours that they are eliminated with no roll. */
  column: OddsColumn | null;
  text: string;
  lines: CounterLine[];
}

export interface ResultRow {
  /** The die rolls that give this result (rows with the same result are merged). */
  rolls: number[];
  rollText: string;
  result: CrtResult;
  /** A short heading: "Exchange", "Counterattack"... */
  title: string;
  text: string;
  /** For an Exchange: who loses what (computed by the engine's `exchangeCost`). */
  exchange?: ExchangeCost;
  /** For CA, CA1, CA2, CA3: where the defenders strike back and what that can lead to. */
  counter?: CounterInfo;
}

export interface ResultInput {
  column: OddsColumn;
  attackers: readonly Unit[];
  defenders: readonly Unit[];
  multiplier: number;
  /** Names of the enemy counters that also go when the defenders are eliminated (see `lonersAt`). */
  alsoDestroyed: readonly string[];
  /** Names of the enemy fleets that move to a friendly port instead when the defenders are eliminated (spec 12 R9). Default none. */
  alsoMoved?: readonly string[];
  /** Whether the hex is left empty when the defenders go, so the survivors may advance. */
  emptyAfterWin: boolean;
}

const sum = (us: readonly Unit[]): number => us.reduce((n, u) => n + u.strength, 0);
const units = (n: number): string => (n === 1 ? "1 unit" : `${n} units`);
const fx = (n: number): string => (n === 1 ? "1 factor" : `${n} factors`);

/** "1", "1 or 4", "2, 3 or 5". */
export function rollWords(rolls: readonly number[]): string {
  if (rolls.length <= 1) return `${rolls[0] ?? ""}`;
  return `${rolls.slice(0, -1).join(", ")} or ${rolls.at(-1)}`;
}

/** The merged rows of one column: equal results are one row, in the order of the first roll that gives them. */
function mergeRolls(column: OddsColumn): Map<CrtResult, number[]> {
  const out = new Map<CrtResult, number[]>();
  OFFENSIVE_CRT[column].forEach((result, i) => out.set(result, [...(out.get(result) ?? []), i + 1]));
  return out;
}

/** Whether the side that removes the factors has a real choice: more than one set of its units is just enough (the engine picks the set itself when there is only one). */
export const hasChoice = (c: ExchangeCost): boolean => minimalSets(Object.keys(c.values), c.values, c.required).length > 1;

/** An Exchange in words, for the original attack (defenders at the multiple) or for a counterattack (basic factors, multiple 1). */
export function exchangeWords(c: ExchangeCost, multiple: number): string {
  if (c.chooser === null) return `Exchange: the sides are equal at ${fx(c.attackTotal)}, so both lose every unit.`;
  const worth = multiple > 1 && c.chooser === "defenders" ? `, each of their units counting ${multipleWord(multiple)}` : "";
  const choice = hasChoice(c);
  if (c.attackersLoseAll) return `Exchange: you lose all your ${fx(c.attackTotal)}; they lose at least ${fx(c.required)}${worth}${choice ? " and they choose which units" : " (only one set of their units is enough, so nothing is left to choose)"}.`;
  const counted = multiple > 1 ? ` (their ${c.defenseTotal} counted ${multipleWord(multiple)})` : "";
  return `Exchange: they lose all${counted}; you lose at least ${c.required} of your factors${choice ? " and you choose which units" : " (only one set of your units is enough, so nothing is left to choose)"}.`;
}

/** The defenders' counterattack after a CA: which column they roll on and what each roll does (Ref 12.2; combat.ts `resolveOffensiveCombat`). */
function counterOf(result: CrtResult, i: ResultInput): CounterInfo {
  const forced = FORCED_COUNTERATTACK_COLUMN[result];
  const attack = sum(i.attackers);
  const defence = sum(i.defenders);
  const column = forced ?? oddsColumn(defence, attack);
  if (column === null) return { column, text: `Counterattack: the defenders are too weak to strike back (${defence} against ${attack}, weaker than 1-4), so they are eliminated with no roll.`, lines: [] };
  const how = forced ? `on the fixed column ${column}` : `on column ${column} (their ${defence} basic factors against your ${attack}, no terrain)`;
  const ex = exchangeWords(exchangeCost(i.attackers, i.defenders, 1), 1);
  const words = (r: CrtResult): string =>
    r === "A" ? "The defenders are eliminated." : r === "D" ? "Your attackers are eliminated." : r === "Ex" ? `${ex} Basic factors on both sides.` : "Your attack is made again at the same odds.";
  const lines = [...mergeRolls(column)].map(([r, rolls]): CounterLine => ({ rollText: rollWords(rolls), result: r, text: words(r) }));
  return { column, text: `Counterattack: nothing is lost yet. The defenders strike back ${how}.`, lines };
}

const TITLES: Readonly<Record<CrtResult, string>> = {
  A: "Attackers eliminated",
  D: "Defenders eliminated",
  Ex: "Exchange",
  CA: "Counterattack",
  CA1: "Counterattack 1",
  CA2: "Counterattack 2",
  CA3: "Counterattack 3",
};

/** The sentence about enemy fleets that leave the port with no roll when the defenders go: they move to the nearest friendly port with room, or are lost if there is none. */
const movedWords = (i: ResultInput): string => {
  const n = i.alsoMoved?.length ?? 0;
  return n === 0 ? "" : ` ${n === 1 ? "This enemy fleet moves" : "These enemy fleets move"} to a friendly port (or ${n === 1 ? "is" : "are"} lost if none has room): ${i.alsoMoved!.join(", ")}.`;
};

/**
 * What an Exchange leaves behind in the hex: when the defenders can all go, the enemy air units alone in the hex are destroyed
 * too and the fleets driven out to a friendly port (`lonersAt`, as after a D), and when the attackers also keep survivors they may advance into the empty hex.
 */
function exchangeAftermath(c: ExchangeCost, i: ResultInput): string {
  const canEmpty = c.defendersLoseAll || (c.chooser === "defenders" && minimalSets(Object.keys(c.values), c.values, c.required).some((set) => set.length === i.defenders.length));
  if (!canEmpty) return "";
  const loners = i.alsoDestroyed.length > 0 ? ` ${c.defendersLoseAll ? "These enemy counters in the hex go too, with no roll" : "If their losses leave the hex empty, these enemy counters go too, with no roll"}: ${i.alsoDestroyed.join(", ")}.` : "";
  const advance = c.defendersLoseAll && !c.attackersLoseAll && i.emptyAfterWin ? " The hex is left empty and your survivors may advance." : "";
  return `${loners}${movedWords(i)}${advance}`;
}

/** One row per distinct result of the column, with its cost in plain words. */
export function resultRows(i: ResultInput): ResultRow[] {
  const att = sum(i.attackers);
  const def = sum(i.defenders);
  return [...mergeRolls(i.column)].map(([result, rolls]): ResultRow => {
    const base = { rolls, rollText: rollWords(rolls), result, title: TITLES[result] };
    if (result === "A") return { ...base, text: `Your attackers are eliminated: you lose all ${units(i.attackers.length)} (${fx(att)}). They lose nothing.` };
    if (result === "D") {
      const also = i.alsoDestroyed.length > 0 ? ` These enemy counters in the hex go too, with no roll: ${i.alsoDestroyed.join(", ")}.` : "";
      const adv = movedWords(i) + (i.emptyAfterWin ? " The hex is left empty and your survivors may advance." : "");
      return { ...base, text: `The defenders are eliminated: they lose all ${units(i.defenders.length)} (${fx(def)}). You lose nothing.${also}${adv}` };
    }
    if (result === "Ex") {
      const exchange = exchangeCost(i.attackers, i.defenders, i.multiplier);
      return { ...base, exchange, text: `${exchangeWords(exchange, i.multiplier)}${exchangeAftermath(exchange, i)}` };
    }
    const counter = counterOf(result, i);
    return { ...base, counter, text: counter.text };
  });
}
