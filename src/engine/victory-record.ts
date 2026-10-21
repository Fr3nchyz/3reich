import type { GameTurn, Side } from "./types";

/**
 * Victory: the shapes of the rules (data/victory.ts), of the record kept during play, and of the result
 * (spec 14 C1, R2; Ref 2.0 to 2.4, 11.63). No logic except the verdict names: victory.ts holds the rules.
 */

/** The size of a win; the DOS game's words (Decisive, Tactical, Marginal). */
export type VictoryLevel = "decisive" | "tactical" | "marginal";

/** Objectives a side must hold for each level (at least this many). */
export type LevelNeeds = Record<VictoryLevel, number>;

export interface ObjectiveTable {
  allies: LevelNeeds;
  axis: LevelNeeds;
}

/** A level won by a conquest in a span of Game Turns (both ends included; `from` left out: any earlier turn). */
export interface ConquestWindow {
  winner: Side;
  level: VictoryLevel;
  from?: GameTurn;
  to: GameTurn;
}

/**
 * How a scenario is won (Ref 2.1 to 2.4; the numbers are in src/data/victory.ts).
 * - "objectives" (1939, 1942): Objectives held at the end of play; the Free Siberian Transfer changes the Allied numbers.
 * - "germany-falls" (1944): the Game Turn in which Germany is conquered; Germany standing at the end is read as an Axis Decisive win. TODO(verify) V5.
 * - "campaign": the Allies win by conquering Germany and Italy by a date; otherwise the Axis wins by conquering Allied Major Powers or by holding Objectives at a checkpoint.
 */
export type VictoryRules =
  | { kind: "objectives"; plain: ObjectiveTable; siberian: ObjectiveTable }
  | { kind: "germany-falls"; windows: ConquestWindow[] }
  | {
      kind: "campaign";
      plain: ConquestWindow[];
      siberian: ConquestWindow[];
      /** The Axis levels. `marginal`: this many Objectives held when the Game Turn `at` ends. `tacticalPowers`, `decisivePowers`: Allied Major Powers conquered. */
      axis: { marginal: { objectives: number; at: GameTurn }; tacticalPowers: number; decisivePowers: number };
    };

/** What the victory rules remember during play: the Objective count of the Axis at the Campaign checkpoint, keyed "1943-winter". */
export interface VictoryRecord {
  checkpoints: Record<string, number>;
}

export interface ObjectiveCount {
  axis: number;
  allies: number;
  nobody: number;
}

/** Who won, how big, and why. Set once, together with the phase "game-over". */
export interface GameResult {
  /** Null: a Stalemate. */
  winner: Side | null;
  /** Null with a Stalemate. */
  level: VictoryLevel | null;
  basis: "objectives" | "conquest" | "powers-conquered" | "turn-limit";
  /** The Objectives held when the result was reached. */
  objectives: ObjectiveCount;
  /** The Game Turn in which the result was reached. */
  at: GameTurn;
  /** True when the game ended before the scenario's last turn. */
  early: boolean;
  /** Whether the tables for the Free Siberian Transfer were used. */
  siberian: boolean;
}

const LEVEL_NAMES: Record<VictoryLevel, string> = { decisive: "Decisive", tactical: "Tactical", marginal: "Marginal" };

/** The DOS game's verdict names: "Allied Marginal Victory", "Axis Decisive Victory", "Stalemate" (Ref 2.1). */
export function verdictName(r: Pick<GameResult, "winner" | "level">): string {
  if (r.winner === null || r.level === null) return "Stalemate";
  return `${r.winner === "allies" ? "Allied" : "Axis"} ${LEVEL_NAMES[r.level]} Victory`;
}
