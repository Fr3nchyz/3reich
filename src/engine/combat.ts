import { rollD6 } from "./rng";

export type CombatResult =
  | "attacker-eliminated"
  | "attacker-retreats"
  | "exchange"
  | "defender-retreats"
  | "defender-eliminated";

/**
 * PLACEHOLDER combat results table. The values below are NOT the real game's table;
 * they exist so the engine can be exercised end to end. Replace with the table from
 * the original rules once the manual has been transcribed (see docs/RULES.md).
 */
const PLACEHOLDER_TABLE: Record<number, CombatResult[]> = {
  // odds column -> results for die rolls 1..6
  1: ["attacker-eliminated", "attacker-eliminated", "attacker-retreats", "attacker-retreats", "exchange", "exchange"],
  2: ["attacker-eliminated", "attacker-retreats", "attacker-retreats", "exchange", "defender-retreats", "defender-retreats"],
  3: ["attacker-retreats", "exchange", "exchange", "defender-retreats", "defender-retreats", "defender-eliminated"],
  4: ["exchange", "defender-retreats", "defender-retreats", "defender-retreats", "defender-eliminated", "defender-eliminated"],
};

/** Reduce attack:defense strengths to a whole-number odds column, clamped to the table. */
export function oddsColumn(attack: number, defense: number): number {
  if (attack <= 0) return 1;
  if (defense <= 0) return 4;
  const ratio = Math.floor(attack / defense);
  return Math.min(4, Math.max(1, ratio));
}

export function resolveCombat(
  attack: number,
  defense: number,
  rngState: number,
): { result: CombatResult; roll: number; rngState: number } {
  const { roll, state } = rollD6(rngState);
  const column = PLACEHOLDER_TABLE[oddsColumn(attack, defense)]!;
  return { result: column[roll - 1]!, roll, rngState: state };
}
