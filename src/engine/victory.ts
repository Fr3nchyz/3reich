import type { GameContext } from "./context";
import { turnIndex } from "./game";
import { objectiveStandings } from "./objectives";
import type { Conquest } from "./conquest-record";
import type { GameState, GameTurn, Side } from "./types";
import type { ConquestWindow, GameResult, LevelNeeds, ObjectiveCount, ObjectiveTable, VictoryLevel, VictoryRules } from "./victory-record";

/**
 * Who has won (spec 14 R2, R3; Ref 2.0 to 2.4, 11.63). Pure queries over the state: `evaluateVictory` gives the result
 * that stands, `victoryTarget` what each side needs, `recordCheckpoint` remembers the Campaign's Winter 1943 count.
 * The conquests it reads (`GameState.conquests`) are written by the rules of tickets 14-5 (Major Powers) and 14-6 (every other country); without any, nobody has been conquered.
 */

/**
 * TODO(verify) V5: Germany still standing when the 1944 scenario ends is read as an Axis Decisive win (the table has no
 * Stalemate and its last line is "Spring 1946", the scenario's last Game Turn).
 */
export const GERMANY_STANDING_AT_END: Pick<GameResult, "winner" | "level"> = { winner: "axis", level: "decisive" };

/**
 * TODO(verify) V3: the game stops the moment the deciding conquest completes (1944: Germany; Campaign: the last Axis Major Power, or the third
 * Allied one), not at the end of the turn or the scenario. The program has a Game Over dialog; when it shows is not known. Owner's decision Q1: yes.
 */
export const END_EARLY_ON_CONQUEST = true;

/** When the result is asked for: right after a conquest completes, or when the last Game Turn is over. */
export type VictoryMoment = "after-conquest" | "end-of-play";

const RANK: Record<VictoryLevel, number> = { marginal: 1, tactical: 2, decisive: 3 };
const LEVELS: readonly VictoryLevel[] = ["marginal", "tactical", "decisive"];
const ALLIED_MAJOR_POWERS = ["britain", "france", "ussr"] as const;

/** The key a Game Turn has in the records: "1943-winter". */
export const turnKey = (t: GameTurn): string => `${t.year}-${t.season}`;

/** Whether the tables for the Free Siberian Transfer are in force (R2: from the first unit taken to the end of the game). */
export const siberianInForce = (state: GameState): boolean => state.siberian?.used === true;

/** The Objectives held now, as counts. */
export function objectiveCount(ctx: GameContext, state: GameState): ObjectiveCount {
  const s = objectiveStandings(ctx, state);
  return { axis: s.axis.length, allies: s.allies.length, nobody: s.nobody.length };
}

/** The highest level a count reaches, or null. */
function levelReached(count: number, needs: LevelNeeds): VictoryLevel | null {
  return [...LEVELS].reverse().find((l) => count >= needs[l]) ?? null;
}

const turnOf = (state: GameState): GameTurn => ({ year: state.year, season: state.season });
const conquestOf = (state: GameState, country: Conquest["country"]): Conquest | undefined => state.conquests?.find((c) => c.country === country);
const inWindow = (w: ConquestWindow, at: GameTurn): boolean => turnIndex(at) <= turnIndex(w.to) && (w.from === undefined || turnIndex(at) >= turnIndex(w.from));

/** The window a conquest on this Game Turn falls in, or undefined. */
const windowOf = (windows: readonly ConquestWindow[], at: GameTurn): ConquestWindow | undefined => windows.find((w) => inWindow(w, at));

/** Ref 2.1, 2.2: the result of an Objectives table for these counts. */
function byObjectives(table: ObjectiveTable, c: ObjectiveCount): Pick<GameResult, "winner" | "level"> {
  const allies = levelReached(c.allies, table.allies);
  const axis = levelReached(c.axis, table.axis);
  if (allies !== null && axis !== null) {
    // TODO(verify) V1: both sides reach a level at once (only possible if Spain, Sweden or Turkey is conquered, so that 40 or more Objectives are held):
    // the higher level wins and equal levels are a Stalemate. The tables are exact while at most 39 are held.
    if (RANK[allies] === RANK[axis]) return { winner: null, level: null };
    return RANK[allies] > RANK[axis] ? { winner: "allies", level: allies } : { winner: "axis", level: axis };
  }
  if (allies !== null) return { winner: "allies", level: allies };
  if (axis !== null) return { winner: "axis", level: axis };
  return { winner: null, level: null };
}

/** The Game Turn in which both Germany and Italy are conquered ("Conquer Axis", Ref 2.4; TODO(verify) V6: both, as the words say), or null. */
function axisConqueredAt(state: GameState): GameTurn | null {
  const g = conquestOf(state, "germany");
  const i = conquestOf(state, "italy");
  if (!g || !i) return null;
  return turnIndex(g.at) >= turnIndex(i.at) ? g.at : i.at;
}

const alliedPowersConquered = (state: GameState): number => ALLIED_MAJOR_POWERS.filter((p) => conquestOf(state, p) !== undefined).length;

/**
 * The result of a conquest scenario, or null if the conquests so far decide nothing yet. `last`: whether
 * the last Game Turn is over (then something must be said).
 */
function byConquest(rules: Exclude<VictoryRules, { kind: "objectives" }>, state: GameState, siberian: boolean, last: boolean): Pick<GameResult, "winner" | "level" | "basis"> | null {
  if (rules.kind === "germany-falls") {
    const germany = conquestOf(state, "germany");
    const w = germany ? windowOf(rules.windows, germany.at) : undefined;
    if (w) return { winner: w.winner, level: w.level, basis: "conquest" };
    return last ? { ...GERMANY_STANDING_AT_END, basis: "turn-limit" } : null;
  }
  const at = axisConqueredAt(state);
  const w = at ? windowOf(siberian ? rules.siberian : rules.plain, at) : undefined;
  if (w) return { winner: w.winner, level: w.level, basis: "conquest" };
  // TODO(verify) V7: with the Transfer a conquest after Spring 1945 is no Allied result; it falls through to the Axis tests, then Stalemate.
  const powers = alliedPowersConquered(state);
  if (powers >= rules.axis.decisivePowers) return { winner: "axis", level: "decisive", basis: "powers-conquered" };
  if (!last) return null;
  if (powers >= rules.axis.tacticalPowers) return { winner: "axis", level: "tactical", basis: "powers-conquered" };
  const checkpoint = state.victory?.checkpoints[turnKey(rules.axis.marginal.at)];
  if (checkpoint !== undefined && checkpoint >= rules.axis.marginal.objectives) return { winner: "axis", level: "marginal", basis: "objectives" };
  return { winner: null, level: null, basis: "turn-limit" };
}

/**
 * The result that stands now, or null if the game goes on (Ref 2.0; R3).
 * - "end-of-play": the last Game Turn is over; the answer is never null.
 * - "after-conquest": a conquest has just completed; only the scenarios decided by conquest can end early
 *   (1944: Germany falls; Campaign: the Allies conquer the Axis, or the Axis conquers three Allied Major Powers).
 *   The early end is the switch END_EARLY_ON_CONQUEST (V3).
 */
export function evaluateVictory(ctx: GameContext, state: GameState, moment: "end-of-play"): GameResult;
export function evaluateVictory(ctx: GameContext, state: GameState, moment: VictoryMoment): GameResult | null;
export function evaluateVictory(ctx: GameContext, state: GameState, moment: VictoryMoment): GameResult | null {
  const rules = ctx.scenario.victory;
  const siberian = siberianInForce(state);
  const objectives = objectiveCount(ctx, state);
  const last = moment === "end-of-play";
  if (!last && !END_EARLY_ON_CONQUEST) return null;
  const base = { objectives, at: turnOf(state), siberian };
  if (rules.kind === "objectives") {
    if (!last) return null;
    return { ...byObjectives(siberian ? rules.siberian : rules.plain, objectives), basis: "objectives", early: false, ...base };
  }
  const found = byConquest(rules, state, siberian, last);
  if (found) return { ...found, early: !last, ...base };
  // Only reachable at the end of play for the Campaign's Stalemate; the 1944 table always answers.
  return last ? { winner: null, level: null, basis: "turn-limit", early: false, ...base } : null;
}

/**
 * Remembers the Axis Objective count when the Campaign's checkpoint Game Turn ends (Winter 1943; Ref 2.4), once.
 * Call it when a Game Turn is over. Other scenarios have no checkpoint.
 */
export function recordCheckpoint(ctx: GameContext, state: GameState): GameState {
  const rules = ctx.scenario.victory;
  if (rules.kind !== "campaign") return state;
  const key = turnKey(rules.axis.marginal.at);
  if (turnKey(turnOf(state)) !== key || state.victory?.checkpoints[key] !== undefined) return state;
  return { ...state, victory: { checkpoints: { ...state.victory?.checkpoints, [key]: objectiveCount(ctx, state).axis } } };
}

/** For each side, the next level it has not reached: how many Objectives it needs and how many more that is. */
export interface NextLevel {
  level: VictoryLevel;
  needs: number;
  more: number;
}

/** What each side needs now (for the score line and the end card, ticket 14-4). The words are the screens'; this is the numbers. */
export interface VictoryTarget {
  kind: VictoryRules["kind"];
  siberian: boolean;
  counts: ObjectiveCount;
  /** "objectives" scenarios: the table in force. */
  table?: ObjectiveTable;
  /** "objectives" scenarios: how far each side is from its next level (null at Decisive). */
  next?: Record<Side, NextLevel | null>;
  /** Conquest scenarios: the windows in force. */
  windows?: ConquestWindow[];
  /** The Campaign's Axis levels. */
  axis?: Extract<VictoryRules, { kind: "campaign" }>["axis"];
}

/** The next level a count has not reached in a table of needs, with how many more it takes; null at Decisive. */
export function nextLevel(count: number, needs: LevelNeeds): NextLevel | null {
  const level = LEVELS.find((l) => needs[l] > count);
  return level === undefined ? null : { level, needs: needs[level], more: needs[level] - count };
}

export function victoryTarget(ctx: GameContext, state: GameState): VictoryTarget {
  const rules = ctx.scenario.victory;
  const siberian = siberianInForce(state);
  const counts = objectiveCount(ctx, state);
  if (rules.kind === "objectives") {
    const table = siberian ? rules.siberian : rules.plain;
    return { kind: rules.kind, siberian, counts, table, next: { allies: nextLevel(counts.allies, table.allies), axis: nextLevel(counts.axis, table.axis) } };
  }
  if (rules.kind === "germany-falls") return { kind: rules.kind, siberian, counts, windows: rules.windows };
  return { kind: rules.kind, siberian, counts, windows: siberian ? rules.siberian : rules.plain, axis: rules.axis };
}
