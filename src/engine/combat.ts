import { rollD6 } from "./rng";

/**
 * Offensive-Option ground combat. Source: PC Reference Manual 12.1-12.2 and the
 * Offensive Combat Results Table printed on the reference map.
 */

export type CrtResult = "A" | "D" | "Ex" | "CA" | "CA1" | "CA2" | "CA3";

export const ODDS_COLUMNS = ["1-4", "1-3", "1-2", "1-1", "2-1", "3-1", "4-1", "5-1"] as const;
export type OddsColumn = (typeof ODDS_COLUMNS)[number];

/** Results for die rolls 1-6, by odds column. */
export const OFFENSIVE_CRT: Record<OddsColumn, readonly CrtResult[]> = {
  "1-4": ["Ex", "A", "A", "A", "A", "A"],
  "1-3": ["Ex", "Ex", "A", "A", "A", "A"],
  "1-2": ["Ex", "Ex", "CA", "A", "A", "A"],
  "1-1": ["Ex", "CA", "CA", "Ex", "A", "D"],
  "2-1": ["Ex", "CA2", "CA2", "CA1", "D", "D"],
  "3-1": ["Ex", "CA2", "CA3", "D", "D", "D"],
  "4-1": ["Ex", "CA3", "D", "D", "D", "D"],
  "5-1": ["Ex", "D", "D", "D", "D", "D"],
};

/**
 * Convert attack and defence totals to an odds column, or null when the attack is
 * weaker than 1:4 (the attacker is then eliminated automatically). Attacks above 5:1
 * use 5:1. Fractions are ignored; for attacks weaker than 1:1 the ratio is rounded in
 * the defender's favour (e.g. 5 vs 12 is 1:3). TODO(verify): the manual says only
 * "fractions are ignored"; defender-favoured rounding below 1:1 is the board-game
 * convention.
 */
export function oddsColumn(attack: number, defense: number): OddsColumn | null {
  if (defense <= 0) return "5-1";
  if (attack <= 0) return null;
  if (attack >= defense) {
    const n = Math.min(5, Math.floor(attack / defense));
    return `${n}-1` as OddsColumn;
  }
  const n = Math.ceil(defense / attack);
  if (n > 4) return null;
  return `1-${n}` as OddsColumn;
}

/** Fixed columns forced by CA1/CA2/CA3 for the defender's counterattack. */
const FORCED_COUNTERATTACK_COLUMN: Partial<Record<CrtResult, OddsColumn>> = {
  CA1: "1-1",
  CA2: "1-2",
  CA3: "1-3",
};

export interface CombatInput {
  /** Basic factors of all attacking units, including ground support and shore bombardment. */
  attackFactors: number;
  /** Basic (unmultiplied) factors of the defending units, including DAS. */
  defenseBasicFactors: number;
  /** Defender's terrain multiplier (see defenseMultiplier). */
  defenseMultiplier: number;
}

export type CombatOutcome =
  /** All original attackers eliminated. */
  | { kind: "attacker-eliminated" }
  /** All original defenders eliminated. */
  | { kind: "defender-eliminated" }
  /**
   * Exchange: the side with fewer factors loses everything; the larger side removes at
   * least as many factors. `multipliedDefense` is true when the attacker must match the
   * defender's multiplied value (false when the Exchange was rolled on a counterattack).
   */
  | { kind: "exchange"; multipliedDefense: boolean };

export interface CombatRound {
  /** Who rolled: the original attacker, or the defender counterattacking. */
  by: "attacker" | "defender";
  column: OddsColumn | null;
  roll: number | null;
  result: CrtResult | "auto-eliminated";
}

export interface CombatResolution {
  outcome: CombatOutcome;
  rounds: CombatRound[];
  rngState: number;
}

const MAX_ROUNDS = 200;

/**
 * Resolve one Offensive-Option attack, including any chain of counterattacks. A battle
 * never ends on a CA: the defender counterattacks with basic factors on both sides
 * (or on the fixed column for CA1-3); if that counterattack rolls any CA, the original
 * attack is repeated at the original odds.
 */
export function resolveOffensiveCombat(input: CombatInput, rngState: number): CombatResolution {
  const rounds: CombatRound[] = [];
  const defenseTotal = input.defenseBasicFactors * input.defenseMultiplier;
  const originalColumn = oddsColumn(input.attackFactors, defenseTotal);
  let state = rngState;

  if (originalColumn === null) {
    rounds.push({ by: "attacker", column: null, roll: null, result: "auto-eliminated" });
    return { outcome: { kind: "attacker-eliminated" }, rounds, rngState: state };
  }

  while (rounds.length < MAX_ROUNDS) {
    // Original attack.
    const a = rollD6(state);
    state = a.state;
    const result = OFFENSIVE_CRT[originalColumn][a.roll - 1]!;
    rounds.push({ by: "attacker", column: originalColumn, roll: a.roll, result });
    if (result === "A") return { outcome: { kind: "attacker-eliminated" }, rounds, rngState: state };
    if (result === "D") return { outcome: { kind: "defender-eliminated" }, rounds, rngState: state };
    if (result === "Ex") {
      return { outcome: { kind: "exchange", multipliedDefense: true }, rounds, rngState: state };
    }

    // Defender counterattacks with basic factors on both sides.
    const column =
      FORCED_COUNTERATTACK_COLUMN[result] ?? oddsColumn(input.defenseBasicFactors, input.attackFactors);
    if (column === null) {
      rounds.push({ by: "defender", column: null, roll: null, result: "auto-eliminated" });
      return { outcome: { kind: "defender-eliminated" }, rounds, rngState: state };
    }
    const c = rollD6(state);
    state = c.state;
    const counter = OFFENSIVE_CRT[column][c.roll - 1]!;
    rounds.push({ by: "defender", column, roll: c.roll, result: counter });
    // On a counterattack, "A" eliminates the counterattacking (original defending) units
    // and "D" eliminates the original attackers.
    if (counter === "A") return { outcome: { kind: "defender-eliminated" }, rounds, rngState: state };
    if (counter === "D") return { outcome: { kind: "attacker-eliminated" }, rounds, rngState: state };
    if (counter === "Ex") {
      return { outcome: { kind: "exchange", multipliedDefense: false }, rounds, rngState: state };
    }
    // Any CA on the counterattack: the original attack begins again at the original odds.
  }
  throw new Error("Combat did not resolve; check the RNG.");
}

/**
 * Quarterly Attrition Resolution Table. Columns are ground factors in contact; each
 * result is [units the defender must eliminate (#C), hexes the defender must vacate (#H)].
 * Source: PC Reference Manual 12.4 and the printed table.
 */
export const ATTRITION_COLUMNS = ["1-10", "11-20", "21-30", "31-40", "41-50", "51-60", "61+"] as const;
export type AttritionColumn = (typeof ATTRITION_COLUMNS)[number];

type Loss = readonly [units: number, hexes: number];
const _ = [0, 0] as const;

export const ATTRITION_TABLE: Record<AttritionColumn, readonly Loss[]> = {
  "1-10": [[1, 0], [1, 0], _, _, _, _],
  "11-20": [[2, 1], [2, 0], [1, 1], [1, 0], [1, 0], _],
  "21-30": [[3, 2], [3, 1], [3, 0], [2, 1], [2, 0], [1, 0]],
  "31-40": [[4, 3], [4, 2], [4, 1], [3, 1], [3, 0], [2, 0]],
  "41-50": [[5, 4], [5, 3], [5, 2], [4, 1], [3, 1], [3, 0]],
  "51-60": [[6, 4], [6, 3], [6, 2], [5, 2], [4, 1], [4, 1]],
  "61+": [[7, 4], [7, 3], [7, 2], [6, 2], [5, 2], [4, 2]],
};

export function attritionColumn(groundFactors: number): AttritionColumn | null {
  if (groundFactors <= 0) return null;
  if (groundFactors > 60) return "61+";
  return ATTRITION_COLUMNS[Math.floor((groundFactors - 1) / 10)]!;
}

export function resolveAttrition(
  groundFactors: number,
  rngState: number,
): { units: number; hexes: number; roll: number | null; rngState: number } {
  const column = attritionColumn(groundFactors);
  if (column === null) return { units: 0, hexes: 0, roll: null, rngState };
  const { roll, state } = rollD6(rngState);
  const [units, hexes] = ATTRITION_TABLE[column][roll - 1]!;
  return { units, hexes, roll, rngState: state };
}
