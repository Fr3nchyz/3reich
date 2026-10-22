import type { ConquestWindow, GameResult, ObjectiveCount, VictoryLevel, VictoryRules } from "../engine/victory-record";
import type { VictoryTarget } from "../engine/victory";
import type { GameTurn, Side } from "../engine/types";
import { cap } from "./format";

/**
 * Every word of the victory screens (spec 14, part D), in one module so that the French pass changes this file only. Plain sentences, numbers
 * instead of adjectives where possible, no idioms. The DOS game's verdict names are kept as they are ("Allied Marginal Victory", engine/victory-record.ts).
 * The one place for words: the cards and their buttons take every sentence and label from here.
 * TODO(verify) V30: the one-line plain meanings under the verdict ("a small win for the Allies") are ours, not the DOS game's; the words are a guess.
 */

export const turnName = (t: GameTurn): string => `${cap(t.season)} ${t.year}`;
const levelName = (l: VictoryLevel): string => cap(l);
const sideThe = (s: Side): string => (s === "axis" ? "the Axis" : "the Allies");
const sideThe1 = (s: Side): string => cap(sideThe(s));
const NUMBER_WORDS: Record<number, string> = { 2: "two", 3: "three" };
const more = (n: number): string => `${n} more`;
type CampaignAxis = NonNullable<VictoryTarget["axis"]>;

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
  siberianExempt: "The Free Siberian Transfer does not apply in this scenario.",
  objectivesTitle: "Victory and objectives",
  closeObjectives: "Close the Victory and objectives card",
} as const;

/** Who holds an Objective, in words. */
export type Holder = "Axis" | "Allies" | "nobody";
/** The title of a block of the Objectives card: "Western Front (14)". */
export const frontTitle = (front: string, n: number): string => `${cap(front)} Front (${n})`;
/** What a screen reader says for a row of the Objectives card. */
export const rowLabel = (name: string, holder: Holder): string => `${name}: ${holder}. Show on the map.`;

export const scenarioEnded = (t: GameTurn): string => `The scenario ended after ${turnName(t)}.`;

/** What decided a result that came from a conquest or from holding on (the basis is not "objectives"). `axis` is the Campaign's data (powers to conquer), when the scenario has it. */
export function decidedBy(kind: VictoryRules["kind"], r: GameResult, checkpoint: number | undefined, axis?: Pick<CampaignAxis, "tacticalPowers" | "decisivePowers">): string {
  switch (r.basis) {
    case "conquest":
      return `${kind === "germany-falls" ? "Germany" : "The Axis"} was conquered in ${turnName(r.at)}.`;
    case "powers-conquered": {
      const n = axis ? (r.level === "decisive" ? axis.decisivePowers : axis.tacticalPowers) : 0;
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
 * The numbers are the engine's (`victoryTarget`: the table in force and each side's next level); nothing is worked out here.
 */
export function needLines(r: Pick<GameResult, "winner" | "level">, target: VictoryTarget): string[] {
  const { table, next } = target;
  if (!table || !next) return [];
  if (r.winner === null || r.level === null) {
    return (["allies", "axis"] as const).flatMap((side) => {
      const n = next[side];
      return n ? [needLine(side, n.level, n.needs, ` (${more(n.more)})`)] : [];
    });
  }
  const lines = [needLine(r.winner, r.level, table[r.winner][r.level], "")];
  const n = next[r.winner];
  if (n) lines.push(`They needed ${n.needs} for a ${levelName(n.level)} victory (${more(n.more)}).`);
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

/** The last block of the Objectives card: what each side needs, as lines of text, from the engine's `victoryTarget` (the tables and windows in force). */
export function needsText(target: VictoryTarget, end: GameTurn): { title: string; lines: string[] } {
  const { table, windows, axis: a } = target;
  if (table) {
    const row = (side: Side) => `${cap(side)}: ${(["marginal", "tactical", "decisive"] as const).map((l) => `${table[side][l]} = ${levelName(l)}`).join(", ")}`;
    return { title: `What each side needs when ${turnName(end)} ends`, lines: [row("allies"), row("axis"), "In between: Stalemate."] };
  }
  if (target.kind === "germany-falls" && windows) {
    const held = windows.filter((w) => w.winner === "axis");
    const last = held[held.length - 1];
    const axisText = held.map((w, i) => `${levelName(w.level)} ${i === 0 ? "if Germany falls " : ""}${windowText(w)}${w === last ? " or later" : ""}`).join(", ");
    return {
      title: "What each side needs",
      lines: [`The Allies win by conquering Germany: ${windowsFor(windows, "allies")}.`, `The Axis wins by holding on: ${axisText}.`, "There is no Stalemate."],
    };
  }
  if (!windows || !a) return { title: "What each side needs", lines: [] };
  return {
    title: "What each side needs",
    lines: [
      `The Allies win by conquering Germany and Italy: ${windowsFor(windows, "allies")}.`,
      `If they do not, the Axis wins: Decisive by conquering ${NUMBER_WORDS[a.decisivePowers]} Allied Major Powers, Tactical by conquering ${NUMBER_WORDS[a.tacticalPowers]}, Marginal by holding ${a.marginal.objectives} or more Objectives when ${turnName(a.marginal.at)} ends.`,
      "Otherwise: Stalemate.",
    ],
  };
}

/**
 * The words of the Russian winter screens (spec 14, part D4; ticket 14-13): the card at II.A, the banner on the turn line, the greyed Offensive button and the
 * line in the attack card. The log lines are `winterText.ts`. Kept here with the other words of the victory screens, so that the French pass changes this file only.
 */
export const WINTER_TEXT = {
  title: "Russian winter",
  first: "This is the first winter of the war between Germany and Russia.",
  /** What the winter does, for the one Game Turn it is on (Ref 28.0, R10). */
  effects: "In Russia the Axis defence is not doubled. The Axis may not use an Offensive Option in the East.",
  banner: "Russian winter this turn.",
  wait: "Wait for next winter",
  start: "Winter starts now",
  ok: "OK, the winter starts now",
  /** The reason in the attack card, before the colon is the short name used in the list of attacks ("Russian winter x1"). */
  previewReason: "Russian winter: Axis defence not doubled",
  /** The greyed Offensive button of step 3 and the reason shown when it is tapped. */
  greyedOption: "Eastern Front: Offensive Option",
  greyedReason: "Russian winter: the Axis may not take the Offensive Option on the Eastern Front this Game Turn. Attrition and Defensive are still allowed.",
  declared: "The Soviet Union declared war on Germany in a Winter turn, so the Russian winter starts now. Russia cannot put it off.",
  askLine: "the Allies say whether it waits",
  askLineComputer: "the computer, playing the Allies, decides whether it waits",
} as const;

const unitsWord = (n: number): string => `${n} ground unit${n === 1 ? "" : "s"}`;

/** "Dice: 4 + 6 + 3 + 5 = 18". */
export const diceLine = (dice: readonly number[], total: number): string => `Dice: ${dice.join(" + ")} = ${total}`;

/** "Axis ground units inside Russia: 12 (not counting Finns)." */
export const axisUnitsLine = (n: number): string => `Axis ${unitsWord(n)} inside Russia: ${n} (not counting Finns).`;

/** The test, in words: "12 is fewer than 18, so Russia may wait one year." After the Allies chose not to wait: "... so Russia could wait one year; it chose to start the winter now." */
export function testLine(units: number, total: number, may: boolean, startedAnyway: boolean): string {
  if (!may) return `${units} is not fewer than ${total}, so Russia may not wait.`;
  return startedAnyway ? `${units} is fewer than ${total}, so Russia could wait one year; it chose to start the winter now.` : `${units} is fewer than ${total}, so Russia may wait one year.`;
}

/** The banner under the turn line for the whole Game Turn the winter is on. */
export const winterBanner = (): string => `${WINTER_TEXT.banner} ${WINTER_TEXT.effects}`;

/** The line of a winter that Russia put off and that now starts. */
export const postponedStartLine = (from: GameTurn): string => `The Russian winter that Russia put off from ${turnName(from)} starts now.`;
