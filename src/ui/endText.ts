import type { ConquestWindow, GameResult, LevelNeeds, ObjectiveCount, VictoryLevel, VictoryRules } from "../engine/victory-record";
import type { GameTurn, Side } from "../engine/types";
import { cap } from "./format";

/**
 * Every word of the victory screens (spec 14, part D), in one module so that the French pass changes this file only. Plain sentences, numbers
 * instead of adjectives where possible, no idioms. The DOS game's verdict names are kept as they are ("Allied Marginal Victory", engine/victory-record.ts).
 * TODO(verify) V30: the one-line plain meanings under the verdict ("a small win for the Allies") are ours, not the DOS game's; the words are a guess.
 */

export const turnName = (t: GameTurn): string => `${cap(t.season)} ${t.year}`;
const levelName = (l: VictoryLevel): string => cap(l);
const sideThe = (s: Side): string => (s === "axis" ? "the Axis" : "the Allies");
const sideThe1 = (s: Side): string => cap(sideThe(s));
const NUMBER_WORDS: Record<number, string> = { 2: "two", 3: "three" };
const more = (n: number): string => `${n} more`;

/** "Objectives held: Axis 17, Allies 21, nobody 4": the line under the turn line. */
export const scoreLine = (c: ObjectiveCount): string => `Objectives held: Axis ${c.axis}, Allies ${c.allies}, nobody ${c.nobody}`;
/** What the shapes on the map mean (spec 14, D1: shape, not colour alone). */
export const MARK_KEY = "On the map: a square is an Objective the Axis holds, a circle one the Allies hold, a dashed ring one that nobody holds.";
export const OBJECTIVES_BUTTON = "Victory and objectives";
export const SHOW_RESULT_BUTTON = "Show the result";

/** The status line once the game is over: "Game over: Allied Marginal Victory". */
export const gameOverLine = (verdict: string): string => `Game over: ${verdict}`;

/** The plain meaning under the verdict, in brackets: "(a small win for the Allies)". */
export function verdictMeaning(r: Pick<GameResult, "winner" | "level">): string {
  if (r.winner === null || r.level === null) return "(a draw: neither side won)";
  const size = { marginal: "a small win", tactical: "a clear win", decisive: "a complete win" }[r.level];
  return `(${size} for ${sideThe(r.winner)})`;
}

export const END_TEXT = {
  label: "Game over",
  stalemateReason: "Neither side reached its target.",
  look: "Look at the map",
  log: "Read the log",
  newGame: "New game",
  close: "Close",
  siberianUsed: "The tables for the Free Siberian Transfer were used: the Allied targets are one higher.",
  siberianNot: "Free Siberian Transfer: not used.",
  siberianIn: "Free Siberian Transfer: in use. The Allied targets are one objective higher.",
} as const;

export const scenarioEnded = (t: GameTurn): string => `The scenario ended after ${turnName(t)}.`;

/** What decided a result that came from a conquest or from holding on (the basis is not "objectives"). */
export function decidedBy(kind: VictoryRules["kind"], r: GameResult, checkpoint: number | undefined, tacticalPowers = 2, decisivePowers = 3): string {
  switch (r.basis) {
    case "conquest":
      return `${kind === "germany-falls" ? "Germany" : "The Axis"} was conquered in ${turnName(r.at)}.`;
    case "powers-conquered": {
      const n = r.level === "decisive" ? decisivePowers : tacticalPowers;
      return `The Axis conquered ${NUMBER_WORDS[n] ?? n} Allied Major Powers.`;
    }
    case "turn-limit":
      return kind === "germany-falls" ? `Germany was still standing when the scenario ended after ${turnName(r.at)}.` : END_TEXT.stalemateReason;
    case "objectives":
      return checkpoint !== undefined && kind === "campaign" ? `The Axis held ${checkpoint} Objectives when Winter 1943 ended.` : scenarioEnded(r.at);
  }
}

const needLine = (side: Side, level: VictoryLevel, needs: number, extra: string): string => `${sideThe1(side)} needed ${needs} for a ${levelName(level)} victory${extra}.`;

/**
 * The lines under the counts on the result card for the scenarios counted by Objectives: what the winner needed, and what the next level
 * needed ("The Allies needed 15 for a Marginal victory. They needed 16 for a Tactical victory (1 more)."); for a Stalemate, what each side missed.
 */
export function needLines(r: Pick<GameResult, "winner" | "level">, counts: ObjectiveCount, table: { allies: LevelNeeds; axis: LevelNeeds }): string[] {
  const nextOf = (side: Side): [VictoryLevel, number] | null => {
    const needs = table[side];
    const level = (["marginal", "tactical", "decisive"] as const).find((l) => needs[l] > counts[side]);
    return level ? [level, needs[level]] : null;
  };
  if (r.winner === null || r.level === null) {
    return (["allies", "axis"] as const).map((side) => {
      const next = nextOf(side);
      return next ? needLine(side, next[0], next[1], ` (${more(next[1] - counts[side])})`) : "";
    }).filter(Boolean);
  }
  const lines = [needLine(r.winner, r.level, table[r.winner][r.level], "")];
  const next = nextOf(r.winner);
  if (next) lines.push(`They needed ${next[1]} for a ${levelName(next[0])} victory (${more(next[1] - counts[r.winner])}).`);
  return lines;
}

/** "in or before Winter 1944", "in Spring 1945", "in Fall or Winter 1944", "in Winter 1944 or Spring 1945". A window is never longer than two Game Turns. */
export function windowText(w: ConquestWindow): string {
  if (!w.from) return `in or before ${turnName(w.to)}`;
  const a = turnName(w.from);
  const b = turnName(w.to);
  if (a === b) return `in ${a}`;
  return w.from.year === w.to.year ? `in ${cap(w.from.season)} or ${b}` : `in ${a} or ${b}`;
}

const windowsFor = (windows: readonly ConquestWindow[], winner: Side): string => windows.filter((w) => w.winner === winner).map((w) => `${levelName(w.level)} ${windowText(w)}`).join(", ");

/** The last block of the Objectives card: what each side needs, as lines of text. */
export function needsText(rules: VictoryRules, siberian: boolean, end: GameTurn): { title: string; lines: string[] } {
  if (rules.kind === "objectives") {
    const t = siberian ? rules.siberian : rules.plain;
    const row = (side: Side) => `${cap(side)}: ${(["marginal", "tactical", "decisive"] as const).map((l) => `${t[side][l]} = ${levelName(l)}`).join(", ")}`;
    return { title: `What each side needs when ${turnName(end)} ends`, lines: [row("allies"), row("axis"), "In between: Stalemate."] };
  }
  if (rules.kind === "germany-falls") {
    const axis = rules.windows.filter((w) => w.winner === "axis");
    const last = axis[axis.length - 1];
    const axisText = axis.map((w, i) => `${levelName(w.level)} ${i === 0 ? "if Germany falls " : ""}${windowText(w)}${w === last ? " or later" : ""}`).join(", ");
    return {
      title: "What each side needs",
      lines: [`The Allies win by conquering Germany: ${windowsFor(rules.windows, "allies")}.`, `The Axis wins by holding on: ${axisText}.`, "There is no Stalemate."],
    };
  }
  const windows = siberian ? rules.siberian : rules.plain;
  const a = rules.axis;
  return {
    title: "What each side needs",
    lines: [
      `The Allies win by conquering Germany and Italy: ${windowsFor(windows, "allies")}.`,
      `If they do not, the Axis wins: Decisive by conquering ${NUMBER_WORDS[a.decisivePowers]} Allied Major Powers, Tactical by conquering ${NUMBER_WORDS[a.tacticalPowers]}, Marginal by holding ${a.marginal.objectives} Objectives when ${turnName(a.marginal.at)} ends.`,
      "Otherwise: Stalemate.",
    ],
  };
}
